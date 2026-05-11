const express = require('express')

module.exports = (prisma) => {
  const router = express.Router()

  router.get('/json', async (req, res) => {
    try {
      const [settings, projects, backlog] = await Promise.all([
        prisma.settings.findUnique({ where: { id: 1 } }),
        prisma.project.findMany({ orderBy: { createdAt: 'desc' } }),
        prisma.backlogItem.findMany({ orderBy: { createdAt: 'desc' } }),
      ])
      const data = { exportedAt: new Date().toISOString(), settings, projects, backlog }
      res.setHeader('Content-Disposition', 'attachment; filename="homeplanner-export.json"')
      res.setHeader('Content-Type', 'application/json')
      res.json(data)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.get('/csv', async (req, res) => {
    try {
      const projects = await prisma.project.findMany({ orderBy: { createdAt: 'desc' } })
      const headers = ['id','name','category','status','priority','estimatedCost','actualCost','roiBenchmark','scheduledStart','scheduledEnd','notes','createdAt']
      const rows = projects.map(p => headers.map(h => {
        const v = p[h]
        if (v === null || v === undefined) return ''
        if (typeof v === 'string' && v.includes(',')) return `"${v.replace(/"/g, '""')}"`
        return v
      }).join(','))
      const csv = [headers.join(','), ...rows].join('\n')
      res.setHeader('Content-Disposition', 'attachment; filename="homeplanner-projects.csv"')
      res.setHeader('Content-Type', 'text/csv')
      res.send(csv)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  return router
}
