const express = require('express')
const aiService = require('../services/ai')

module.exports = (prisma) => {
  const router = express.Router()

  // POST /api/ai/nameplate
  // Body: { entityType, entityId, imageData (base64), mimeType }
  // Extracts HVAC nameplate data using vision model, saves image + result
  router.post('/nameplate', async (req, res) => {
    if (!aiService.isEnabled()) {
      return res.status(503).json({
        error: 'AI_NOT_CONFIGURED',
        message: 'AI features are not enabled. Set AI_ENABLED=true and AI_BASE_URL in your environment.',
      })
    }

    const { entityType, entityId, imageData, mimeType = 'image/jpeg' } = req.body

    if (!entityType || !entityId) {
      return res.status(400).json({ error: 'entityType and entityId are required' })
    }
    if (!imageData || typeof imageData !== 'string') {
      return res.status(400).json({ error: 'imageData (base64) is required' })
    }

    try {
      const { extracted, modelUsed } = await aiService.extractNameplate(imageData, mimeType)

      // Upsert: one record per (entityType, entityId) — replace previous scan
      const existing = await prisma.nameplateImage.findFirst({
        where: { entityType, entityId },
      })

      const data = { entityType, entityId, imageData, mimeType, extractedData: extracted, modelUsed }

      const record = existing
        ? await prisma.nameplateImage.update({ where: { id: existing.id }, data })
        : await prisma.nameplateImage.create({ data: { ...data, id: require('crypto').randomUUID() } })

      // Don't return full imageData in the response body — it's large; frontend already has it
      const { imageData: _omit, ...recordMeta } = record

      res.json({ record: recordMeta, extracted })
    } catch (err) {
      if (err.message === 'AI_NOT_CONFIGURED') {
        return res.status(503).json({ error: 'AI_NOT_CONFIGURED' })
      }
      if (err.message === 'Model returned unparseable output') {
        return res.status(422).json({ error: 'PARSE_FAILED', message: 'Vision model returned unparseable output. Try a clearer photo.' })
      }
      console.error('Nameplate extraction error:', err.message, err.cause ?? err.stack)
      res.status(500).json({ error: 'Extraction failed', message: err.message })
    }
  })

  // GET /api/ai/status
  router.get('/status', (_req, res) => {
    res.json({
      enabled: aiService.isEnabled(),
      visionModel: aiService.VISION_MODEL,
      textModel: aiService.TEXT_MODEL,
    })
  })

  return router
}
