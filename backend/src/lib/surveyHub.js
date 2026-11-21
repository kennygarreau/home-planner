// Relay between the survey page and the laptop agent(s).
//
// The browser queues a measurement by creating/requeuing a SurveyPoint
// (status "queued"). Agents long-poll for work, claim the oldest fresh queued
// point atomically, report progress, then post a result. Nothing ever connects
// *to* the laptop, so there are no CORS/CSP/local-network issues.

const { EventEmitter } = require('events')
const { Prisma } = require('@prisma/client')

const QUEUE_TTL_MS = 2 * 60 * 1000   // a queued job nobody picked up is stale (you've walked away)
const RUN_TTL_MS = 3 * 60 * 1000     // a running job with no progress for this long has died
const ONLINE_MS = 40 * 1000          // agents poll at least every ~25 s
const M_PER_IN = 0.0254

const events = new EventEmitter()
events.setMaxListeners(50)
const agents = new Map()  // agentId → { agentId, hostname, version, interface, capabilities, lastSeen }

function touchAgent(info) {
  if (!info.agentId) return
  const prev = agents.get(info.agentId) || {}
  const fresh = Object.fromEntries(Object.entries(info).filter(([, v]) => v !== undefined))
  agents.set(info.agentId, { ...prev, ...fresh, lastSeen: new Date() })
}

// End an active job without a new result. A point that already holds an
// earlier good measurement keeps it (status back to "done"); otherwise it
// takes the given terminal status.
async function settle(prisma, where, status, error) {
  await prisma.surveyPoint.updateMany({
    where: { ...where, record: { not: Prisma.AnyNull } },
    data: { status: 'done', error: `Re-measure ${status}: ${error} — kept the previous reading`, progress: null },
  })
  return prisma.surveyPoint.updateMany({ where, data: { status, error, progress: null } })
}

const FORGET_MS = 10 * 60 * 1000     // drop agents not seen for this long

function listAgents() {
  const now = Date.now()
  for (const [id, a] of agents) if (now - a.lastSeen.getTime() > FORGET_MS) agents.delete(id)
  return [...agents.values()]
    .map((a) => ({ ...a, online: now - a.lastSeen.getTime() < ONLINE_MS }))
    .sort((a, b) => b.lastSeen - a.lastSeen)
}

const notifyJob = () => events.emit('job')

// Expire stale queued jobs and fail abandoned running ones.
async function sweep(prisma) {
  const now = Date.now()
  await settle(prisma, { status: 'queued', queuedAt: { lt: new Date(now - QUEUE_TTL_MS) } }, 'expired',
    'No agent picked this up within 2 minutes — is `wifi-survey agent` running?')
  await settle(prisma, { status: 'running', updatedAt: { lt: new Date(now - RUN_TTL_MS) } }, 'failed',
    'The agent stopped responding mid-measurement')
}

function jobPayload(point, survey) {
  return {
    pointId: point.id,
    surveyId: point.surveyId,
    surveyType: survey?.type ?? 'baseline',
    label: point.label,
    floorId: point.floorId,
    roomId: point.roomId,
    pos_m: [Math.round(point.x * M_PER_IN * 1000) / 1000, Math.round(point.y * M_PER_IN * 1000) / 1000],
    queuedAt: point.queuedAt,
  }
}

// Atomically move the oldest fresh queued point to "running" for this agent.
async function claim(prisma, agentId) {
  await sweep(prisma)
  for (let attempt = 0; attempt < 3; attempt++) {
    const next = await prisma.surveyPoint.findFirst({
      where: { status: 'queued' },
      orderBy: { queuedAt: 'asc' },
      include: { survey: true },
    })
    if (!next) return null
    const { count } = await prisma.surveyPoint.updateMany({
      where: { id: next.id, status: 'queued' },
      data: { status: 'running', agentId, startedAt: new Date(), progress: { step: 'claimed', message: 'Agent picked up the job' } },
    })
    if (count === 1) return jobPayload(next, next.survey)
    // Another agent won the race; try the next one.
  }
  return null
}

// Wait up to `ms` for a job. Resolves to a job payload or null.
async function waitForJob(prisma, agentId, ms, isAborted) {
  const deadline = Date.now() + ms
  for (;;) {
    if (isAborted()) return null
    const job = await claim(prisma, agentId)
    if (job) return job
    const left = deadline - Date.now()
    if (left <= 0) return null
    await new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer)
        events.off('job', done)
        resolve()
      }
      const timer = setTimeout(done, Math.min(left, 5000))  // re-check periodically for sweeps/aborts
      events.on('job', done)
    })
  }
}

module.exports = { touchAgent, listAgents, notifyJob, sweep, settle, claim, waitForJob, QUEUE_TTL_MS, M_PER_IN }
