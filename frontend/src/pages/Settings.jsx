import { useState, useEffect } from 'react'
import { api } from '../api'
import { fmtCurrency, fmtDate } from '../utils'
import { Save, FileJson, FileText, TrendingUp, PlusCircle, Trash2, Bot, RefreshCw } from 'lucide-react'

export default function Settings() {
  const [settings, setSettings] = useState({ homeValue: '', location: '' })
  const [benchmarks, setBenchmarks] = useState([])
  const [history, setHistory] = useState([])
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(true)
  const [newSnapshot, setNewSnapshot] = useState({ value: '', note: '' })
  const [addingSnapshot, setAddingSnapshot] = useState(false)

  // AI settings
  const [aiStatus, setAiStatus]         = useState(null)
  const [aiModels, setAiModels]         = useState([])
  const [aiModelsLoading, setAiModelsLoading] = useState(false)
  const [aiVisionModel, setAiVisionModel] = useState('')
  const [aiTextModel, setAiTextModel]   = useState('')
  const [aiSaved, setAiSaved]           = useState(false)

  useEffect(() => {
    Promise.all([api.getSettings(), api.getBenchmarks(), api.getHomeValueHistory()])
      .then(([s, b, h]) => {
        setSettings({ homeValue: s.homeValue || '', location: s.location || '' })
        setBenchmarks(b)
        setHistory(h)
      })
      .finally(() => setLoading(false))

    api.aiStatus()
      .then(s => {
        setAiStatus(s)
        setAiVisionModel(s.visionModel || '')
        setAiTextModel(s.textModel || '')
      })
      .catch(() => setAiStatus({ enabled: false }))
  }, [])

  function loadAiModels() {
    setAiModelsLoading(true)
    api.aiModels()
      .then(d => setAiModels(d.models || []))
      .catch(() => setAiModels([]))
      .finally(() => setAiModelsLoading(false))
  }

  async function handleSaveAiConfig() {
    await api.saveAiConfig({ aiVisionModel, aiTextModel })
    setAiStatus(s => ({ ...s, visionModel: aiVisionModel, textModel: aiTextModel }))
    setAiSaved(true)
    setTimeout(() => setAiSaved(false), 2000)
  }

  async function handleSaveSettings(e) {
    e.preventDefault()
    await api.saveSettings(settings)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  async function handleAddSnapshot(e) {
    e.preventDefault()
    const snapshot = await api.addHomeValueSnapshot(newSnapshot)
    setHistory(h => [...h, snapshot])
    setSettings(s => ({ ...s, homeValue: parseFloat(newSnapshot.value) }))
    setNewSnapshot({ value: '', note: '' })
    setAddingSnapshot(false)
  }

  async function handleDeleteSnapshot(id) {
    if (!confirm('Remove this snapshot?')) return
    await api.deleteHomeValueSnapshot(id)
    setHistory(h => h.filter(s => s.id !== id))
  }

  return (
    <div className="p-4 md:p-8 space-y-6 md:space-y-8 max-w-3xl">
      <h1 className="page-title">Settings</h1>

      {/* Home Info */}
      <div className="card space-y-4 md:space-y-5">
        <h2 className="font-display tracking-widest uppercase text-slate-300 text-lg md:text-xl">Home Info</h2>
        <form onSubmit={handleSaveSettings} className="space-y-4">
          <div>
            <label className="label">Current Home Value ($)</label>
            <input className="input max-w-xs" type="number" value={settings.homeValue}
              onChange={e => setSettings(s => ({ ...s, homeValue: e.target.value }))} placeholder="e.g. 450000" />
            <p className="text-xs text-slate-500 mt-1">Used to calculate projected home value after improvements.</p>
          </div>
          <div>
            <label className="label">Location</label>
            <input className="input max-w-xs" value={settings.location}
              onChange={e => setSettings(s => ({ ...s, location: e.target.value }))} placeholder="e.g. Boston, MA" />
          </div>
          <button type="submit" className="btn-primary">
            <Save size={14} />
            {saved ? 'Saved!' : 'Save Settings'}
          </button>
        </form>
      </div>

      {/* AI Configuration */}
      <div className="card space-y-4 md:space-y-5">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-amber-400" />
          <h2 className="font-display tracking-widest uppercase text-slate-300 text-lg md:text-xl">AI</h2>
          <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-mono ${
            aiStatus?.enabled
              ? 'bg-emerald-900/40 text-emerald-400 border border-emerald-800/40'
              : 'bg-slate-800 text-slate-500 border border-slate-700'
          }`}>
            {aiStatus === null ? '…' : aiStatus.enabled ? 'enabled' : 'disabled'}
          </span>
        </div>

        {aiStatus?.enabled ? (
          <div className="space-y-4">
            <p className="text-sm text-slate-500">
              Select which models to use for nameplate scanning. Models are loaded from your LiteLLM endpoint.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Vision Model</label>
                <div className="flex gap-2">
                  <select
                    className="input flex-1"
                    value={aiVisionModel}
                    onChange={e => setAiVisionModel(e.target.value)}
                  >
                    {aiVisionModel && !aiModels.includes(aiVisionModel) && (
                      <option value={aiVisionModel}>{aiVisionModel}</option>
                    )}
                    {aiModels.length === 0 && <option value="">— load models —</option>}
                    {aiModels.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <p className="text-xs text-slate-600 mt-1">Used for nameplate photo reading</p>
              </div>

              <div>
                <label className="label">Text Model</label>
                <select
                  className="input w-full"
                  value={aiTextModel}
                  onChange={e => setAiTextModel(e.target.value)}
                >
                  {aiTextModel && !aiModels.includes(aiTextModel) && (
                    <option value={aiTextModel}>{aiTextModel}</option>
                  )}
                  {aiModels.length === 0 && <option value="">— load models —</option>}
                  {aiModels.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <p className="text-xs text-slate-600 mt-1">Reserved for future text-based AI features</p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button className="btn-primary" onClick={handleSaveAiConfig}>
                <Save size={14} />
                {aiSaved ? 'Saved!' : 'Save AI Config'}
              </button>
              <button
                className="btn-ghost flex items-center gap-1.5"
                onClick={loadAiModels}
                disabled={aiModelsLoading}
              >
                <RefreshCw size={13} className={aiModelsLoading ? 'animate-spin' : ''} />
                {aiModelsLoading ? 'Loading…' : 'Load models from LiteLLM'}
              </button>
            </div>
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Set <code className="text-slate-400 bg-slate-800 px-1 rounded">AI_ENABLED=true</code> and <code className="text-slate-400 bg-slate-800 px-1 rounded">AI_BASE_URL</code> in your <code className="text-slate-400 bg-slate-800 px-1 rounded">.env</code> to enable AI features.
          </p>
        )}
      </div>

      {/* Home Value History */}
      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-display tracking-widest uppercase text-slate-300 text-lg md:text-xl">Value History</h2>
          <button className="btn-primary" onClick={() => setAddingSnapshot(v => !v)}>
            <PlusCircle size={14} /> Log Value
          </button>
        </div>
        <p className="text-sm text-slate-500">
          Periodically log your estimated home value. Dashboard warns after 60 days without an update.
        </p>

        {addingSnapshot && (
          <form onSubmit={handleAddSnapshot} className="bg-slate-800/50 border border-slate-700 rounded-xl p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Home Value ($) *</label>
                <input className="input" type="number" required value={newSnapshot.value}
                  onChange={e => setNewSnapshot(s => ({ ...s, value: e.target.value }))} placeholder="e.g. 465000" />
              </div>
              <div>
                <label className="label">Note (optional)</label>
                <input className="input" value={newSnapshot.note}
                  onChange={e => setNewSnapshot(s => ({ ...s, note: e.target.value }))} placeholder="e.g. Zillow estimate" />
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn-primary">Save Snapshot</button>
              <button type="button" className="btn-ghost" onClick={() => setAddingSnapshot(false)}>Cancel</button>
            </div>
          </form>
        )}

        {loading ? <p className="text-slate-600 text-sm">Loading…</p>
          : history.length === 0 ? <p className="text-slate-600 text-sm">No snapshots yet.</p>
          : (
            <div className="space-y-1">
              {[...history].reverse().map((s, i) => (
                <div key={s.id} className="flex items-center justify-between py-2 border-b border-slate-800 last:border-0 group">
                  <div className="flex items-center gap-2 md:gap-3 min-w-0">
                    {i === 0 && <span className="badge bg-brand-900/40 text-brand-400 border border-brand-800/40 shrink-0">Latest</span>}
                    <span className="text-slate-200 font-medium font-mono text-sm">{fmtCurrency(s.value)}</span>
                    {s.note && <span className="text-slate-500 text-xs truncate hidden sm:inline">— {s.note}</span>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-slate-500">{fmtDate(s.createdAt)}</span>
                    <button className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-900/40 text-slate-500 hover:text-red-400 transition-all"
                      onClick={() => handleDeleteSnapshot(s.id)}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
      </div>

      {/* Export */}
      <div className="card space-y-4">
        <h2 className="font-display tracking-widest uppercase text-slate-300 text-lg md:text-xl">Export Data</h2>
        <p className="text-sm text-slate-500">Download a full copy of your data. Stored only on your server.</p>
        <div className="flex gap-3 flex-wrap">
          <button className="btn-ghost" onClick={api.exportJSON}><FileJson size={15} /> Export JSON</button>
          <button className="btn-ghost" onClick={api.exportCSV}><FileText size={15} /> Export CSV</button>
        </div>
      </div>

      {/* ROI Reference */}
      <div className="card space-y-4">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-brand-400" />
          <h2 className="font-display tracking-widest uppercase text-slate-300 text-lg md:text-xl">ROI Benchmarks</h2>
        </div>
        <p className="text-sm text-slate-500">National averages from Remodeling Magazine Cost vs. Value Report. Auto-applied when selecting a project category.</p>
        {loading ? <p className="text-slate-600 text-sm">Loading…</p> : (
          <div className="overflow-x-auto -mx-2 px-2">
            <table className="w-full text-sm min-w-[320px]">
              <thead>
                <tr className="border-b border-slate-800">
                  <th className="text-left py-2 pr-4 text-xs uppercase tracking-wider text-slate-500 font-medium">Project Type</th>
                  <th className="text-right py-2 pr-4 text-xs uppercase tracking-wider text-slate-500 font-medium">Avg Cost</th>
                  <th className="text-right py-2 text-xs uppercase tracking-wider text-slate-500 font-medium">ROI %</th>
                </tr>
              </thead>
              <tbody>
                {benchmarks.map(b => (
                  <tr key={b.id} className="border-b border-slate-800/50 hover:bg-slate-800/30 transition-colors">
                    <td className="py-2 pr-4">
                      <div className="text-slate-300 text-xs md:text-sm">{b.label}</div>
                      {b.notes && <div className="text-xs text-slate-600 hidden md:block">{b.notes}</div>}
                    </td>
                    <td className="py-2 pr-4 text-right text-slate-400 font-mono text-xs">{fmtCurrency(b.avgCost)}</td>
                    <td className="py-2 text-right">
                      <span className={`font-mono text-sm font-medium ${b.roiPercent >= 100 ? 'text-brand-400' : b.roiPercent >= 70 ? 'text-slate-300' : 'text-slate-500'}`}>
                        {b.roiPercent}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
