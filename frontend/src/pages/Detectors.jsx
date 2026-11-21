import { useState, useEffect } from 'react'
import { Plus, Pencil, Trash2, Siren, AlertTriangle, BatteryCharging, Info } from 'lucide-react'
import { api } from '../api'
import { fmtDate } from '../utils'
import DetectorModal, { DETECTOR_TYPES } from '../components/DetectorModal'

const DUE_SOON_DAYS = 90

function replaceStatus(replaceByDate) {
  if (!replaceByDate) return null
  const days = Math.floor((new Date(replaceByDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  if (days < 0) return { label: 'Overdue', className: 'bg-red-900/50 text-red-300 border border-red-800/50' }
  if (days <= DUE_SOON_DAYS) return { label: `Due in ${days}d`, className: 'bg-amber-900/50 text-amber-300 border border-amber-800/50' }
  return { label: 'OK', className: 'bg-green-900/50 text-green-300 border border-green-800/50' }
}

export default function Detectors() {
  const [detectors, setDetectors] = useState([])
  const [modal, setModal] = useState(null)
  const [loading, setLoading] = useState(true)

  const load = () => api.getDetectors().then(setDetectors).finally(() => setLoading(false))

  useEffect(() => { load() }, [])

  const handleSave = async (form) => {
    if (modal?.id) await api.updateDetector(modal.id, form)
    else await api.createDetector(form)
    setModal(null)
    load()
  }

  const handleDelete = async (id) => {
    if (!confirm('Remove this detector?')) return
    await api.deleteDetector(id)
    load()
  }

  const sorted = [...detectors].sort((a, b) => {
    if (!a.replaceByDate) return 1
    if (!b.replaceByDate) return -1
    return new Date(a.replaceByDate) - new Date(b.replaceByDate)
  })

  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Detectors</h1>
          <p className="text-slate-500 text-sm mt-1">Smoke &amp; CO detector locations and replacement schedule</p>
        </div>
        <button className="btn-primary" onClick={() => setModal({})}>
          <Plus size={16} /> <span className="hidden sm:inline">New Detector</span><span className="sm:hidden">New</span>
        </button>
      </div>

      <div className="card bg-blue-950/20 border-blue-800/40">
        <div className="flex items-start gap-3">
          <Info size={16} className="text-blue-400 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-slate-400 space-y-2">
            <p>
              <span className="text-slate-200 font-medium">Smoke detectors:</span> Install an alarm on every level of the home, outside each sleeping area, and inside every bedroom.
            </p>
            <p>
              <span className="text-slate-200 font-medium">CO detectors:</span> The law requires carbon monoxide alarms to be installed on every level of your home, including habitable portions of basements and attics, in most residences. On levels with sleeping areas, carbon monoxide alarms should be installed within 10 feet of bedroom doors.
            </p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-slate-500 text-sm">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="card text-center py-16">
          <Siren size={28} className="mx-auto text-slate-600 mb-3" />
          <p className="text-slate-500 mb-3">No detectors logged yet — add your first one!</p>
          <button className="btn-primary mx-auto" onClick={() => setModal({})}>
            <Plus size={16} /> Add your first detector
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {sorted.map(d => {
            const status = replaceStatus(d.replaceByDate)
            return (
              <div key={d.id} className="card hover:border-slate-700 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2 justify-between">
                      <div>
                        <p className="text-slate-100 font-medium text-sm leading-snug">{d.location}</p>
                        <p className="text-xs text-slate-500 mt-0.5">{DETECTOR_TYPES[d.type] || d.type}</p>
                      </div>
                      {status && (
                        <span className={`badge shrink-0 flex items-center gap-1 ${status.className}`}>
                          {status.label === 'Overdue' && <AlertTriangle size={11} />}
                          {status.label}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-4 mt-2 text-xs text-slate-500 flex-wrap">
                      {d.installedAt && <span>Installed {fmtDate(d.installedAt)}</span>}
                      {d.replaceByDate && <span>Replace by {fmtDate(d.replaceByDate)}</span>}
                      {d.batteryType && <span className="flex items-center gap-1"><BatteryCharging size={11} /> {d.batteryType}</span>}
                    </div>
                    {d.notes && <p className="text-xs text-slate-500 mt-2 truncate">{d.notes}</p>}
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-slate-200 transition-colors" onClick={() => setModal(d)}>
                      <Pencil size={15} />
                    </button>
                    <button className="p-1.5 rounded hover:bg-red-900/40 text-slate-400 hover:text-red-400 transition-colors" onClick={() => handleDelete(d.id)}>
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {modal !== null && (
        <DetectorModal
          item={modal?.id ? modal : null}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  )
}
