const express = require('express')

module.exports = (prisma) => {
  const router = express.Router()

  // GET /api/nameplates?entityType=X&entityId=Y
  router.get('/', async (req, res) => {
    const { entityType, entityId } = req.query
    if (!entityType || !entityId) {
      return res.status(400).json({ error: 'entityType and entityId query params are required' })
    }
    try {
      const records = await prisma.nameplateImage.findMany({
        where: { entityType, entityId },
        select: {
          id: true, entityType: true, entityId: true,
          mimeType: true, extractedData: true, modelUsed: true,
          createdAt: true, updatedAt: true,
          // Return a small thumbnail flag so the frontend knows an image exists
          // Full imageData fetched separately to keep list responses lean
          imageData: true,
        },
        orderBy: { updatedAt: 'desc' },
      })
      res.json(records)
    } catch (e) {
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // GET /api/nameplates/:id — full record including imageData
  router.get('/:id', async (req, res) => {
    try {
      const record = await prisma.nameplateImage.findUnique({ where: { id: req.params.id } })
      if (!record) return res.status(404).json({ error: 'Not found' })
      res.json(record)
    } catch (e) {
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // PUT /api/nameplates/:id — update user-corrected extractedData
  router.put('/:id', async (req, res) => {
    const { extractedData } = req.body
    if (!extractedData || typeof extractedData !== 'object') {
      return res.status(400).json({ error: 'extractedData object is required' })
    }
    try {
      const record = await prisma.nameplateImage.update({
        where: { id: req.params.id },
        data: { extractedData },
        select: {
          id: true, entityType: true, entityId: true,
          mimeType: true, extractedData: true, modelUsed: true,
          createdAt: true, updatedAt: true,
        },
      })
      res.json(record)
    } catch (e) {
      if (e.code === 'P2025') return res.status(404).json({ error: 'Not found' })
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  // DELETE /api/nameplates/:id
  router.delete('/:id', async (req, res) => {
    try {
      await prisma.nameplateImage.delete({ where: { id: req.params.id } })
      res.json({ ok: true })
    } catch (e) {
      if (e.code === 'P2025') return res.status(404).json({ error: 'Not found' })
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  return router
}
