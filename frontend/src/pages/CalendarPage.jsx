import { useState, useEffect } from 'react'
import { api } from '../api'
import { fmtCurrency } from '../utils'
import { ChevronLeft, ChevronRight } from 'lucide-react'

const STATUS_DOT = {
  planned:      'bg-blue-400',
  'in-progress':'bg-yellow-400',
  done:         'bg-brand-400',
  'on-hold':    'bg-orange-400',
}
const TASK_STATUS_DOT = {
  pending:      'bg-slate-500',
  'in-progress':'bg-yellow-400',
  done:         'bg-brand-400',
}

function getDaysInMonth(year, month) { return new Date(year, month + 1, 0).getDate() }
function getFirstDayOfMonth(year, month) { return new Date(year, month, 1).getDay() }
function sameDay(a, b) { return a.toDateString() === b.toDateString() }
function inRange(date, start, end) {
  const d = new Date(date.toDateString())
  return d >= new Date(start.toDateString()) && d <= new Date(end.toDateString())
}

const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December']
const dayNames = ['S','M','T','W','T','F','S']
const dayNamesFull = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

export default function CalendarPage() {
  const [projects, setProjects] = useState([])
  const [tasks, setTasks] = useState([])
  const [loading, setLoading] = useState(true)
  const today = new Date()
  const [viewYear, setViewYear] = useState(today.getFullYear())
  const [viewMonth, setViewMonth] = useState(today.getMonth())
  const [selected, setSelected] = useState(null)

  useEffect(() => {
    Promise.all([api.getProjects(), api.getAllTasks()])
      .then(([p, t]) => { setProjects(p); setTasks(t) })
      .finally(() => setLoading(false))
  }, [])

  function prevMonth() {
    if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) }
    else setViewMonth(m => m - 1)
  }
  function nextMonth() {
    if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) }
    else setViewMonth(m => m + 1)
  }

  function itemsForDay(day) {
    const date = new Date(viewYear, viewMonth, day)
    const dayProjects = projects.filter(p => {
      if (!p.scheduledStart && !p.scheduledEnd) return false
      const start = p.scheduledStart ? new Date(p.scheduledStart) : null
      const end = p.scheduledEnd ? new Date(p.scheduledEnd) : null
      if (start && end) return inRange(date, start, end)
      if (start) return sameDay(date, start)
      if (end) return sameDay(date, end)
      return false
    })
    const dayTasks = tasks.filter(t => t.scheduledDate && sameDay(date, new Date(t.scheduledDate)))
    return { projects: dayProjects, tasks: dayTasks }
  }

  const daysInMonth = getDaysInMonth(viewYear, viewMonth)
  const firstDay = getFirstDayOfMonth(viewYear, viewMonth)
  const cells = []
  for (let i = 0; i < firstDay; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)

  const thisMonthTasks = tasks.filter(t => {
    if (!t.scheduledDate) return false
    const d = new Date(t.scheduledDate)
    return d.getFullYear() === viewYear && d.getMonth() === viewMonth
  }).sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate))

  const undated = projects.filter(p => !p.scheduledStart && !p.scheduledEnd && p.status !== 'done')

  const handleDayClick = (day) => {
    const { projects: dp, tasks: dt } = itemsForDay(day)
    if (dp.length === 0 && dt.length === 0) { setSelected(null); return }
    setSelected({ day, projects: dp, tasks: dt })
  }

  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-6">
      <h1 className="page-title">Calendar</h1>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-4 md:gap-6">
        {/* Calendar grid */}
        <div className="xl:col-span-3 card p-3 md:p-5">
          <div className="flex items-center justify-between mb-4">
            <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors">
              <ChevronLeft size={18} />
            </button>
            <h2 className="font-display text-xl md:text-2xl tracking-widest uppercase text-slate-100">
              {monthNames[viewMonth]} {viewYear}
            </h2>
            <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors">
              <ChevronRight size={18} />
            </button>
          </div>

          {/* Day headers - single letter on mobile */}
          <div className="grid grid-cols-7 mb-1">
            {dayNames.map((d, i) => (
              <div key={i} className="text-center text-xs text-slate-500 uppercase tracking-wider py-1">
                <span className="md:hidden">{d}</span>
                <span className="hidden md:inline">{dayNamesFull[i]}</span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-0.5 md:gap-1">
            {cells.map((day, idx) => {
              if (!day) return <div key={`empty-${idx}`} />
              const { projects: dp, tasks: dt } = itemsForDay(day)
              const total = dp.length + dt.length
              const isToday = day === today.getDate() && viewMonth === today.getMonth() && viewYear === today.getFullYear()
              const isSelected = selected?.day === day

              return (
                <div
                  key={day}
                  onClick={() => handleDayClick(day)}
                  className={`min-h-[52px] md:min-h-[72px] rounded-lg p-1 md:p-1.5 border transition-colors cursor-pointer
                    ${isToday ? 'border-brand-500/60 bg-brand-900/10' : 'border-transparent hover:border-slate-700 hover:bg-slate-800/40'}
                    ${isSelected ? 'border-slate-600 bg-slate-800/60' : ''}
                  `}
                >
                  <div className={`text-xs font-mono mb-0.5 w-5 h-5 flex items-center justify-center rounded-full mx-auto
                    ${isToday ? 'bg-brand-600 text-white font-bold' : 'text-slate-400'}
                  `}>
                    {day}
                  </div>
                  {/* On mobile just show dots, on desktop show labels */}
                  <div className="flex flex-wrap gap-0.5 justify-center md:hidden">
                    {dt.slice(0, 3).map(t => (
                      <span key={t.id} className={`w-1.5 h-1.5 rounded-sm ${TASK_STATUS_DOT[t.status]}`} />
                    ))}
                    {dp.slice(0, 3).map(p => (
                      <span key={p.id} className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[p.status]}`} />
                    ))}
                  </div>
                  <div className="hidden md:block space-y-0.5">
                    {dt.slice(0, 2).map(t => (
                      <div key={t.id} className="text-[10px] leading-tight px-1 py-0.5 rounded truncate flex items-center gap-1 bg-slate-700/40 text-slate-300">
                        <span className={`w-1.5 h-1.5 rounded-sm shrink-0 ${TASK_STATUS_DOT[t.status]}`} />
                        {t.name}
                      </div>
                    ))}
                    {dp.slice(0, Math.max(0, 2 - dt.length)).map(p => (
                      <div key={p.id} className="text-[10px] leading-tight px-1 py-0.5 rounded truncate flex items-center gap-1 text-slate-400 border border-slate-700/50">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[p.status]}`} />
                        {p.name}
                      </div>
                    ))}
                    {total > 2 && <div className="text-[10px] text-slate-500 px-1">+{total - 2} more</div>}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Legend */}
          <div className="flex items-center gap-3 md:gap-6 mt-3 md:mt-4 pt-3 md:pt-4 border-t border-slate-800 flex-wrap">
            <span className="text-xs text-slate-600 uppercase tracking-wider hidden md:inline">Projects:</span>
            {Object.entries(STATUS_DOT).map(([status, color]) => (
              <div key={status} className="flex items-center gap-1 md:gap-1.5 text-xs text-slate-500">
                <span className={`w-2 h-2 rounded-full ${color}`} />
                <span className="hidden md:inline">{status}</span>
              </div>
            ))}
            <span className="text-xs text-slate-600 uppercase tracking-wider hidden md:inline ml-2">Tasks:</span>
            {Object.entries(TASK_STATUS_DOT).map(([status, color]) => (
              <div key={status} className="flex items-center gap-1 md:gap-1.5 text-xs text-slate-500">
                <span className={`w-2 h-2 rounded-sm ${color}`} />
                <span className="hidden md:inline">{status}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Sidebar */}
        <div className="space-y-3 md:space-y-4">
          {selected && (
            <div className="card border-slate-700">
              <h3 className="font-display tracking-widest uppercase text-slate-300 text-base mb-3">
                {monthNames[viewMonth]} {selected.day}
              </h3>
              {selected.tasks.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs text-slate-600 uppercase tracking-wider mb-2">Tasks</p>
                  <div className="space-y-2">
                    {selected.tasks.map(t => (
                      <div key={t.id} className="text-sm border-b border-slate-800 pb-2 last:border-0">
                        <div className="flex items-center gap-1.5 mb-0.5">
                          <span className={`w-2 h-2 rounded-sm shrink-0 ${TASK_STATUS_DOT[t.status]}`} />
                          <span className="text-slate-200">{t.name}</span>
                        </div>
                        <div className="text-xs text-slate-500 ml-3.5">{t.project?.name} · {t.status}</div>
                        {t.notes && <div className="text-xs text-slate-600 ml-3.5 mt-0.5 italic">{t.notes}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {selected.projects.length > 0 && (
                <div>
                  <p className="text-xs text-slate-600 uppercase tracking-wider mb-2">Projects</p>
                  <div className="space-y-2">
                    {selected.projects.map(p => (
                      <div key={p.id} className="text-sm border-b border-slate-800 pb-2 last:border-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          <span className={`w-2 h-2 rounded-full ${STATUS_DOT[p.status]}`} />
                          <span className="text-slate-200 font-medium">{p.name}</span>
                        </div>
                        <div className="text-xs text-slate-500 ml-3.5">{fmtCurrency(p.estimatedCost)} · {p.status}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {thisMonthTasks.length > 0 && (
            <div className="card">
              <h3 className="font-display tracking-widest uppercase text-slate-400 text-sm mb-3">
                Tasks This Month ({thisMonthTasks.length})
              </h3>
              <div className="space-y-1.5">
                {thisMonthTasks.map(t => (
                  <div key={t.id} className="flex items-start gap-2 text-xs">
                    <span className={`w-1.5 h-1.5 rounded-sm mt-1 shrink-0 ${TASK_STATUS_DOT[t.status]}`} />
                    <div className="min-w-0">
                      <div className="text-slate-300 truncate">{t.name}</div>
                      <div className="text-slate-600">{t.project?.name} · {new Date(t.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {undated.length > 0 && (
            <div className="card">
              <h3 className="font-display tracking-widest uppercase text-slate-400 text-sm mb-3">
                Unscheduled ({undated.length})
              </h3>
              <div className="space-y-1.5">
                {undated.slice(0, 8).map(p => (
                  <div key={p.id} className="text-xs text-slate-500 truncate">{p.name}</div>
                ))}
                {undated.length > 8 && <div className="text-xs text-slate-600">+{undated.length - 8} more</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
