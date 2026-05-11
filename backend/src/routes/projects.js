const express = require('express')

module.exports = (prisma) => {
  const router = express.Router()

  router.get('/', async (req, res) => {
    try {
      const projects = await prisma.project.findMany({ orderBy: { createdAt: 'desc' } })
      res.json(projects)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.get('/:id', async (req, res) => {
    try {
      const project = await prisma.project.findUnique({ where: { id: req.params.id } })
      if (!project) return res.status(404).json({ error: 'Not found' })
      res.json(project)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.post('/', async (req, res) => {
    try {
      const { name, category, status, estimatedCost, actualCost, roiBenchmark, scheduledStart, scheduledEnd, notes, priority } = req.body
      const project = await prisma.project.create({
        data: {
          name,
          category,
          status: status || 'planned',
          estimatedCost: parseFloat(estimatedCost) || 0,
          actualCost: parseFloat(actualCost) || 0,
          roiBenchmark: parseFloat(roiBenchmark) || 0,
          scheduledStart: scheduledStart ? new Date(scheduledStart) : null,
          scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : null,
          notes: notes || '',
          priority: priority || 'medium',
        }
      })
      res.status(201).json(project)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.put('/:id', async (req, res) => {
    try {
      const { name, category, status, estimatedCost, actualCost, roiBenchmark, scheduledStart, scheduledEnd, notes, priority } = req.body
      const project = await prisma.project.update({
        where: { id: req.params.id },
        data: {
          name,
          category,
          status,
          estimatedCost: parseFloat(estimatedCost) || 0,
          actualCost: parseFloat(actualCost) || 0,
          roiBenchmark: parseFloat(roiBenchmark) || 0,
          scheduledStart: scheduledStart ? new Date(scheduledStart) : null,
          scheduledEnd: scheduledEnd ? new Date(scheduledEnd) : null,
          notes: notes || '',
          priority: priority || 'medium',
        }
      })
      res.json(project)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.delete('/:id', async (req, res) => {
    try {
      await prisma.project.delete({ where: { id: req.params.id } })
      res.json({ success: true })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  return router
}
