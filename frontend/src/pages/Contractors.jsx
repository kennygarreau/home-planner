import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Search, Phone, Mail, Globe } from 'lucide-react'
import { api } from '../api'
import ContractorModal from '../components/ContractorModal'

const withProtocol = (url) => /^https?:\/\//i.test(url) ? url : `https://${url}`

export default function Contractors() {
  const [contractors, setContractors] = useState([])
  const [modal, setModal] = useState(null)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)

  const load = () => api.getContractors().then(setContractors).finally(() => setLoading(false))

  useEffect(() => { load() }, [])

  const handleSave = async (form) => {
    if (modal?.id) await api.updateContractor(modal.id, form)
    else await api.createContractor(form)
    setModal(null)
    load()
  }

  const handleDelete = async (id) => {
    if (!confirm('Remove this contractor? This will untag them from any projects.')) return
    await api.deleteContractor(id)
    load()
  }

  const filtered = contractors.filter(c =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.company.toLowerCase().includes(search.toLowerCase()) ||
    c.trade.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Contractors</h1>
          <p className="text-slate-500 text-sm mt-1">Your registry of contractors and trades</p>
        </div>
        <button className="btn-primary" onClick={() => setModal({})}>
          <Plus size={16} /> <span className="hidden sm:inline">New Contractor</span><span className="sm:hidden">New</span>
        </button>
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
        <input className="input pl-9" placeholder="Search by name, company, or trade…" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className="text-slate-500 text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-16">
          <p className="text-slate-500 mb-3">No contractors yet — add your first one!</p>
          <button className="btn-primary mx-auto" onClick={() => setModal({})}>
            <Plus size={16} /> Add your first contractor
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(c => (
            <div key={c.id} className="card hover:border-slate-700 transition-colors">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-start gap-2 justify-between">
                    <div>
                      <p className="text-slate-100 font-medium text-sm leading-snug">{c.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {[c.trade, c.company].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    {c._count?.projects > 0 && (
                      <span className="badge shrink-0 bg-slate-700 text-slate-400">
                        {c._count.projects} project{c._count.projects === 1 ? '' : 's'}
                      </span>
                    )}
                  </div>
                  {(c.phone || c.email || c.website) && (
                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-500 flex-wrap">
                      {c.phone && <span className="flex items-center gap-1"><Phone size={11} /> {c.phone}</span>}
                      {c.email && <span className="flex items-center gap-1"><Mail size={11} /> {c.email}</span>}
                      {c.website && (
                        <a
                          href={withProtocol(c.website)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 hover:text-brand-400 transition-colors"
                        >
                          <Globe size={11} /> {c.website.replace(/^https?:\/\//i, '')}
                        </a>
                      )}
                    </div>
                  )}
                  {c.notes && <p className="text-xs text-slate-500 mt-2 truncate">{c.notes}</p>}
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors" onClick={() => setModal(c)}>
                    <Pencil size={15} />
                  </button>
                  <button className="p-1.5 rounded hover:bg-red-900/40 text-slate-400 hover:text-red-400 transition-colors" onClick={() => handleDelete(c.id)}>
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal !== null && (
        <ContractorModal
          item={modal?.id ? modal : null}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
