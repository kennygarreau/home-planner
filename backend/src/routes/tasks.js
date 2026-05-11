const express = require('express')

module.exports = (prisma) => {
  const router = express.Router()

  // GET all tasks for a project
  router.get('/project/:projectId', async (req, res) => {
    try {
      const tasks = await prisma.task.findMany({
        where: { projectId: req.params.projectId },
        orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'asc' }],
      })
      res.json(tasks)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  // GET all tasks across all projects (for calendar + dashboard)
  router.get('/', async (req, res) => {
    try {
      const tasks = await prisma.task.findMany({
        orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'asc' }],
        include: { project: { select: { id: true, name: true, status: true } } },
      })
      res.json(tasks)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  // POST create task
  router.post('/', async (req, res) => {
    try {
      const { projectId, name, scheduledDate, status, notes } = req.body
      if (!projectId || !name) return res.status(400).json({ error: 'projectId and name are required' })
      const task = await prisma.task.create({
        data: {
          projectId,
          name,
          scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
          status: status || 'pending',
          notes: notes || '',
        },
        include: { project: { select: { id: true, name: true, status: true } } },
      })
      res.status(201).json(task)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  // PUT update task
  router.put('/:id', async (req, res) => {
    try {
      const { name, scheduledDate, status, notes } = req.body
      const task = await prisma.task.update({
        where: { id: req.params.id },
        data: {
          name,
          scheduledDate: scheduledDate ? new Date(scheduledDate) : null,
          status: status || 'pending',
          notes: notes || '',
        },
        include: { project: { select: { id: true, name: true, status: true } } },
      })
      res.json(task)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  // DELETE task
  router.delete('/:id', async (req, res) => {
    try {
      await prisma.task.delete({ where: { id: req.params.id } })
      res.json({ success: true })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  return router
}
