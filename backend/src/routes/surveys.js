// Wi-Fi surveys, as used by the browser. The laptop agent uses ./surveyAgent.js.
const express = require('express')
const hub = require('../lib/surveyHub')
const { toWifiFloorplan } = require('../lib/wifiFloorplan')

const ANALYSIS_URL = process.env.ANALYSIS_URL || 'http://analysis:8000'
const KEEP_ANALYSES = 5

const TYPES = ['baseline', 'ap_on_a_stick', 'validation']
const ACTIVE = ['queued', 'running']

const pickSurvey = (b) => {
  const out = {}
  if (typeof b.name === 'string' && b.name.trim()) out.name = b.name.trim()
  if (TYPES.includes(b.type)) out.type = b.type
  if (typeof b.notes === 'string') out.notes = b.notes
  if (b.meta && typeof b.meta === 'object' && !Array.isArray(b.meta)) out.meta = b.meta
  return out
}

// Only one measurement at a time: there's one laptop, in one place.
async function activePoint(prisma) {
  await hub.sweep(prisma)
  return prisma.surveyPoint.findFirst({ where: { status: { in: ACTIVE } } })
}

module.exports = (prisma) => {
  const router = express.Router()

  router.get('/', async (req, res) => {
    try {
      const surveys = await prisma.survey.findMany({ orderBy: { createdAt: 'desc' } })
      const counts = await prisma.surveyPoint.groupBy({ by: ['surveyId'], where: { status: 'done' }, _count: true })
      const done = Object.fromEntries(counts.map((c) => [c.surveyId, c._count]))
      res.json(surveys.map((s) => ({ ...s, donePoints: done[s.id] ?? 0 })))
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.post('/', async (req, res) => {
    try {
      const data = pickSurvey(req.body)
      if (!data.name) return res.status(400).json({ error: 'name is required' })
      res.status(201).json(await prisma.survey.create({ data }))
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  // Everything the survey page needs in one poll: survey, points, agents.
  router.get('/:id', async (req, res) => {
    try {
      await hub.sweep(prisma)
      const survey = await prisma.survey.findUnique({
        where: { id: req.params.id },
        include: { points: { orderBy: { createdAt: 'asc' } } },
      })
      if (!survey) return res.status(404).json({ error: 'Survey not found' })
      const { points, ...rest } = survey
      res.json({ survey: rest, points, agents: hub.listAgents() })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.put('/:id', async (req, res) => {
    try {
      res.json(await prisma.survey.update({ where: { id: req.params.id }, data: pickSurvey(req.body) }))
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.delete('/:id', async (req, res) => {
    try {
      await prisma.survey.delete({ where: { id: req.params.id } })
      res.json({ success: true })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  // Queue a measurement. Re-using a label on the same floor re-measures that point.
  router.post('/:id/points', async (req, res) => {
    try {
      const { floorId, roomId, label, x, y } = req.body
      if (!floorId || !label || !Number.isFinite(x) || !Number.isFinite(y)) {
        return res.status(400).json({ error: 'floorId, label, x and y are required' })
      }
      const busy = await activePoint(prisma)
      if (busy) return res.status(409).json({ error: 'A measurement is already in progress', point: busy })
      const existing = await prisma.surveyPoint.findFirst({ where: { surveyId: req.params.id, floorId, label } })
      const fields = {
        roomId: roomId || null, x, y, status: 'queued', queuedAt: new Date(),
        agentId: null, progress: null, error: null, startedAt: null,
      }
      const point = existing
        ? await prisma.surveyPoint.update({ where: { id: existing.id }, data: fields })
        : await prisma.surveyPoint.create({ data: { surveyId: req.params.id, floorId, label, ...fields } })
      hub.notifyJob()
      res.status(existing ? 200 : 201).json(point)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.post('/points/:pid/measure', async (req, res) => {
    try {
      const busy = await activePoint(prisma)
      if (busy && busy.id !== req.params.pid) {
        return res.status(409).json({ error: 'A measurement is already in progress', point: busy })
      }
      const point = await prisma.surveyPoint.update({
        where: { id: req.params.pid },
        data: { status: 'queued', queuedAt: new Date(), agentId: null, progress: null, error: null, startedAt: null },
      })
      hub.notifyJob()
      res.json(point)
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.post('/points/:pid/cancel', async (req, res) => {
    try {
      const before = await prisma.surveyPoint.findUnique({ where: { id: req.params.pid } })
      await hub.settle(prisma, { id: req.params.pid, status: { in: ACTIVE } }, 'cancelled', 'Cancelled')
      res.json({ cancelled: !!before && ACTIVE.includes(before.status) })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.delete('/points/:pid', async (req, res) => {
    try {
      await prisma.surveyPoint.delete({ where: { id: req.params.pid } })
      res.json({ success: true })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  // Run the wifi_survey analysis service on this survey and store the result.
  //   kind "analysis": fitted model, room grades, heatmaps   (POST /analyze)
  //   kind "plan":     placement options for new APs          (POST /plan)
  async function runService(req, res, kind, extra = {}) {
    try {
      const [floors, points] = await Promise.all([
        prisma.floorPlan.findMany(),
        prisma.surveyPoint.findMany({ where: { surveyId: req.params.id, status: 'done' } }),
      ])
      const records = points.map((p) => p.record).filter(Boolean)
      if (!records.length) return res.status(400).json({ error: 'This survey has no measurements yet' })

      let resp
      try {
        resp = await fetch(`${ANALYSIS_URL}/${kind === 'plan' ? 'plan' : 'analyze'}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ floorplan: toWifiFloorplan(floors), records, ...extra }),
          signal: AbortSignal.timeout(120000),
        })
      } catch (e) {
        return res.status(503).json({ error: `Analysis service unavailable (${e.cause?.code || e.name}) — is the "analysis" container running?` })
      }
      const result = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }))
      if (!resp.ok) return res.status(502).json({ error: result.error || 'Analysis failed' })

      const saved = await prisma.surveyAnalysis.create({ data: { surveyId: req.params.id, kind, result } })
      const old = await prisma.surveyAnalysis.findMany({
        where: { surveyId: req.params.id, kind }, orderBy: { createdAt: 'desc' }, skip: KEEP_ANALYSES, select: { id: true },
      })
      if (old.length) await prisma.surveyAnalysis.deleteMany({ where: { id: { in: old.map((a) => a.id) } } })
      res.json({ id: saved.id, createdAt: saved.createdAt, ...result })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  }

  async function latest(req, res, kind) {
    try {
      const a = await prisma.surveyAnalysis.findFirst({
        where: { surveyId: req.params.id, kind }, orderBy: { createdAt: 'desc' },
      })
      if (!a) return res.status(404).json({ error: kind === 'plan' ? 'No AP plan yet' : 'Not analysed yet' })
      res.json({ id: a.id, createdAt: a.createdAt, ...a.result })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  }

  router.post('/:id/analyze', (req, res) => runService(req, res, 'analysis'))
  router.get('/:id/analysis', (req, res) => latest(req, res, 'analysis'))

  const AP_MODELS = ['tplink_eap772', 'tplink_eap773']
  router.post('/:id/plan', (req, res) => {
    const apModel = AP_MODELS.includes(req.body?.apModel) ? req.body.apModel : 'tplink_eap772'
    const maxAps = Math.max(1, Math.min(Number(req.body?.maxAps) || 4, 6))
    return runService(req, res, 'plan', { ap_model: apModel, max_aps: maxAps })
  })
  router.get('/:id/plan', (req, res) => latest(req, res, 'plan'))

  // Spec §2.3 outputs for the home planner / other tools.
  router.get('/:id/rooms.json', async (req, res) => {
    const a = await prisma.surveyAnalysis.findFirst({ where: { surveyId: req.params.id, kind: 'analysis' }, orderBy: { createdAt: 'desc' } })
    if (!a) return res.status(404).json({ error: 'Not analysed yet' })
    res.json({ schema_version: 1, survey_id: req.params.id, generated_at: a.result.generated_at, rooms: a.result.rooms || [] })
  })
  router.get('/:id/placement.json', async (req, res) => {
    const a = await prisma.surveyAnalysis.findFirst({ where: { surveyId: req.params.id, kind: 'plan' }, orderBy: { createdAt: 'desc' } })
    if (!a) return res.status(404).json({ error: 'No AP plan yet' })
    const { options = [], ...rest } = a.result
    res.json({ ...rest, survey_id: req.params.id, options: options.map(({ grids, ...o }) => o) })
  })

  // Spec §2.2: one point record per line, for the Python analysis tools.
  router.get('/:id/points.jsonl', async (req, res) => {
    try {
      const points = await prisma.surveyPoint.findMany({
        where: { surveyId: req.params.id, status: 'done' },
        orderBy: { measuredAt: 'asc' },
      })
      res.setHeader('Content-Type', 'application/x-ndjson')
      if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="points-${req.params.id}.jsonl"`)
      res.send(points.map((p) => JSON.stringify(p.record)).join('\n') + (points.length ? '\n' : ''))
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  // Spec §2.2 meta.json
  router.get('/:id/meta.json', async (req, res) => {
    try {
      const s = await prisma.survey.findUnique({ where: { id: req.params.id } })
      if (!s) return res.status(404).json({ error: 'Survey not found' })
      res.json({ schema_version: 1, survey_id: s.id, name: s.name, type: s.type, notes: s.notes, created_at: s.createdAt, ...s.meta })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  return router
}
