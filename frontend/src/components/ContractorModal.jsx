import { useState, useEffect } from 'react'
import { X } from 'lucide-react'

const EMPTY = { name: '', company: '', trade: '', phone: '', email: '', website: '', notes: '' }

export default function ContractorModal({ item, onSave, onClose }) {
  const [form, setForm] = useState(EMPTY)

  useEffect(() => {
    setForm(item ? { ...EMPTY, ...item } : EMPTY)
  }, [item])

  const handleSubmit = (e) => {
    e.preventDefault()
    onSave(form)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
          <h2 className="font-display text-2xl tracking-widest uppercase text-slate-100">
            {item ? 'Edit' : 'New'} Contractor
          </h2>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors p-1">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          <div>
            <label className="label">Name *</label>
            <input
              className="input"
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="e.g. Dave Ramirez"
              required
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Company</label>
              <input
                className="input"
                value={form.company}
                onChange={e => setForm(f => ({ ...f, company: e.target.value }))}
                placeholder="e.g. Ramirez Electric"
              />
            </div>
            <div>
              <label className="label">Trade</label>
              <input
                className="input"
                value={form.trade}
                onChange={e => setForm(f => ({ ...f, trade: e.target.value }))}
                placeholder="e.g. Electrician"
              />
            </div>
            <div>
              <label className="label">Phone</label>
              <input
                className="input"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                placeholder="(555) 555-5555"
              />
            </div>
            <div>
              <label className="label">Email</label>
              <input
                className="input"
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="name@example.com"
              />
            </div>
            <div className="col-span-2">
              <label className="label">Website</label>
              <input
                className="input"
                type="url"
                value={form.website}
                onChange={e => setForm(f => ({ ...f, website: e.target.value }))}
                placeholder="https://example.com"
              />
            </div>
          </div>

          <div>
            <label className="label">Notes</label>
            <textarea
              className="input resize-none"
              rows={3}
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              placeholder="License #, past work, rates, reliability notes…"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2 border-t border-slate-800">
            <button type="button" onClick={onClose} className="btn-ghost">Cancel</button>
            <button type="submit" className="btn-primary">
              {item ? 'Save Changes' : 'Add Contractor'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
