import { useState, useEffect } from 'react'
import { X } from 'lucide-react'

const EMPTY = { type: 'smoke', location: '', installedAt: '', replaceByDate: '', batteryType: '', notes: '' }

export const DETECTOR_TYPES = { smoke: 'Smoke', co: 'Carbon Monoxide', combo: 'Smoke + CO Combo' }

export const POWER_SOURCES = ['Hardwired', 'Hardwired + 10-year Battery', '10-year Battery']

// Typical manufacturer-recommended replacement intervals
const LIFESPAN_YEARS = { smoke: 10, co: 7, combo: 10 }

function addYears(dateStr, years) {
  const d = new Date(dateStr)
  d.setFullYear(d.getFullYear() + years)
  return d.toISOString().substring(0, 10)
}

export default function DetectorModal({ item, onSave, onClose }) {
  const [form, setForm] = useState(EMPTY)

  useEffect(() => {
    if (item) {
      setForm({
        ...EMPTY,
        ...item,
        installedAt: item.installedAt ? item.installedAt.substring(0, 10) : '',
        replaceByDate: item.replaceByDate ? item.replaceByDate.substring(0, 10) : '',
      })
    } else {
      setForm(EMPTY)
    }
  }, [item])

  const handleInstalledChange = (value) => {
    setForm(f => ({
      ...f,
      installedAt: value,
      // only auto-fill if the user hasn't already set a replace date
      replaceByDate: f.replaceByDate || (value ? addYears(value, LIFESPAN_YEARS[f.type] || 10) : ''),
    }))
  }

  const handleTypeChange = (type) => {
    setForm(f => ({
      ...f,
      type,
      replaceByDate: f.installedAt && !f.replaceByDate ? addYears(f.installedAt, LIFESPAN_YEARS[type] || 10) : f.replaceByDate,
    }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    onSave(form)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
          <h2 className="font-display text-2xl tracking-widest uppercase text-slate-100">
            {item ? 'Edit' : 'New'} Detector
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors p-1">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Type</label>
              <select className="input" value={form.type} onChange={e => handleTypeChange(e.target.value)}>
                {Object.entries(DETECTOR_TYPES).map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Location *</label>
              <input
                className="input"
                value={form.location}
                onChange={e => setForm(f => ({ ...f, location: e.target.value }))}
                placeholder="e.g. Hallway, 2nd floor"
                required
                autoFocus
              />
            </div>
            <div>
              <label className="label">Install Date</label>
              <input
                className="input"
                type="date"
                value={form.installedAt}
                onChange={e => handleInstalledChange(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Replace By</label>
              <input
                className="input"
                type="date"
                value={form.replaceByDate}
                onChange={e => setForm(f => ({ ...f, replaceByDate: e.target.value }))}
              />
              <p className="text-xs text-slate-500 mt-1">Auto-suggested from install date, editable</p>
            </div>
            <div className="col-span-2">
              <label className="label">Power Source</label>
              <select className="input" value={form.batteryType} onChange={e => setForm(f => ({ ...f, batteryType: e.target.value }))}>
                <option value="">— Select —</option>
                {POWER_SOURCES.map(v => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea
              className="input resize-none"
              rows={3}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="Model number, brand, mounting notes…"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-slate-800">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" className="btn-primary">
              {item ? 'Save Changes' : 'Add Detector'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
