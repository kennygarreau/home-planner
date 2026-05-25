const express = require('express')

module.exports = (prisma) => {
  const router = express.Router()

  router.get('/', async (req, res) => {
    try {
      let settings = await prisma.settings.findUnique({ where: { id: 1 } })
      if (!settings) {
        settings = await prisma.settings.create({ data: { id: 1, homeValue: 0, location: '' } })
      }
      res.json(settings)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.put('/', async (req, res) => {
    try {
      const { homeValue, location } = req.body
      const settings = await prisma.settings.upsert({
        where:  { id: 1 },
        update: { homeValue: parseFloat(homeValue) || 0, location: location || '' },
        create: { id: 1, homeValue: parseFloat(homeValue) || 0, location: location || '' },
      })
      res.json(settings)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  return router
}
