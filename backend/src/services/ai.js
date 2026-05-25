const OpenAI = require('openai')

const VISION_MODEL = process.env.AI_VISION_MODEL || 'qwen2-vl:7b'
const TEXT_MODEL   = process.env.AI_TEXT_MODEL   || 'llama3.1:8b'

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
    // response_format not universally supported across Ollama models — parse manually
    max_tokens: 512,
  })

  const raw = response.choices[0]?.message?.content || ''
  const parsed = parseJSON(raw)

  if (!parsed) throw new Error('Model returned unparseable output')

  // Normalise capacity fields — guard against strings like "80,000"
  if (parsed.furnace_cap != null) {
    parsed.furnace_cap = parseInt(String(parsed.furnace_cap).replace(/[^0-9]/g, '')) || null
  }
  if (parsed.ac_cap != null) {
    parsed.ac_cap = parseInt(String(parsed.ac_cap).replace(/[^0-9]/g, '')) || null
  }

  return { extracted: parsed, modelUsed: VISION_MODEL }
}

module.exports = { extractNameplate, isEnabled, TEXT_MODEL, VISION_MODEL }
