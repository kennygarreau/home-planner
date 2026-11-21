import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { X, Info } from 'lucide-react'
import { STATUS_OPTIONS, PRIORITY_OPTIONS, STATUS_LABELS, PRIORITY_LABELS } from '../utils'

const EMPTY = {
  name: '', category: '', status: 'planned', estimatedCost: '',
  actualCost: '', roiBenchmark: '', scheduledStart: '', scheduledEnd: '',
  notes: '', priority: 'medium', contractorIds: [],
}

export default function ProjectModal({ item, benchmarks, contractors, onSave, onClose }) {
  const [form, setForm] = useState(EMPTY)
  const [benchmarkNote, setBenchmarkNote] = useState('')

  useEffect(() => {
    if (item) {
      setForm({
        ...item,
        estimatedCost: item.estimatedCost || '',
        actualCost: item.actualCost || '',
        roiBenchmark: item.roiBenchmark || '',
        scheduledStart: item.scheduledStart ? item.scheduledStart.substring(0, 10) : '',
        scheduledEnd: item.scheduledEnd ? item.scheduledEnd.substring(0, 10) : '',
        contractorIds: item.contractors?.map(c => c.id) || [],
      })
      const b = benchmarks?.find(b => b.category === item.category)
      if (b) setBenchmarkNote(b.notes)
    } else {
      setForm(EMPTY)
    }
  }, [item])

  const toggleContractor = (id) => {
    setForm(f => ({
      ...f,
      contractorIds: f.contractorIds.includes(id)
        ? f.contractorIds.filter(cId => cId !== id)
        : [...f.contractorIds, id],
    }))
  }

  const handleCategoryChange = (e) => {
    const cat = e.target.value
    const benchmark = benchmarks?.find(b => b.category === cat)
    setBenchmarkNote(benchmark?.notes || '')
    setForm(f => ({
      ...f,
      category: cat,
      roiBenchmark: benchmark ? benchmark.roiPercent : f.roiBenchmark,
    }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    onSave(form)
  }

  const valueAdded = form.estimatedCost && form.roiBenchmark
    ? (parseFloat(form.estimatedCost) * parseFloat(form.roiBenchmark) / 100)
    : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
          <h2 className="font-display text-2xl tracking-widest uppercase text-slate-100">
            {item ? 'Edit' : 'New'} Project
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors p-1">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Name */}
          <div>
            <label className="label">Project Name *</label>
            <input
              className="input"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Kitchen cabinet refacing"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            {/* Category */}
            <div>
              <label className="label">Category</label>
              <select className="input" value={form.category} onChange={handleCategoryChange}>
                <option value="">— Select —</option>
                {benchmarks?.map(b => (
                  <option key={b.category} value={b.category}>{b.label}</option>
                ))}
              </select>
              {benchmarkNote && (
                <p className="text-xs text-slate-500 mt-1 flex items-start gap-1">
                  <Info size={11} className="mt-0.5 flex-shrink-0 text-blue-500" />
                  {benchmarkNote}
                </p>
              )}
            </div>

            {/* Priority */}
            <div>
              <label className="label">Priority</label>
              <select className="input" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                {PRIORITY_OPTIONS.map(p => (
                  <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                ))}
              </select>
            </div>

            {/* Status */}
            <div>
              <label className="label">Status</label>
              <select className="input" value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                {STATUS_OPTIONS.map(s => (
                  <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                ))}
              </select>
            </div>

            {/* ROI */}
            <div>
              <label className="label">ROI Benchmark %</label>
              <input
                className="input"
                type="number"
                value={form.roiBenchmark}
                onChange={e => setForm(f => ({ ...f, roiBenchmark: e.target.value }))}
                placeholder="Auto-filled from category"
              />
            </div>

            {/* Estimated cost */}
            <div>
              <label className="label">Estimated Cost ($)</label>
              <input
                className="input"
                type="number"
                value={form.estimatedCost}
                onChange={e => setForm(f => ({ ...f, estimatedCost: e.target.value }))}
                placeholder="0"
              />
            </div>

            {/* Actual cost */}
            <div>
              <label className="label">Actual Cost ($)</label>
              <input
                className="input"
                type="number"
                value={form.actualCost}
                onChange={e => setForm(f => ({ ...f, actualCost: e.target.value }))}
                placeholder="0"
              />
            </div>

            {/* Dates */}
            <div>
              <label className="label">Start Date</label>
              <input
                className="input"
                type="date"
                value={form.scheduledStart}
                onChange={e => setForm(f => ({ ...f, scheduledStart: e.target.value }))}
              />
            </div>
            <div>
              <label className="label">End Date</label>
              <input
                className="input"
                type="date"
                value={form.scheduledEnd}
                onChange={e => setForm(f => ({ ...f, scheduledEnd: e.target.value }))}
              />
            </div>
          </div>

          {/* Contractors */}
          <div>
            <div className="flex items-center justify-between">
              <label className="label">Contractors</label>
              <Link to="/contractors" className="text-xs text-brand-400 hover:text-brand-300">Manage registry</Link>
            </div>
            {contractors?.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {contractors.map(c => {
                  const active = form.contractorIds.includes(c.id)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleContractor(c.id)}
                      className={`badge transition-colors ${active ? 'bg-brand-600/30 text-brand-300 border border-brand-600/50' : 'bg-slate-800 text-slate-400 border border-slate-700 hover:border-slate-600'}`}
                    >
                      {c.name}{c.trade ? ` · ${c.trade}` : ''}
                    </button>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-slate-500">No contractors yet — <Link to="/contractors" className="text-brand-400 hover:text-brand-300">add one</Link> to tag this project.</p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="label">Notes</label>
            <textarea
              className="input resize-none"
              rows={3}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Contractor ideas, material choices, inspiration links, measurements…"
            />
          </div>

          {/* ROI preview */}
          {valueAdded > 0 && (
            <div className="bg-brand-900/20 border border-brand-800/40 rounded-lg px-4 py-3">
              <p className="text-xs text-brand-400 font-mono">
                Estimated value added to home: <span className="font-bold text-brand-300">
                  +${Math.round(valueAdded).toLocaleString()}
                </span>
                <span className="text-brand-600 ml-2">({form.roiBenchmark}% ROI on ${parseFloat(form.estimatedCost || 0).toLocaleString()})</span>
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2 border-t border-slate-800">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" className="btn-primary">
              {item ? 'Save Changes' : 'Add Project'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
