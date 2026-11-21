const express = require('express')

const { toWifiFloorplan } = require('../lib/wifiFloorplan')

const EMPTY_PLAN = { nodes: [], walls: [], rooms: [], openings: [], devices: [], floorStructure: 'wood_joist' }

// Pick only the editable fields that were actually sent, with light validation.
function pickFields(body) {
  const out = {}
  if (typeof body.name === 'string') out.name = body.name.trim() || 'Untitled Floor'
  if (body.level !== undefined && Number.isFinite(Number(body.level))) out.level = Math.trunc(Number(body.level))
  if (body.ceilingHt !== undefined && Number(body.ceilingHt) > 0) out.ceilingHt = Number(body.ceilingHt)
  if (body.north !== undefined && Number.isFinite(Number(body.north))) out.north = ((Number(body.north) % 360) + 360) % 360
  if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
    const { nodes, walls, rooms, openings, devices, floorStructure } = body.data
    out.data = {
      nodes: Array.isArray(nodes) ? nodes : [],
      walls: Array.isArray(walls) ? walls : [],
      rooms: Array.isArray(rooms) ? rooms : [],
      openings: Array.isArray(openings) ? openings : [],
      devices: Array.isArray(devices) ? devices : [],
      floorStructure: typeof floorStructure === 'string' ? floorStructure : 'wood_joist',
    }
  }
  return out
}

module.exports = (prisma) => {
  const router = express.Router()

  router.get('/', async (req, res) => {
    try {
      const floors = await prisma.floorPlan.findMany({ orderBy: [{ level: 'asc' }, { createdAt: 'asc' }] })
      res.json(floors)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  // Adapter for the Wi-Fi survey module: all floors as wifi_survey floorplan.json
  // (schema_version 1, metres). ?download=1 serves it as an attachment.
  router.get('/export/wifi', async (req, res) => {
    try {
      const floors = await prisma.floorPlan.findMany({ orderBy: [{ level: 'asc' }, { createdAt: 'asc' }] })
      if (req.query.download) res.setHeader('Content-Disposition', 'attachment; filename="floorplan.json"')
      res.json(toWifiFloorplan(floors))
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.post('/', async (req, res) => {
    try {
      const fields = pickFields(req.body)
      const floor = await prisma.floorPlan.create({
        data: { name: 'Untitled Floor', data: EMPTY_PLAN, ...fields },
      })
      res.status(201).json(floor)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  // Partial update — the editor autosaves geometry, and floor settings separately.
  router.put('/:id', async (req, res) => {
    try {
      const floor = await prisma.floorPlan.update({
        where: { id: req.params.id },
        data: pickFields(req.body),
      })
      res.json(floor)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.delete('/:id', async (req, res) => {
    try {
      await prisma.floorPlan.delete({ where: { id: req.params.id } })
      res.json({ success: true })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  return router
}
