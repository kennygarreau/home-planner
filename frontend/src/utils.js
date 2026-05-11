export const fmtCurrency = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n || 0)

export const fmtPct = (n) => `${(n || 0).toFixed(0)}%`

export const fmtDate = (d) => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export const fmtMonthYear = (d) => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

export const STATUS_OPTIONS = ['planned', 'in-progress', 'done', 'on-hold']
export const PRIORITY_OPTIONS = ['low', 'medium', 'high', 'critical']

export const STATUS_LABELS = {
  planned: 'Planned',
  'in-progress': 'In Progress',
  done: 'Done',
  'on-hold': 'On Hold',
}

export const PRIORITY_LABELS = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
}

export const STATUS_COLORS = {
  planned: 'bg-blue-900/50 text-blue-300 border border-blue-800/50',
  'in-progress': 'bg-yellow-900/50 text-yellow-300 border border-yellow-800/50',
  done: 'bg-green-900/50 text-green-300 border border-green-800/50',
  'on-hold': 'bg-orange-900/50 text-orange-300 border border-orange-800/50',
}

export const PRIORITY_COLORS = {
  low: 'bg-slate-700/60 text-slate-400 border border-slate-600/50',
  medium: 'bg-blue-900/40 text-blue-400 border border-blue-800/40',
  high: 'bg-orange-900/40 text-orange-400 border border-orange-800/40',
  critical: 'bg-red-900/40 text-red-400 border border-red-800/40',
}
