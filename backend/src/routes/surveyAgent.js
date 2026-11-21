// Endpoints for the laptop agent (`wifi-survey agent`). The agent only ever
// makes outbound requests: long-poll for a job, report progress, post a result.
const express = require('express')
const hub = require('../lib/surveyHub')

const MAX_WAIT_MS = 30 * 1000

function agentInfo(body) {
  const id = typeof body.agentId === 'string' ? body.agentId.slice(0, 64) : null
  if (!id) return null
  const str = (v) => (typeof v === 'string' ? v.slice(0, 200) : undefined)
  return {
    agentId: id,
    hostname: str(body.hostname),
    version: str(body.version),
    interface: str(body.interface),
    capabilities: body.capabilities && typeof body.capabilities === 'object' ? body.capabilities : undefined,
  }
}

module.exports = (prisma) => {
  const router = express.Router()

  router.get('/agents', (req, res) => res.json(hub.listAgents()))

  // Long-poll: 200 { job } as soon as one is queued, or 204 after `wait` seconds.
  router.post('/poll', async (req, res) => {
    try {
      const info = agentInfo(req.body)
      if (!info) return res.status(400).json({ error: 'agentId is required' })
      hub.touchAgent(info)
      const wait = Math.min(Math.max(Number(req.body.wait) || 25, 0) * 1000, MAX_WAIT_MS)

      let aborted = false
      res.on('close', () => { if (!res.writableFinished) aborted = true })
      const job = await hub.waitForJob(prisma, info.agentId, wait, () => aborted)
      hub.touchAgent({ agentId: info.agentId })

      if (job && aborted) {
        // The agent hung up after we claimed — put the job back.
        await prisma.surveyPoint.updateMany({
          where: { id: job.pointId, status: 'running', agentId: info.agentId },
          data: { status: 'queued', agentId: null, startedAt: null, progress: null },
        })
        hub.notifyJob()
        return
      }
      if (aborted) return
      if (!job) return res.status(204).end()
      res.json({ job })
    } catch (e) {
      if (!res.headersSent) res.status(500).json({ error: e.message })
    }
  })

  // Progress update. 409 tells the agent the job was cancelled or reassigned: stop.
  router.post('/jobs/:pid/progress', async (req, res) => {
    try {
      const { agentId, step, message } = req.body
      hub.touchAgent({ agentId })
      const { count } = await prisma.surveyPoint.updateMany({
        where: { id: req.params.pid, status: 'running', agentId },
        data: { progress: { step: String(step || ''), message: String(message || '') } },
      })
      if (count !== 1) return res.status(409).json({ cancelled: true })
      res.json({ ok: true })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  router.post('/jobs/:pid/result', async (req, res) => {
    try {
      const { agentId, record, error, agent } = req.body
      hub.touchAgent({ agentId })
      const point = await prisma.surveyPoint.findUnique({ where: { id: req.params.pid } })
      if (!point || point.status !== 'running' || point.agentId !== agentId) {
        return res.status(409).json({ cancelled: true })
      }
      const ok = record && typeof record === 'object' && !error
      if (ok) {
        await prisma.surveyPoint.update({
          where: { id: point.id },
          data: { status: 'done', record, error: null, progress: null, measuredAt: new Date() },
        })
      } else {
        await hub.settle(prisma, { id: point.id, status: 'running' }, 'failed', String(error || 'No result'))
      }
      // Remember which laptop/driver/iperf server produced this survey (spec meta.json).
      if (ok && agent && typeof agent === 'object') {
        const survey = await prisma.survey.findUnique({ where: { id: point.surveyId } })
        await prisma.survey.update({
          where: { id: point.surveyId },
          data: { meta: { ...(survey.meta || {}), agent: { ...agent, last_seen: new Date().toISOString() } } },
        })
      }
      res.json({ ok: true })
    } catch (e) {
      res.status(500).json({ error: e.message })
    }
  })

  return router
}
