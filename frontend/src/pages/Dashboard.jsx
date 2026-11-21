import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrendingUp, DollarSign, Hammer, CheckCircle, Clock, ArrowUpRight, AlertTriangle, CalendarClock, ListTodo, Lightbulb, ArrowRight, Siren } from 'lucide-react'
import { LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts'
import { api } from '../api'
import { fmtCurrency, fmtDate, STATUS_COLORS, STATUS_LABELS, PRIORITY_ORDER } from '../utils'

const STALE_DAYS = 60
const DETECTOR_DUE_SOON_DAYS = 90

function daysSince(dateStr) {
  if (!dateStr) return Infinity
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24))
}

const ValueTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm shadow-xl">
        <p className="text-slate-400 mb-1">{label}</p>
        <p className="text-brand-400">{fmtCurrency(payload[0]?.value)}</p>
      </div>
    )
  }
  return null
}

const CostTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const estimated = payload.find(p => p.dataKey === 'estimated')?.value
    const actual = payload.find(p => p.dataKey === 'actual')?.value
    const delta = actual > 0 ? actual - estimated : null
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm shadow-xl">
        <p className="text-slate-200 font-medium mb-1">{label}</p>
        <p className="text-blue-300">Estimated: {fmtCurrency(estimated)}</p>
        {actual > 0 && <p className="text-teal-300">Actual: {fmtCurrency(actual)}</p>}
        {delta !== null && (
          <p className={delta > 0 ? 'text-red-400' : 'text-teal-400'}>
            {delta > 0 ? '+' : ''}{fmtCurrency(delta)} vs. estimate
          </p>
        )}
      </div>
    )
  }
  return null
}

const RoiTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    const { roi, valueAdded } = payload[0].payload
    return (
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-3 text-sm shadow-xl">
        <p className="text-slate-200 font-medium mb-1">{label}</p>
        <p className="text-brand-400">{roi}% ROI</p>
        <p className="text-slate-400">+{fmtCurrency(valueAdded)} value added</p>
      </div>
    )
  }
  return null
}

function roiColor(roi) {
  return roi >= 100 ? '#2dd4bf' : roi >= 70 ? '#60a5fa' : '#fbbf24'
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState([])
  const [settings, setSettings] = useState({ homeValue: 0, location: '' })
  const [valueHistory, setValueHistory] = useState([])
  const [tasks, setTasks] = useState([])
  const [detectors, setDetectors] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.getProjects(), api.getSettings(), api.getHomeValueHistory(), api.getAllTasks(), api.getDetectors()])
      .then(([p, s, h, t, d]) => { setProjects(p); setSettings(s); setValueHistory(h); setTasks(t); setDetectors(d) })
      .finally(() => setLoading(false))
  }, [])

  const goToProject = (name) => navigate(`/projects?q=${encodeURIComponent(name)}`)

  if (loading) return (
    <div className="flex items-center justify-center h-full text-slate-500">Loading…</div>
  )

  const active = projects.filter(p => p.status !== 'done' && p.status !== 'backlog')
  const done = projects.filter(p => p.status === 'done')
  const inProgress = projects.filter(p => p.status === 'in-progress')
  const backlogProjects = projects.filter(p => p.status === 'backlog')
  const totalEstimated = active.reduce((s, p) => s + (p.estimatedCost || 0), 0)
  const totalActual = done.reduce((s, p) => s + (p.actualCost || 0), 0)
  const projectedValueIncrease = projects.filter(p => p.status !== 'backlog').reduce((sum, p) => {
    const cost = p.status === 'done' ? (p.actualCost || 0) : (p.estimatedCost || 0)
    return sum + (cost * (p.roiBenchmark || 0) / 100)
  }, 0)
  const projectedHomeValue = (settings.homeValue || 0) + projectedValueIncrease

  const latestSnapshot = valueHistory.length > 0 ? valueHistory[valueHistory.length - 1] : null
  const staleDays = latestSnapshot ? daysSince(latestSnapshot.createdAt) : (settings.homeValue > 0 ? daysSince(settings.updatedAt) : Infinity)
  const isStale = staleDays >= STALE_DAYS
  const hasNoValue = !settings.homeValue || settings.homeValue === 0

  const detectorsNeedingAttention = detectors
    .filter(d => d.replaceByDate)
    .map(d => ({ ...d, daysUntil: Math.floor((new Date(d.replaceByDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) }))
    .filter(d => d.daysUntil <= DETECTOR_DUE_SOON_DAYS)
    .sort((a, b) => a.daysUntil - b.daysUntil)
  const overdueDetectorCount = detectorsNeedingAttention.filter(d => d.daysUntil < 0).length

  const valueChartData = valueHistory.map(s => ({
    date: new Date(s.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }),
    value: s.value,
  }))

  const chartData = [...projects]
    .filter(p => p.estimatedCost > 0)
    .sort((a, b) => b.estimatedCost - a.estimatedCost)
    .slice(0, 10)
    .map(p => ({ name: p.name, estimated: p.estimatedCost, actual: p.actualCost || 0 }))

  const roiChart = [...projects]
    .filter(p => p.roiBenchmark > 0 && p.estimatedCost > 0)
    .map(p => ({
      name: p.name,
      roi: p.roiBenchmark,
      valueAdded: Math.round(p.estimatedCost * p.roiBenchmark / 100),
    }))
    .sort((a, b) => b.roi - a.roi)
    .slice(0, 10)

  // Unified agenda: upcoming projects and upcoming tasks merged into one date-sorted list
  const agenda = [
    ...projects
      .filter(p => p.scheduledStart && p.status !== 'done' && p.status !== 'backlog')
      .map(p => ({ kind: 'project', id: p.id, name: p.name, date: p.scheduledStart, status: p.status, linkName: p.name })),
    ...tasks
      .filter(t => t.scheduledDate && t.status !== 'done')
      .map(t => ({ kind: 'task', id: t.id, name: t.name, date: t.scheduledDate, status: t.status, projectName: t.project?.name, linkName: t.project?.name })),
  ]
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, 8)

  const nextUpBacklog = [...backlogProjects]
    .sort((a, b) => {
      const pri = PRIORITY_ORDER.indexOf(a.priority) - PRIORITY_ORDER.indexOf(b.priority)
      return pri !== 0 ? pri : (b.roiBenchmark || 0) - (a.roiBenchmark || 0)
    })
    .slice(0, 5)

  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-6">
      <div>
        <h1 className="page-title">Dashboard</h1>
        {settings.location && <p className="text-sm text-slate-500 mt-1">{settings.location}</p>}
      </div>

      {/* Stale warning */}
      {(isStale || hasNoValue) && (
        <div className="flex items-start gap-3 bg-amber-950/30 border border-amber-800/50 rounded-xl px-4 py-3">
          <AlertTriangle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-300">
              {hasNoValue ? 'Home value not set' : `Home value not updated in ${staleDays === Infinity ? 'a while' : `${staleDays} days`}`}
            </p>
            <p className="text-xs text-amber-600 mt-0.5">
              {hasNoValue ? 'Go to Settings to enter your current home value.' : `Last logged: ${latestSnapshot ? fmtDate(latestSnapshot.createdAt) : 'unknown'}. Update in Settings.`}
            </p>
          </div>
          <div className="flex items-center gap-1 text-xs text-amber-600 shrink-0">
            <CalendarClock size={12} />
            {hasNoValue ? 'Never' : `${staleDays}d ago`}
          </div>
        </div>
      )}

      {/* Detector replacement warning */}
      {detectorsNeedingAttention.length > 0 && (
        <button
          onClick={() => navigate('/detectors')}
          className="flex items-start gap-3 bg-red-950/30 border border-red-800/50 rounded-xl px-4 py-3 w-full text-left hover:border-red-700/60 transition-colors"
        >
          <Siren size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-red-300">
              {overdueDetectorCount > 0
                ? `${overdueDetectorCount} detector${overdueDetectorCount === 1 ? '' : 's'} overdue for replacement`
                : `${detectorsNeedingAttention.length} detector${detectorsNeedingAttention.length === 1 ? '' : 's'} due for replacement soon`}
            </p>
            <p className="text-xs text-red-600 mt-0.5 truncate">
              {detectorsNeedingAttention.slice(0, 3).map(d => d.location).join(', ')}
              {detectorsNeedingAttention.length > 3 ? `, +${detectorsNeedingAttention.length - 3} more` : ''}
            </p>
          </div>
        </button>
      )}

      {/* Stat cards - 2 cols on mobile, 4 on desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp size={13} className="text-brand-400" />
            <span className="stat-label">Projected Value</span>
          </div>
          <div className="stat-value text-brand-300 text-2xl md:text-3xl">{fmtCurrency(projectedHomeValue)}</div>
          {settings.homeValue > 0 && (
            <div className="stat-sub flex items-center gap-1 text-brand-500">
              <ArrowUpRight size={11} />
              +{fmtCurrency(projectedValueIncrease)}
            </div>
          )}
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign size={13} className="text-blue-400" />
            <span className="stat-label">Pipeline</span>
          </div>
          <div className="stat-value text-blue-300 text-2xl md:text-3xl">{fmtCurrency(totalEstimated)}</div>
          <div className="stat-sub">{active.length} active</div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <Hammer size={13} className="text-yellow-400" />
            <span className="stat-label">In Progress</span>
          </div>
          <div className="stat-value text-yellow-300 text-2xl md:text-3xl">{inProgress.length}</div>
          <div className="stat-sub">active now</div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle size={13} className="text-slate-400" />
            <span className="stat-label">Completed</span>
          </div>
          <div className="stat-value text-2xl md:text-3xl">{done.length}</div>
          <div className="stat-sub">{fmtCurrency(totalActual)} spent</div>
        </div>
      </div>

      {/* Home value chart - promoted near the top since it's the headline metric */}
      {valueChartData.length >= 2 && (
        <div className="card">
          <h2 className="font-display text-lg md:text-xl tracking-widest text-slate-200 mb-4">HOME VALUE OVER TIME</h2>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={valueChartData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
              <XAxis dataKey="date" tick={{ fill: '#64748b', fontSize: 10 }} />
              <YAxis tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} width={40} domain={['auto', 'auto']} />
              <Tooltip content={<ValueTooltip />} />
              <Line type="monotone" dataKey="value" stroke="#3a9a3a" strokeWidth={2} dot={{ fill: '#3a9a3a', r: 4 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
          {latestSnapshot && (
            <p className="text-xs text-slate-500 mt-2">
              Latest: {fmtCurrency(latestSnapshot.value)} — {fmtDate(latestSnapshot.createdAt)}
              {!isStale && <span className="text-brand-500 ml-2">✓ Up to date</span>}
            </p>
          )}
        </div>
      )}

      {/* Project costs (bar chart, click a bar to jump to that project) + unified agenda */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="card lg:col-span-2">
          <h2 className="font-display text-lg md:text-xl tracking-widest text-slate-200 mb-4">PROJECT COSTS</h2>
          {chartData.length === 0 ? (
            <p className="text-sm py-8 text-center text-slate-500">No projects with costs yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(200, chartData.length * 38)}>
              <BarChart data={chartData} layout="vertical" margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fill: '#cbd5e1', fontSize: 11 }} />
                <Tooltip content={<CostTooltip />} cursor={{ fill: '#1e293b', opacity: 0.4 }} />
                <Bar dataKey="estimated" name="Estimated" fill="#60a5fa" radius={[0, 4, 4, 0]} style={{ cursor: 'pointer' }} onClick={d => goToProject(d.name)} />
                <Bar dataKey="actual" name="Actual" fill="#2dd4bf" radius={[0, 4, 4, 0]} style={{ cursor: 'pointer' }} onClick={d => goToProject(d.name)} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        <div className="card">
          <h2 className="font-display text-lg md:text-xl tracking-widest text-slate-200 mb-4">AGENDA</h2>
          {agenda.length === 0 ? (
            <p className="text-sm text-slate-500">Nothing scheduled.</p>
          ) : (
            <div className="space-y-3">
              {agenda.map(item => (
                <button
                  key={`${item.kind}-${item.id}`}
                  onClick={() => item.linkName && goToProject(item.linkName)}
                  className="flex items-start gap-3 pb-3 border-b border-slate-800 last:border-0 last:pb-0 w-full text-left hover:opacity-80 transition-opacity"
                >
                  {item.kind === 'project' ? (
                    <Clock size={13} className="text-yellow-500 mt-0.5 flex-shrink-0" />
                  ) : (
                    <ListTodo size={13} className="text-slate-500 mt-0.5 flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{item.name}</p>
                    <p className="text-xs text-slate-500 truncate">
                      {fmtDate(item.date)}
                      {item.kind === 'task' && item.projectName && <span> · {item.projectName}</span>}
                    </p>
                    {item.kind === 'project' && (
                      <span className={`badge text-xs mt-1 ${STATUS_COLORS[item.status]}`}>{STATUS_LABELS[item.status]}</span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ROI (bar chart) + next up from backlog */}
      {(roiChart.length > 0 || nextUpBacklog.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
          {roiChart.length > 0 && (
            <div className="card lg:col-span-2">
              <h2 className="font-display text-lg md:text-xl tracking-widest text-slate-200 mb-4">ROI BY PROJECT</h2>
              <ResponsiveContainer width="100%" height={Math.max(200, roiChart.length * 38)}>
                <BarChart data={roiChart} layout="vertical" margin={{ top: 5, right: 16, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" horizontal={false} />
                  <XAxis type="number" tick={{ fill: '#64748b', fontSize: 10 }} tickFormatter={v => `${v}%`} />
                  <YAxis type="category" dataKey="name" width={120} tick={{ fill: '#cbd5e1', fontSize: 11 }} />
                  <Tooltip content={<RoiTooltip />} cursor={{ fill: '#1e293b', opacity: 0.4 }} />
                  <Bar dataKey="roi" name="ROI" radius={[0, 4, 4, 0]} style={{ cursor: 'pointer' }} onClick={d => goToProject(d.name)}>
                    {roiChart.map((p, i) => <Cell key={i} fill={roiColor(p.roi)} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Lightbulb size={15} className="text-slate-400" />
                <h2 className="font-display text-lg md:text-xl tracking-widest text-slate-200">NEXT UP</h2>
              </div>
              <button onClick={() => navigate('/projects?status=backlog')} className="text-xs text-slate-500 hover:text-brand-400 flex items-center gap-1 transition-colors">
                All <ArrowRight size={11} />
              </button>
            </div>
            {nextUpBacklog.length === 0 ? (
              <p className="text-sm text-slate-500">Backlog is empty.</p>
            ) : (
              <div className="space-y-3">
                {nextUpBacklog.map(item => (
                  <div key={item.id} className="pb-3 border-b border-slate-800 last:border-0 last:pb-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{item.name}</p>
                    <div className="flex items-center gap-2 mt-1 text-xs">
                      <span className="text-slate-500 font-mono">{fmtCurrency(item.estimatedCost)}</span>
                      {item.roiBenchmark > 0 && <span className="text-brand-500">+{item.roiBenchmark}% ROI</span>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
