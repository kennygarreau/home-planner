const express = require('express')

module.exports = (prisma) => {
  const router = express.Router()

  router.get('/', async (req, res) => {
    try {
      const items = await prisma.backlogItem.findMany({ orderBy: { createdAt: 'desc' } })
      res.json(items)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.post('/', async (req, res) => {
    try {
      const { name, category, estimatedCost, roiBenchmark, priority, notes } = req.body
      const item = await prisma.backlogItem.create({
        data: {
          name,
          category,
          estimatedCost: parseFloat(estimatedCost) || 0,
          roiBenchmark: parseFloat(roiBenchmark) || 0,
          priority: priority || 'medium',
          notes: notes || '',
        }
      })
      res.status(201).json(item)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.put('/:id', async (req, res) => {
    try {
      const { name, category, estimatedCost, roiBenchmark, priority, notes } = req.body
      const item = await prisma.backlogItem.update({
        where: { id: req.params.id },
        data: {
          name,
          category,
          estimatedCost: parseFloat(estimatedCost) || 0,
          roiBenchmark: parseFloat(roiBenchmark) || 0,
          priority: priority || 'medium',
          notes: notes || '',
        }
      })
      res.json(item)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.delete('/:id', async (req, res) => {
    try {
      await prisma.backlogItem.delete({ where: { id: req.params.id } })
      res.json({ success: true })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  // Promote backlog item to active project
  router.post('/:id/promote', async (req, res) => {
    try {
      const item = await prisma.backlogItem.findUnique({ where: { id: req.params.id } })
      if (!item) return res.status(404).json({ error: 'Not found' })
      const project = await prisma.project.create({
        data: {
          name: item.name,
          category: item.category,
          estimatedCost: item.estimatedCost,
          roiBenchmark: item.roiBenchmark,
          priority: item.priority,
          notes: item.notes,
          status: 'planned',
          actualCost: 0,
        }
      })
      await prisma.backlogItem.delete({ where: { id: item.id } })
      res.json(project)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  return router
}
