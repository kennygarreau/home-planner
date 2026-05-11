const express = require('express')

module.exports = (prisma) => {
  const router = express.Router()

  router.get('/', async (req, res) => {
    try {
      const benchmarks = await prisma.roiBenchmark.findMany({ orderBy: { roiPercent: 'desc' } })
      res.json(benchmarks)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  return router
}
