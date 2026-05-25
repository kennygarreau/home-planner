import { useState, useEffect } from 'react'
import { TrendingUp, DollarSign, Hammer, CheckCircle, Clock, ArrowUpRight, AlertTriangle, CalendarClock, ListTodo } from 'lucide-react'
import { LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, ResponsiveContainer } from 'recharts'
import { api } from '../api'
import { fmtCurrency, fmtDate, STATUS_COLORS, STATUS_LABELS, PRIORITY_COLORS } from '../utils'

const STALE_DAYS = 60

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

export default function Dashboard() {
  const [projects, setProjects] = useState([])
  const [settings, setSettings] = useState({ homeValue: 0, location: '' })
  const [valueHistory, setValueHistory] = useState([])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.getProjects(), api.getSettings(), api.getHomeValueHistory(), api.getAllTasks()])
      .then(([p, s, h, t]) => { setProjects(p); setSettings(s); setValueHistory(h); setTasks(t) })
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center h-full text-slate-500">Loading…</div>
  )

  const active = projects.filter(p => p.status !== 'done')
  const done = projects.filter(p => p.status === 'done')
  const inProgress = projects.filter(p => p.status === 'in-progress')
  const totalEstimated = active.reduce((s, p) => s + (p.estimatedCost || 0), 0)
  const totalActual = done.reduce((s, p) => s + (p.actualCost || 0), 0)
  const projectedValueIncrease = projects.reduce((sum, p) => {
    const cost = p.status === 'done' ? (p.actualCost || 0) : (p.estimatedCost || 0)
    return sum + (cost * (p.roiBenchmark || 0) / 100)
  }, 0)
  const projectedHomeValue = (settings.homeValue || 0) + projectedValueIncrease

  const latestSnapshot = valueHistory.length > 0 ? valueHistory[valueHistory.length - 1] : null
  const staleDays = latestSnapshot ? daysSince(latestSnapshot.createdAt) : (settings.homeValue > 0 ? daysSince(settings.updatedAt) : Infinity)
  const isStale = staleDays >= STALE_DAYS
  const hasNoValue = !settings.homeValue || settings.homeValue === 0

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

  const upcoming = projects
    .filter(p => p.scheduledStart && p.status !== 'done')
    .sort((a, b) => new Date(a.scheduledStart) - new Date(b.scheduledStart))
    .slice(0, 6)

  const upcomingTasks = tasks
    .filter(t => t.scheduledDate && t.status !== 'done')
    .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate))
    .slice(0, 8)

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

      {/* Charts - stack on mobile */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 md:gap-6">
        <div className="card lg:col-span-2">
          <h2 className="font-display text-lg md:text-xl tracking-widest text-slate-200 mb-4">PROJECT COSTS</h2>
          {chartData.length === 0 ? (
            <p className="text-sm py-8 text-center text-slate-500">No projects with costs yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-800">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800 bg-slate-900/50">
                    <th className="text-left px-4 py-2.5 text-xs font-mono uppercase tracking-wider text-slate-500 font-normal">Project</th>
                    <th className="text-right px-4 py-2.5 text-xs font-mono uppercase tracking-wider text-slate-500 font-normal">Estimated</th>
                    <th className="text-right px-4 py-2.5 text-xs font-mono uppercase tracking-wider text-slate-500 font-normal">Actual</th>
                    <th className="text-right px-4 py-2.5 text-xs font-mono uppercase tracking-wider text-slate-500 font-normal">Δ</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((p, i) => {
                    const delta = p.actual > 0 ? p.actual - p.estimated : null
                    return (
                      <tr key={i} className="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/20">
                        <td className="px-4 py-2.5 text-slate-200 max-w-[180px] truncate">{p.name}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-blue-300">{fmtCurrency(p.estimated)}</td>
                        <td className="px-4 py-2.5 text-right font-mono text-teal-300">{p.actual > 0 ? fmtCurrency(p.actual) : <span className="text-slate-600">—</span>}</td>
                        <td className={`px-4 py-2.5 text-right font-mono text-xs ${delta === null ? 'text-slate-600' : delta > 0 ? 'text-red-400' : 'text-teal-400'}`}>
                          {delta === null ? '—' : `${delta > 0 ? '+' : ''}${fmtCurrency(delta)}`}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <h2 className="font-display text-lg md:text-xl tracking-widest text-slate-200 mb-4">UPCOMING</h2>
          {upcoming.length === 0 ? (
            <p className="text-sm text-slate-500">No scheduled projects.</p>
          ) : (
            <div className="space-y-3">
              {upcoming.map(p => (
                <div key={p.id} className="flex items-start gap-3 pb-3 border-b border-slate-800 last:border-0 last:pb-0">
                  <Clock size={13} className="text-yellow-500 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-200 truncate">{p.name}</p>
                    <p className="text-xs text-slate-500">{fmtDate(p.scheduledStart)}</p>
                    <span className={`badge text-xs mt-1 ${STATUS_COLORS[p.status]}`}>{STATUS_LABELS[p.status]}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Upcoming tasks */}
      {upcomingTasks.length > 0 && (
        <div className="card">
          <div className="flex items-center gap-2 mb-4">
            <ListTodo size={15} className="text-slate-400" />
            <h2 className="font-display text-lg md:text-xl tracking-widest text-slate-200">UPCOMING TASKS</h2>
          </div>
          <div className="space-y-2">
            {upcomingTasks.map(t => (
              <div key={t.id} className="flex items-start gap-3 py-2 border-b border-slate-800 last:border-0">
                <span className="text-xs font-mono text-slate-500 shrink-0 w-16 mt-0.5">
                  {new Date(t.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </span>
                <div className="flex-1 min-w-0">
                  <span className="text-sm text-slate-200">{t.name}</span>
                  <div className="text-xs text-slate-500 truncate">{t.project?.name}</div>
                </div>
                <span className={`badge text-xs shrink-0 ${
                  t.status === 'in-progress' ? 'bg-yellow-900/40 text-yellow-400 border border-yellow-800/40'
                  : 'bg-slate-700/60 text-slate-400 border border-slate-600/50'
                }`}>{t.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Home value chart */}
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

      {/* ROI table */}
      {roiChart.length > 0 && (
        <div className="card">
          <h2 className="font-display text-lg md:text-xl tracking-widest text-slate-200 mb-4">ROI BY PROJECT</h2>
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/50">
                  <th className="text-left px-4 py-2.5 text-xs font-mono uppercase tracking-wider text-slate-500 font-normal">Project</th>
                  <th className="text-right px-4 py-2.5 text-xs font-mono uppercase tracking-wider text-slate-500 font-normal">ROI</th>
                  <th className="text-right px-4 py-2.5 text-xs font-mono uppercase tracking-wider text-slate-500 font-normal">Value Added</th>
                </tr>
              </thead>
              <tbody>
                {roiChart.map((p, i) => {
                  const roiCls = p.roi >= 100 ? 'text-teal-400' : p.roi >= 70 ? 'text-blue-400' : 'text-amber-400'
                  return (
                    <tr key={i} className="border-b border-slate-800/50 last:border-0 hover:bg-slate-800/20">
                      <td className="px-4 py-2.5 text-slate-200 max-w-[220px] truncate">{p.name}</td>
                      <td className={`px-4 py-2.5 text-right font-mono font-medium ${roiCls}`}>{p.roi}%</td>
                      <td className="px-4 py-2.5 text-right font-mono text-slate-300">{fmtCurrency(p.valueAdded)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
