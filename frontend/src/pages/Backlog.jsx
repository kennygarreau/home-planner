import { useState, useEffect } from 'react'
import { api } from '../api'
import { fmtCurrency, fmtPct, PRIORITY_COLORS, PRIORITY_LABELS } from '../utils'
import ProjectModal from '../components/ProjectModal'
import { Plus, Pencil, Trash2, ArrowUpCircle, Search } from 'lucide-react'

export default function Backlog() {
  const [items, setItems] = useState([])
  const [benchmarks, setBenchmarks] = useState([])
  const [modal, setModal] = useState(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([api.getBacklog(), api.getBenchmarks()])
      .then(([b, bm]) => { setItems(b); setBenchmarks(bm) })
      .finally(() => setLoading(false))
  }, [])

  async function handleSave(form) {
    if (modal?.id) {
      const updated = await api.updateBacklogItem(modal.id, form)
      setItems(is => is.map(i => i.id === updated.id ? updated : i))
    } else {
      const created = await api.createBacklogItem(form)
      setItems(is => [created, ...is])
    }
    setModal(null)
  }

  async function handleDelete(id) {
    if (!confirm('Remove this idea?')) return
    await api.deleteBacklogItem(id)
    setItems(is => is.filter(i => i.id !== id))
  }

  async function handlePromote(id) {
    if (!confirm('Move to active projects?')) return
    await api.promoteBacklogItem(id)
    setItems(is => is.filter(i => i.id !== id))
  }

  const filtered = items.filter(i => !search || i.name.toLowerCase().includes(search.toLowerCase()))
  const totalEstimated = filtered.reduce((s, i) => s + i.estimatedCost, 0)
  const byPriority = ['critical', 'high', 'medium', 'low']
  const sorted = [...filtered].sort((a, b) => byPriority.indexOf(a.priority) - byPriority.indexOf(b.priority))

  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Backlog</h1>
          <p className="text-slate-500 text-sm mt-1">Ideas and future projects</p>
        </div>
        <button className="btn-primary" onClick={() => setModal({})}>
          <Plus size={16} /> <span className="hidden sm:inline">Add Idea</span><span className="sm:hidden">Add</span>
        </button>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-40">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className="input pl-9" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="text-sm text-slate-500 shrink-0">
          {filtered.length} ideas · <span className="text-slate-300">{fmtCurrency(totalEstimated)}</span>
        </div>
      </div>

      {loading ? (
        <div className="text-slate-500 text-sm">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-slate-500 mb-3">Your backlog is empty. Start adding ideas!</p>
          <button className="btn-primary mx-auto" onClick={() => setModal({})}>
            <Plus size={16} /> Add your first idea
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(item => (
            <div key={item.id} className="card hover:border-slate-700 transition-colors">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 justify-between">
                    <p className="text-slate-100 font-medium text-sm leading-snug">{item.name}</p>
                    <span className={`badge shrink-0 ${PRIORITY_COLORS[item.priority]}`}>{PRIORITY_LABELS[item.priority]}</span>
                  </div>
                  {item.notes && <p className="text-xs text-slate-500 mt-1 truncate">{item.notes}</p>}
                  <div className="flex items-center gap-3 mt-2 text-xs">
                    <span className="text-slate-400 font-mono">{fmtCurrency(item.estimatedCost)}</span>
                    {item.roiBenchmark > 0 && (
                      <span className="text-brand-400">+{fmtPct(item.roiBenchmark)} ROI · +{fmtCurrency(item.estimatedCost * item.roiBenchmark / 100)}</span>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button title="Promote to project" className="p-1.5 rounded hover:bg-brand-900/40 text-slate-400 hover:text-brand-400 transition-colors" onClick={() => handlePromote(item.id)}>
                    <ArrowUpCircle size={15} />
                  </button>
                  <button className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors" onClick={() => setModal(item)}>
                    <Pencil size={15} />
                  </button>
                  <button className="p-1.5 rounded hover:bg-red-900/40 text-slate-400 hover:text-red-400 transition-colors" onClick={() => handleDelete(item.id)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal !== null && (
        <ProjectModal
          project={modal?.id ? modal : null}
          benchmarks={benchmarks}
          onSave={handleSave}
          onClose={() => setModal(null)}
          isBacklog={true}
        />
      )}
    </div>
  )
}
