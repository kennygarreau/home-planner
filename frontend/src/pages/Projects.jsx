import { useState, useEffect, useCallback } from 'react'
import { Plus, Pencil, Trash2, Search, ChevronDown, ChevronRight, CheckSquare, Square, Clock } from 'lucide-react'
import { api } from '../api'
import { fmtCurrency, STATUS_COLORS, STATUS_LABELS, PRIORITY_COLORS, PRIORITY_LABELS, STATUS_OPTIONS } from '../utils'
import ProjectModal from '../components/ProjectModal'

const TASK_STATUS_STYLES = {
  pending:       'text-slate-400',
  'in-progress': 'text-yellow-400',
  done:          'text-brand-400 line-through opacity-60',
}
const TASK_STATUS_ICON = {
  pending:       Square,
  'in-progress': Clock,
  done:          CheckSquare,
}

function TaskRow({ task, onUpdate, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    name: task.name,
    scheduledDate: task.scheduledDate ? task.scheduledDate.substring(0, 10) : '',
    notes: task.notes,
    status: task.status,
  })

  const cycleStatus = async () => {
    const next = { pending: 'in-progress', 'in-progress': 'done', done: 'pending' }
    const updated = await api.updateTask(task.id, { ...task, status: next[task.status] })
    onUpdate(updated)
  }

  const save = async (e) => {
    e.preventDefault()
    const updated = await api.updateTask(task.id, form)
    onUpdate(updated)
    setEditing(false)
  }

  const Icon = TASK_STATUS_ICON[task.status] || Square

  if (editing) {
    return (
      <form onSubmit={save} className="flex flex-col sm:flex-row items-start sm:items-center gap-2 py-2 pl-6 md:pl-8 pr-2 bg-slate-800/60 rounded-lg">
        <input className="input flex-1 w-full sm:w-auto py-1 text-xs" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} required autoFocus />
        <input className="input w-full sm:w-32 py-1 text-xs" type="date" value={form.scheduledDate} onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))} />
        <select className="input w-full sm:w-28 py-1 text-xs" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
          <option value="pending">Pending</option>
          <option value="in-progress">In Progress</option>
          <option value="done">Done</option>
        </select>
        <div className="flex gap-2 w-full sm:w-auto">
          <button type="submit" className="btn-primary py-1 text-xs px-2 flex-1 sm:flex-none">Save</button>
          <button type="button" className="btn-ghost py-1 text-xs px-2 flex-1 sm:flex-none" onClick={() => setEditing(false)}>Cancel</button>
        </div>
      </form>
    )
  }

  return (
    <div className="flex items-center gap-2 py-2 pl-6 md:pl-8 pr-2 rounded-lg hover:bg-slate-800/40 group">
      <button onClick={cycleStatus} className="shrink-0 text-slate-500 hover:text-brand-400 transition-colors">
        <Icon size={14} className={TASK_STATUS_STYLES[task.status]} />
      </button>
      <span className={`flex-1 text-xs ${TASK_STATUS_STYLES[task.status]}`}>{task.name}</span>
      {task.scheduledDate && (
        <span className="text-xs text-slate-600 font-mono shrink-0">
          {new Date(task.scheduledDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </span>
      )}
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
        <button className="p-1 rounded hover:bg-slate-700 text-slate-500 hover:text-slate-300" onClick={() => setEditing(true)}>
          <Pencil size={11} />
        </button>
        <button className="p-1 rounded hover:bg-red-900/40 text-slate-500 hover:text-red-400" onClick={() => onDelete(task.id)}>
          <Trash2 size={11} />
        </button>
      </div>
    </div>
  )
}

function AddTaskRow({ projectId, onAdd }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', scheduledDate: '', notes: '' })

  const submit = async (e) => {
    e.preventDefault()
    const task = await api.createTask({ projectId, ...form, status: 'pending' })
    onAdd(task)
    setForm({ name: '', scheduledDate: '', notes: '' })
    setOpen(false)
  }

  if (!open) return (
    <button onClick={() => setOpen(true)} className="flex items-center gap-1.5 pl-6 md:pl-8 py-2 text-xs text-slate-600 hover:text-brand-400 transition-colors">
      <Plus size={12} /> Add task
    </button>
  )

  return (
    <form onSubmit={submit} className="flex flex-col sm:flex-row items-start sm:items-center gap-2 py-2 pl-6 md:pl-8 pr-2 bg-slate-800/60 rounded-lg">
      <input className="input flex-1 w-full sm:w-auto py-1 text-xs" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Task name…" required autoFocus />
      <input className="input w-full sm:w-32 py-1 text-xs" type="date" value={form.scheduledDate} onChange={e => setForm(f => ({ ...f, scheduledDate: e.target.value }))} />
      <input className="input flex-1 w-full sm:w-auto py-1 text-xs" value={form.notes} placeholder="Notes…" onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
      <div className="flex gap-2 w-full sm:w-auto">
        <button type="submit" className="btn-primary py-1 text-xs px-2 flex-1 sm:flex-none">Add</button>
        <button type="button" className="btn-ghost py-1 text-xs px-2 flex-1 sm:flex-none" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  )
}

function ProjectCard({ project, benchmarks, onEdit, onDelete }) {
  const [expanded, setExpanded] = useState(false)
  const [tasks, setTasks] = useState(null)

  const loadTasks = useCallback(async () => {
    const t = await api.getTasksForProject(project.id)
    setTasks(t)
  }, [project.id])

  const toggleExpand = async () => {
    if (!expanded && tasks === null) await loadTasks()
    setExpanded(e => !e)
  }

  const handleTaskUpdate = (updated) => setTasks(ts => ts.map(t => t.id === updated.id ? updated : t))
  const handleTaskAdd = (task) => setTasks(ts => [...(ts || []), task])
  const handleTaskDelete = async (id) => {
    await api.deleteTask(id)
    setTasks(ts => ts.filter(t => t.id !== id))
  }

  const doneTasks = tasks?.filter(t => t.status === 'done').length ?? 0
  const categoryLabel = benchmarks.find(b => b.category === project.category)?.label || project.category

  return (
    <div className="card hover:border-slate-700 transition-colors">
      {/* Header row — always visible */}
      <div className="flex items-start gap-3 cursor-pointer select-none" onClick={toggleExpand}>
        <div className="text-slate-600 hover:text-slate-400 transition-colors mt-0.5 shrink-0">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-medium text-sm text-slate-100 leading-snug">{project.name}</p>
              <p className="text-xs text-slate-500 mt-0.5 truncate">{categoryLabel}</p>
            </div>
            {/* Actions - always visible on mobile, hover on desktop */}
            <div className="flex gap-1 shrink-0 md:opacity-0 md:group-hover:opacity-100" onClick={e => e.stopPropagation()}>
              <button className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200" onClick={() => onEdit(project)}>
                <Pencil size={13} />
              </button>
              <button className="p-1.5 rounded hover:bg-red-900/40 text-slate-400 hover:text-red-400" onClick={() => onDelete(project.id)}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>

          {/* Badges + stats row */}
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className={`badge ${STATUS_COLORS[project.status] || 'bg-slate-700 text-slate-400'}`}>
              {STATUS_LABELS[project.status] || project.status}
            </span>
            <span className={`badge ${PRIORITY_COLORS[project.priority] || 'bg-slate-700 text-slate-400'}`}>
              {PRIORITY_LABELS[project.priority] || project.priority}
            </span>
            {tasks !== null && tasks.length > 0 && (
              <span className="text-xs text-slate-600 font-mono">{doneTasks}/{tasks.length} tasks</span>
            )}
          </div>

          {/* Cost row */}
          <div className="flex items-center gap-4 mt-2 text-xs">
            <span className="text-slate-400 font-mono">{fmtCurrency(project.estimatedCost)}</span>
            {project.actualCost > 0 && <span className="text-slate-500 font-mono">actual: {fmtCurrency(project.actualCost)}</span>}
            {project.roiBenchmark > 0 && (
              <span className="text-brand-400 font-mono">+{fmtCurrency((project.estimatedCost || 0) * (project.roiBenchmark || 0) / 100)} value</span>
            )}
          </div>
        </div>
      </div>

      {/* Task list */}
      {expanded && (
        <div className="mt-3 pt-3 border-t border-slate-800 space-y-0.5">
          {tasks === null ? (
            <p className="text-xs text-slate-600 pl-6 py-1">Loading…</p>
          ) : tasks.length === 0 ? (
            <p className="text-xs text-slate-600 pl-6 py-1">No tasks yet.</p>
          ) : (
            tasks.map(task => (
              <TaskRow key={task.id} task={task} onUpdate={handleTaskUpdate} onDelete={handleTaskDelete} />
            ))
          )}
          <AddTaskRow projectId={project.id} onAdd={handleTaskAdd} />
        </div>
      )}
    </div>
  )
}

export default function Projects() {
  const [projects, setProjects] = useState([])
  const [benchmarks, setBenchmarks] = useState([])
  const [modal, setModal] = useState(null)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [loading, setLoading] = useState(true)

  const load = () =>
    Promise.all([api.getProjects(), api.getBenchmarks()])
      .then(([p, b]) => { setProjects(p); setBenchmarks(b) })
      .finally(() => setLoading(false))

  useEffect(() => { load() }, [])

  const handleSave = async (form) => {
    if (modal && modal.id) await api.updateProject(modal.id, form)
    else await api.createProject(form)
    setModal(null)
    load()
  }

  const handleDelete = async (id) => {
    if (!confirm('Delete this project and all its tasks?')) return
    await api.deleteProject(id)
    load()
  }

  const filtered = projects
    .filter(p => filterStatus === 'all' || p.status === filterStatus)
    .filter(p => !search || p.name.toLowerCase().includes(search.toLowerCase()))

  return (
    <div className="p-4 md:p-8">
      <div className="flex items-center justify-between mb-4 md:mb-6">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="text-sm text-slate-500 mt-1">{projects.length} total · tap to expand tasks</p>
        </div>
        <button className="btn-primary" onClick={() => setModal('new')}>
          <Plus size={15} /> <span className="hidden sm:inline">New Project</span><span className="sm:hidden">New</span>
        </button>
      </div>

      <div className="flex gap-2 mb-4 md:mb-6 flex-wrap">
        <div className="relative flex-1 min-w-40">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className="input pl-9" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…" />
        </div>
        <select className="input w-auto" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="all">All</option>
          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
        </select>
      </div>

      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-slate-500">No projects yet — add your first one!</p>
        </div>
      ) : (
        <div className="space-y-2 group">
          {filtered.map(p => (
            <ProjectCard key={p.id} project={p} benchmarks={benchmarks} onEdit={setModal} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {modal && (
        <ProjectModal
          item={modal === 'new' ? null : modal}
          benchmarks={benchmarks}
          isBacklog={false}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
