const express = require('express')
const aiService = require('../services/ai')

module.exports = (prisma) => {
  const router = express.Router()

  // GET /api/ai/status
  router.get('/status', async (_req, res) => {
    let dbSettings = null
    try { dbSettings = await prisma.settings.findUnique({ where: { id: 1 } }) } catch {}
    res.json({
      enabled:      aiService.isEnabled(),
      visionModel:  dbSettings?.aiVisionModel || aiService.VISION_MODEL,
      textModel:    dbSettings?.aiTextModel   || aiService.TEXT_MODEL,
    })
  })

  // GET /api/ai/models — proxy LiteLLM /v1/models so the API key stays server-side
  router.get('/models', async (_req, res) => {
    if (!aiService.isEnabled()) {
      return res.status(503).json({ error: 'AI_NOT_CONFIGURED' })
    }
    try {
      const base = (process.env.AI_BASE_URL || '').replace(/\/$/, '')
      const r = await fetch(`${base}/v1/models`, {
        headers: { Authorization: `Bearer ${process.env.AI_API_KEY || 'unused'}` },
      })
      if (!r.ok) return res.status(r.status).json({ error: 'LiteLLM model fetch failed' })
      const data = await r.json()
      const models = (data.data || []).map(m => m.id).sort()
      res.json({ models })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // PUT /api/ai/config — persist model selections to DB settings
  router.put('/config', async (req, res) => {
    const { aiVisionModel, aiTextModel } = req.body
    try {
      const settings = await prisma.settings.upsert({
        where:  { id: 1 },
        update: { aiVisionModel: aiVisionModel || null, aiTextModel: aiTextModel || null },
        create: { id: 1, homeValue: 0, location: '', aiVisionModel: aiVisionModel || null, aiTextModel: aiTextModel || null },
      })
      res.json({ aiVisionModel: settings.aiVisionModel, aiTextModel: settings.aiTextModel })
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // POST /api/ai/nameplate
  router.post('/nameplate', async (req, res) => {
    if (!aiService.isEnabled()) {
      return res.status(503).json({ error: 'AI_NOT_CONFIGURED', message: 'AI features are not enabled. Set AI_ENABLED=true and AI_BASE_URL in your environment.' })
    }

    const { entityType, entityId, imageData, mimeType = 'image/jpeg' } = req.body
    if (!entityType || !entityId) return res.status(400).json({ error: 'entityType and entityId are required' })
    if (!imageData || typeof imageData !== 'string') return res.status(400).json({ error: 'imageData (base64) is required' })

    // Resolve active vision model: DB setting → env var default
    let visionModel
    try {
      const s = await prisma.settings.findUnique({ where: { id: 1 } })
      visionModel = s?.aiVisionModel || undefined
    } catch {}

    try {
      const { extracted, modelUsed } = await aiService.extractNameplate(imageData, mimeType, { visionModel })

      const existing = await prisma.nameplateImage.findFirst({ where: { entityType, entityId } })
      const data = { entityType, entityId, imageData, mimeType, extractedData: extracted, modelUsed }
      const record = existing
        ? await prisma.nameplateImage.update({ where: { id: existing.id }, data })
        : await prisma.nameplateImage.create({ data: { ...data, id: require('crypto').randomUUID() } })

      const { imageData: _omit, ...recordMeta } = record
      res.json({ record: recordMeta, extracted })
    } catch (err) {
      if (err.message === 'AI_NOT_CONFIGURED') return res.status(503).json({ error: 'AI_NOT_CONFIGURED' })
      if (err.message === 'Model returned unparseable output') {
        return res.status(422).json({ error: 'PARSE_FAILED', message: 'Vision model returned unparseable output. Try a clearer photo.' })
      }
      console.error('Nameplate extraction error:', err.message, err.cause ?? err.stack)
      res.status(500).json({ error: 'Extraction failed', message: err.message })
    }
  })

  return router
}
