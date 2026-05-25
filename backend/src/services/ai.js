const OpenAI = require('openai')

const VISION_MODEL = process.env.AI_VISION_MODEL || 'llama3.2-vision:11b'
const TEXT_MODEL   = process.env.AI_TEXT_MODEL   || 'qwen3:30b-a3b'

function isEnabled() {
  return process.env.AI_ENABLED === 'true' && !!process.env.AI_BASE_URL
}

function getClient() {
  return new OpenAI({
    baseURL: process.env.AI_BASE_URL,
    apiKey:  process.env.AI_API_KEY || 'unused',
  })
}

// Robustly extract JSON from model output — some models wrap it in markdown fences
function parseJSON(content) {
  try { return JSON.parse(content) } catch {}
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) { try { return JSON.parse(fenced[1].trim()) } catch {} }
  const braced = content.match(/\{[\s\S]*\}/)
  if (braced) { try { return JSON.parse(braced[0]) } catch {} }
  return null
}

function normaliseCapacity(val) {
  if (val == null) return null
  const n = parseInt(String(val).replace(/[^0-9]/g, ''))
  return isNaN(n) || n === 0 ? null : n
}

const NAMEPLATE_PROMPT = `You are reading an HVAC equipment nameplate photograph. Extract the information below and respond with ONLY valid JSON — no markdown, no explanation.

{
  "type": "furnace" | "ac" | "heat_pump" | "air_handler" | "boiler" | "unknown",
  "furnace_cap": <INPUT BTU/hr as integer, null if not a furnace/boiler>,
  "ac_cap": <cooling BTU/hr as integer, null if not a cooling unit>,
  "model_number": "<string or null>",
  "serial_number": "<string or null>",
  "manufacturer": "<string or null>",
  "efficiency": "<e.g. '96% AFUE' or '16 SEER' as string, null if not found>",
  "voltage": "<e.g. '115/60/1' as string, null if not found>",
  "notes": "<important caveats about the extraction, null if none>"
}

Rules:
- furnace_cap: use INPUT BTU/hr only (labeled "Input", "BTUH Input", "Input BTUH", "Input Capacity"). Do NOT use output, heating capacity, or AFUE-adjusted values.
- ac_cap: use nominal cooling capacity in BTU/hr. If labeled in tons, multiply by 12000. If only in model number, decode the tonnage digits: 018=18000 024=24000 030=30000 036=36000 042=42000 048=48000 060=60000.
- If the image is blurry, partial, or not an HVAC nameplate, return null for all numeric fields and explain in notes.
- Return integers for capacity fields — no decimals, no units embedded in the value.`

const LOOKUP_PROMPT = (modelNumber, manufacturer, unitType) =>
  `/no_think
You are an HVAC equipment specification database. Given the model number below, return capacity specs.

Manufacturer: ${manufacturer || 'unknown'}
Model Number: ${modelNumber}
Equipment Type: ${unitType || 'unknown'}

Respond with ONLY valid JSON — no markdown, no explanation, no preamble:

{
  "furnace_cap": <INPUT BTU/hr as integer, null if not a furnace/boiler or unknown>,
  "ac_cap": <cooling BTU/hr as integer, null if not a cooling unit or unknown>,
  "confidence": "high" | "medium" | "low",
  "notes": "<how you determined the values, or why unknown>"
}

Rules:
- furnace_cap: INPUT BTU/hr only. Return null for cooling-only units.
- ac_cap: nominal BTU/hr. Decode tonnage from model digits if needed (e.g. 036=36000). Return null for heating-only units.
- confidence: "high" if certain from known specs, "medium" if inferred from model number pattern, "low" if uncertain.
- If you don't recognise this model, return null for both capacity fields.`

// Best-effort lookup — never throws, returns null on any failure
async function lookupCapacityByModel(modelNumber, manufacturer, unitType) {
  if (!isEnabled() || !modelNumber) return null
  try {
    const client = getClient()
    const response = await client.chat.completions.create({
      model: TEXT_MODEL,
      messages: [{ role: 'user', content: LOOKUP_PROMPT(modelNumber, manufacturer, unitType) }],
      max_tokens: 256,
    })
    const raw = response.choices[0]?.message?.content || ''
    const parsed = parseJSON(raw)
    if (!parsed) return null
    parsed.furnace_cap = normaliseCapacity(parsed.furnace_cap)
    parsed.ac_cap      = normaliseCapacity(parsed.ac_cap)
    return parsed
  } catch {
    return null
  }
}

async function extractNameplate(base64Image, mimeType = 'image/jpeg') {
  if (!isEnabled()) throw new Error('AI_NOT_CONFIGURED')

  const client = getClient()
  const response = await client.chat.completions.create({
    model: VISION_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Image}` } },
        { type: 'text', text: NAMEPLATE_PROMPT },
      ],
    }],
    max_tokens: 512,
  })
  const raw = response.choices[0]?.message?.content || ''
  const parsed = parseJSON(raw)
  if (!parsed) throw new Error('Model returned unparseable output')

  parsed.furnace_cap = normaliseCapacity(parsed.furnace_cap)
  parsed.ac_cap      = normaliseCapacity(parsed.ac_cap)

  // If capacity is missing but we have a model number, try text lookup
  const missingFurnace = !parsed.furnace_cap &&
    ['furnace', 'boiler', 'heat_pump', 'unknown'].includes(parsed.type)
  const missingAC = !parsed.ac_cap &&
    ['ac', 'heat_pump', 'air_handler', 'unknown'].includes(parsed.type)

  if (parsed.model_number && (missingFurnace || missingAC)) {
    const lookup = await lookupCapacityByModel(parsed.model_number, parsed.manufacturer, parsed.type)
    if (lookup) {
      if (missingFurnace && lookup.furnace_cap) {
        parsed.furnace_cap        = lookup.furnace_cap
        parsed.furnace_cap_source = 'model_lookup'
      }
      if (missingAC && lookup.ac_cap) {
        parsed.ac_cap        = lookup.ac_cap
        parsed.ac_cap_source = 'model_lookup'
      }
      if (lookup.confidence) parsed.lookup_confidence = lookup.confidence
      if (lookup.notes) {
        parsed.notes = parsed.notes
          ? `${parsed.notes} | Lookup: ${lookup.notes}`
          : `Lookup (${lookup.confidence} confidence): ${lookup.notes}`
      }
    }
  }

  return { extracted: parsed, modelUsed: VISION_MODEL }
}

module.exports = { extractNameplate, isEnabled, TEXT_MODEL, VISION_MODEL }
