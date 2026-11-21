const express = require('express')

module.exports = (prisma) => {
  const router = express.Router()

  router.get('/', async (req, res) => {
    try {
      const detectors = await prisma.detector.findMany({ orderBy: { location: 'asc' } })
      res.json(detectors)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.post('/', async (req, res) => {
    try {
      const { type, location, installedAt, replaceByDate, batteryType, notes } = req.body
      const detector = await prisma.detector.create({
        data: {
          type: type || 'smoke',
          location,
          installedAt: installedAt ? new Date(installedAt) : null,
          replaceByDate: replaceByDate ? new Date(replaceByDate) : null,
          batteryType: batteryType || '',
          notes: notes || '',
        }
      })
      res.status(201).json(detector)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.put('/:id', async (req, res) => {
    try {
      const { type, location, installedAt, replaceByDate, batteryType, notes } = req.body
      const detector = await prisma.detector.update({
        where: { id: req.params.id },
        data: {
          type: type || 'smoke',
          location,
          installedAt: installedAt ? new Date(installedAt) : null,
          replaceByDate: replaceByDate ? new Date(replaceByDate) : null,
          batteryType: batteryType || '',
          notes: notes || '',
        }
      })
      res.json(detector)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.delete('/:id', async (req, res) => {
    try {
      await prisma.detector.delete({ where: { id: req.params.id } })
      res.json({ success: true })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  return router
}
