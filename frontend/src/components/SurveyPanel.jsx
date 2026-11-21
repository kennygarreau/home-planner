import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Laptop, RefreshCw, Trash2, X, Loader2, AlertTriangle, Download, CheckCircle2 } from 'lucide-react'
import { api } from '../api'
import { SIGNAL_CLASSES, signalClass, pointSignal, ACTIVE_STATUSES } from '../floorplan/survey'

export const SURVEY_TYPES = {
  baseline: 'Baseline (current network)',
  ap_on_a_stick: 'AP-on-a-stick test',
  validation: 'Validation (after install)',
}

const fmt = (v, unit, digits = 0) => (v == null ? '—' : `${Number(v).toFixed(digits)} ${unit}`)

function Row({ label, value, mono = true }) {
  return (
    <div className="flex justify-between gap-3 text-xs py-0.5">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className={`text-slate-200 text-right truncate ${mono ? 'font-mono' : ''}`}>{value}</span>
    </div>
  )
}

function SignalChip({ dbm }) {
  const c = signalClass(dbm)
  if (!c) return <span className="text-slate-500">—</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full" style={{ background: c.color }} />
      <span className="font-mono">{Math.round(dbm)} dBm</span>
      <span className="text-slate-500">{c.label}</span>
    </span>
  )
}

function useAgentManifest() {
  const [m, setM] = useState(null)
  useEffect(() => {
    fetch('/downloads/wifi-survey.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then(setM).catch(() => {})
  }, [])
  return m
}

function SurveyPicker({ surveyId, onChange }) {
  const [surveys, setSurveys] = useState(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [type, setType] = useState('baseline')

  const load = () => api.getSurveys().then(setSurveys).catch(() => setSurveys([]))
  useEffect(() => { load() }, [surveyId])

  const create = async () => {
    const s = await api.createSurvey({ name: name.trim() || `${SURVEY_TYPES[type].split(' (')[0]} ${new Date().toLocaleDateString()}`, type })
    setCreating(false)
    setName('')
    await load()
    onChange(s.id)
  }

  if (surveys === null) return <div className="card text-xs text-slate-500">Loading surveys…</div>

  if (creating || !surveys.length) {
    return (
      <div className="card space-y-3">
        <h3 className="text-sm font-semibold text-slate-200">New survey</h3>
        <div>
          <label className="label">Type</label>
          <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
            {Object.entries(SURVEY_TYPES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)}
            placeholder={`${SURVEY_TYPES[type].split(' (')[0]} ${new Date().toLocaleDateString()}`} />
        </div>
        <div className="flex gap-2">
          <button className="btn-primary flex-1 justify-center" onClick={create}><Plus size={14} /> Start survey</button>
          {surveys.length > 0 && <button className="btn-ghost" onClick={() => setCreating(false)}>Cancel</button>}
        </div>
      </div>
    )
  }

  return (
    <div className="card space-y-2">
      <label className="label">Survey</label>
      <div className="flex gap-2">
        <select className="input" value={surveyId ?? ''} onChange={(e) => onChange(e.target.value)}>
          {!surveyId && <option value="">Choose…</option>}
          {surveys.map((s) => (
            <option key={s.id} value={s.id}>{s.name} · {s.donePoints} pts</option>
          ))}
        </select>
        <button className="btn-ghost !px-3 shrink-0" title="New survey" onClick={() => setCreating(true)}><Plus size={14} /></button>
      </div>
    </div>
  )
}

function AgentStatus({ agents, manifest }) {
  const online = agents.filter((a) => a.online)
  if (!online.length) {
    return (
      <div className="card border-amber-800/40 bg-amber-950/20 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-amber-300">
          <Laptop size={15} /> No laptop agent connected
        </div>
        <p className="text-xs text-slate-400">
          On the survey laptop run <code className="text-slate-300">wifi-survey agent</code>.
          New laptop? Get it from <Link to="/tools" className="text-brand-400 hover:underline">Tools → Wi-Fi Survey</Link>.
        </p>
      </div>
    )
  }
  return (
    <div className="card space-y-2">
      {online.map((a) => {
        const outdated = manifest && a.version && manifest.version !== a.version
        return (
          <div key={a.agentId} className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-slate-200">
              <span className="w-2 h-2 rounded-full bg-brand-500 shadow-[0_0_6px] shadow-brand-500" />
              <Laptop size={14} className="text-slate-400" />
              <span className="font-medium truncate">{a.hostname ?? 'laptop'}</span>
              <span className="text-xs text-slate-500 font-mono ml-auto">{a.interface}</span>
            </div>
            <div className="text-xs text-slate-500 pl-6">
              v{a.version}
              {a.capabilities?.bands && ` · ${a.capabilities.bands.join(' / ')} GHz`}
              {a.capabilities?.eht && ' · Wi-Fi 7'}
              {a.capabilities && !a.capabilities.six_ghz_channels && ' · no 6 GHz'}
            </div>
            {outdated && (
              <div className="text-xs text-amber-400 pl-6">
                Update available (v{manifest.version}) — <Link to="/tools" className="underline">download</Link>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ActiveJob({ point, onCancel }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])
  const since = new Date(point.startedAt ?? point.queuedAt).getTime()
  const secs = Math.max(0, Math.round((now - since) / 1000))
  return (
    <div className="card border-brand-700/40 bg-brand-900/10 space-y-2">
      <div className="flex items-center gap-2">
        <Loader2 size={15} className="animate-spin text-brand-400" />
        <span className="text-sm font-medium text-slate-200">Measuring {point.label}</span>
        <span className="ml-auto text-xs font-mono text-slate-500">{secs}s</span>
      </div>
      <p className="text-xs text-slate-400">
        {point.status === 'queued' ? 'Waiting for the laptop to pick it up…' : point.progress?.message ?? 'Working…'}
      </p>
      <p className="text-xs text-slate-500">Hold still at about 1 m until it finishes (about 30 s).</p>
      <button className="btn-ghost w-full justify-center !py-1.5" onClick={onCancel}><X size={14} /> Cancel</button>
    </div>
  )
}

function PointDetails({ point, busy, onRemeasure, onDelete, onClose }) {
  const r = point.record
  const c = r?.connected
  const t = r?.throughput
  const l = r?.latency
  const bands = ['2.4', '5', '6'].map((b) => [b, (r?.scan ?? []).filter((e) => e.band === b)]).filter(([, l]) => l.length)
  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-slate-200 truncate">{point.label}</h3>
        <button className="text-slate-500 hover:text-slate-200" onClick={onClose}><X size={15} /></button>
      </div>
      {point.error && (
        <div className="flex items-start gap-2 text-xs text-amber-300">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> <span>{point.error}</span>
        </div>
      )}
      {r ? (
        <>
          <div>
            <Row label="Signal" mono={false} value={<SignalChip dbm={pointSignal(r)} />} />
            {c ? (
              <>
                <Row label="Connected to" value={`${c.band} GHz · ch ${c.channel} · ${c.width_mhz} MHz`} />
                <Row label="Network" value={c.ssid ?? '—'} />
                <Row label="Link rate ↓/↑" value={`${fmt(c.rx_bitrate_mbps, '')}/ ${fmt(c.tx_bitrate_mbps, 'Mbps')}`} />
                {c.phy_mode && <Row label="Mode" value={`${c.phy_mode}${c.nss ? ` · ${c.nss}×${c.nss}` : ''}`} />}
              </>
            ) : <Row label="Connected to" value="not connected" />}
          </div>
          <div className="border-t border-slate-800 pt-2">
            <Row label="Download" value={fmt(t?.down_mbps, 'Mbps')} />
            <Row label="Upload" value={fmt(t?.up_mbps, 'Mbps')} />
            <Row label={`Latency (${l?.target ?? '—'})`} value={l?.avg_ms != null ? `${l.avg_ms.toFixed(1)} ms · p95 ${l.p95_ms?.toFixed(1)}` : '—'} />
            {l && <Row label="Jitter / loss" value={`${fmt(l.jitter_ms, 'ms', 1)} · ${l.loss_pct}%`} />}
          </div>
          {bands.length > 0 && (
            <div className="border-t border-slate-800 pt-2 space-y-1">
              <div className="text-xs text-slate-500">Strongest networks seen</div>
              {bands.map(([b, list]) => (
                <div key={b} className="text-xs">
                  <span className="text-slate-400">{b} GHz</span>
                  {list.slice(0, 3).map((e) => (
                    <div key={e.bssid} className="flex justify-between pl-2 font-mono text-slate-300">
                      <span className="truncate">{e.ssid ?? '(hidden)'} · ch {e.channel}</span>
                      <span>{Math.round(e.signal_dbm)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
          {r.warnings?.length > 0 && (
            <ul className="text-xs text-amber-400/90 list-disc pl-4 space-y-0.5">
              {r.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          <p className="text-xs text-slate-600">{new Date(point.measuredAt ?? r.timestamp).toLocaleString()}</p>
        </>
      ) : (
        <p className="text-xs text-slate-500">No measurement yet ({point.status}).</p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <button className="btn-ghost justify-center !px-2 disabled:opacity-40" disabled={busy} onClick={onRemeasure}>
          <RefreshCw size={14} /> Measure again
        </button>
        <button className="btn-danger justify-center !px-2" onClick={onDelete}><Trash2 size={14} /> Delete</button>
      </div>
    </div>
  )
}

function RoomProgress({ suggestions, points }) {
  const done = new Set(points.filter((p) => p.record).map((p) => p.label))
  const groups = []
  for (const s of suggestions) {
    let g = groups.find((x) => x.name === s.roomName)
    if (!g) groups.push((g = { name: s.roomName, total: 0, done: 0 }))
    g.total++
    if (done.has(s.key)) g.done++
  }
  const total = suggestions.length
  const finished = suggestions.filter((s) => done.has(s.key)).length
  if (!total) {
    return <div className="card text-xs text-slate-500">Draw rooms on this floor to get suggested measurement spots.</div>
  }
  return (
    <div className="card space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-semibold text-slate-200">This floor</span>
        <span className="text-xs font-mono text-slate-400">{finished}/{total} spots</span>
      </div>
      <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
        <div className="h-full bg-brand-500 transition-all" style={{ width: `${(finished / total) * 100}%` }} />
      </div>
      <div className="space-y-1 pt-1">
        {groups.map((g) => (
          <div key={g.name} className="flex items-center justify-between text-xs">
            <span className="text-slate-400 truncate">{g.name}</span>
            <span className={`font-mono flex items-center gap-1 ${g.done === g.total ? 'text-brand-400' : 'text-slate-500'}`}>
              {g.done === g.total && <CheckCircle2 size={12} />}{g.done}/{g.total}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SurveyPanel({
  surveyId, onSurveyChange, state, suggestions, floorPoints, selectedPoint, onSelectPoint, message, onAction,
}) {
  const manifest = useAgentManifest()
  const active = state.points.find((p) => ACTIVE_STATUSES.includes(p.status))
  return (
    <>
      <SurveyPicker surveyId={surveyId} onChange={onSurveyChange} />
      {surveyId && (
        <>
          <AgentStatus agents={state.agents} manifest={manifest} />
          {message && (
            <div className="rounded-lg border border-amber-800/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">{message}</div>
          )}
          {active && <ActiveJob point={active} onCancel={() => onAction('cancel', active)} />}
          {selectedPoint && (
            <PointDetails
              point={selectedPoint}
              busy={!!active}
              onRemeasure={() => onAction('remeasure', selectedPoint)}
              onDelete={() => onAction('delete', selectedPoint)}
              onClose={() => onSelectPoint(null)}
            />
          )}
          <RoomProgress suggestions={suggestions} points={floorPoints} />
          <div className="card space-y-1.5">
            <div className="text-xs text-slate-500 mb-1">Signal at each point</div>
            {SIGNAL_CLASSES.map((c) => (
              <div key={c.key} className="flex items-center gap-2 text-xs">
                <span className="w-3 h-3 rounded-full shrink-0" style={{ background: c.color }} />
                <span className="text-slate-300 w-16">{c.label}</span>
                <span className="text-slate-500">{c.note}</span>
              </div>
            ))}
            <p className="text-xs text-slate-600 pt-1">Connected AP's signal, or the strongest network seen if not connected.</p>
          </div>
          <div className="card text-xs space-y-1">
            <div className="text-slate-500 mb-1">Data for the analysis tools</div>
            {[
              [`/api/surveys/${surveyId}/points.jsonl?download=1`, 'points.jsonl'],
              [`/api/surveys/${surveyId}/meta.json`, 'meta.json'],
              ['/api/floorplans/export/wifi?download=1', 'floorplan.json'],
            ].map(([href, label]) => (
              <a key={label} href={href} className="flex items-center gap-2 text-brand-400 hover:underline">
                <Download size={12} /> {label}
              </a>
            ))}
          </div>
        </>
      )}
    </>
  )
}
