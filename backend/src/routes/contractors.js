const express = require('express')

module.exports = (prisma) => {
  const router = express.Router()

  router.get('/', async (req, res) => {
    try {
      const contractors = await prisma.contractor.findMany({
        orderBy: { name: 'asc' },
        include: { _count: { select: { projects: true } } },
      })
      res.json(contractors)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.post('/', async (req, res) => {
    try {
      const { name, company, trade, phone, email, website, notes } = req.body
      const contractor = await prisma.contractor.create({
        data: {
          name,
          company: company || '',
          trade: trade || '',
          phone: phone || '',
          email: email || '',
          website: website || '',
          notes: notes || '',
        }
      })
      res.status(201).json(contractor)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.put('/:id', async (req, res) => {
    try {
      const { name, company, trade, phone, email, website, notes } = req.body
      const contractor = await prisma.contractor.update({
        where: { id: req.params.id },
        data: {
          name,
          company: company || '',
          trade: trade || '',
          phone: phone || '',
          email: email || '',
          website: website || '',
          notes: notes || '',
        }
      })
      res.json(contractor)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.delete('/:id', async (req, res) => {
    try {
      await prisma.contractor.delete({ where: { id: req.params.id } })
      res.json({ success: true })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  return router
}
