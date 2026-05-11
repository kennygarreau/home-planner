const express = require('express')

module.exports = (prisma) => {
  const router = express.Router()

  router.get('/', async (req, res) => {
    try {
      const snapshots = await prisma.homeValueSnapshot.findMany({
        orderBy: { createdAt: 'asc' }
      })
      res.json(snapshots)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.post('/', async (req, res) => {
    try {
      const { value, note } = req.body
      if (!value || isNaN(parseFloat(value))) {
        return res.status(400).json({ error: 'value is required' })
      }
      const snapshot = await prisma.homeValueSnapshot.create({
        data: {
          value: parseFloat(value),
          note: note || '',
        }
      })
      // Also update the settings homeValue to keep it in sync
      await prisma.settings.upsert({
        where: { id: 1 },
        update: { homeValue: parseFloat(value) },
        create: { id: 1, homeValue: parseFloat(value), location: '' },
      })
      res.status(201).json(snapshot)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.delete('/:id', async (req, res) => {
    try {
      await prisma.homeValueSnapshot.delete({ where: { id: req.params.id } })
      res.json({ success: true })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  return router
}