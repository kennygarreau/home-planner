const express = require('express')

module.exports = (prisma) => {
  const router = express.Router()

  router.get('/', async (req, res) => {
    try {
      const scenario = await prisma.manualJScenario.findUnique({ where: { id: 1 } })
      res.json(scenario || null)
    } catch (e) {
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  router.put('/', async (req, res) => {
    try {
      const { mode, climate, wholeZone, zones } = req.body
      if (!climate || !wholeZone || !Array.isArray(zones)) {
        return res.status(400).json({ error: 'Invalid payload' })
      }
      const data = { mode: mode || 'whole', climate, wholeZone, zones }
      const scenario = await prisma.manualJScenario.upsert({
        where: { id: 1 },
        update: data,
        create: { id: 1, ...data },
      })
      res.json(scenario)
    } catch (e) {
      res.status(500).json({ error: 'Internal server error' })
    }
  })

  return router
}
