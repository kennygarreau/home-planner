import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Laptop, RefreshCw, Trash2, X, Loader2, AlertTriangle, Download, CheckCircle2, Activity, Router } from 'lucide-react'
import { api } from '../api'
import { SIGNAL_CLASSES, signalClass, pointSignal, ACTIVE_STATUSES } from '../floorplan/survey'
import { WALL_MATERIALS, FLOOR_STRUCTURES } from '../floorplan/geometry'
import { exportReport } from '../floorplan/exportReport'

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

const MATERIAL_LABEL = (key) => {
  const [kind, name] = key.split(':')
  if (kind === 'wall') return WALL_MATERIALS[name]?.label ?? name
  if (kind === 'slab') return `Floor: ${FLOOR_STRUCTURES[name] ?? name}`
  return { wood_door: 'Doors', glass: 'Windows' }[name] ?? name
}

const GRADE_COLOR = { A: 'text-brand-400', B: 'text-brand-300', C: 'text-amber-300', D: 'text-orange-400', F: 'text-red-400' }

export const AP_MODELS = {
  tplink_eap772: 'TP-Link EAP772 (2.5 GbE, PoE+)',
  tplink_eap773: 'TP-Link EAP773 "Pro X" (10 GbE)',
}

function PlacementCard({ plan, busy, error, onPlan, apModel, onApModel, selected, onSelect, showPlan, onShowPlan, canPlan }) {
  const opt = plan?.options?.[selected]
  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200"><Router size={15} /> New AP placement</h3>
        <button className="btn-ghost !py-1 !px-2.5 text-xs disabled:opacity-40" disabled={busy || !canPlan} onClick={onPlan}
          title={canPlan ? '' : 'Analyse the survey first'}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {plan ? 'Re-plan' : 'Plan'}
        </button>
      </div>
      <select className="input !py-1.5 text-xs" value={apModel} onChange={(e) => onApModel(e.target.value)}>
        {Object.entries(AP_MODELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {!plan && !error && (
        <p className="text-xs text-slate-500">
          Uses the calibrated model to find the best ceiling spots for 1-4 new APs, with a channel plan.
        </p>
      )}
      {plan && (
        <>
          <div className="space-y-1">
            {plan.options.map((o, i) => (
              <button key={o.n_aps} onClick={() => onSelect(i)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md border text-xs text-left ${i === selected
                  ? 'border-brand-600/50 bg-brand-600/15 text-slate-100' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}>
                <span className="font-medium">{o.n_aps} AP{o.n_aps > 1 ? 's' : ''}</span>
                {i === plan.recommended && <span className="px-1.5 rounded bg-brand-600/30 text-brand-300 text-[10px] uppercase tracking-wide">Recommended</span>}
                <span className="ml-auto font-mono">5 GHz {(o.coverage['5'] * 100).toFixed(0)}% · 6 GHz {o.coverage['6'] != null ? `${(o.coverage['6'] * 100).toFixed(0)}%` : '—'}</span>
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
            <input type="checkbox" className="accent-brand-500" checked={showPlan} onChange={(e) => onShowPlan(e.target.checked)} />
            Show on floor plan (predicted heatmap + AP spots)
          </label>
          {opt && (
            <>
              <div className="border-t border-slate-800 pt-2 space-y-2">
                {opt.aps.map((ap, k) => (
                  <div key={k} className="text-xs">
                    <div className="flex justify-between text-slate-200">
                      <span>AP {k + 1} · {ap.floor}</span><span className="text-slate-400 truncate ml-2">{ap.room}</span>
                    </div>
                    <div className="font-mono text-slate-500">
                      5 GHz {ap.channels['5'].block}{ap.channels['5'].dfs ? ' (DFS)' : ''} · 6 GHz ch {ap.channels['6'].channel}/160 · 2.4 ch {ap.channels['2.4'].channel}
                    </div>
                  </div>
                ))}
              </div>
              <div className="border-t border-slate-800 pt-2">
                <div className="grid grid-cols-[minmax(0,1fr)_2.75rem_1rem_3.75rem_3.5rem] items-center gap-x-1 text-xs">
                  <span className="text-slate-500 pb-1">Room</span>
                  <span className="text-slate-500 pb-1 text-center">Today</span>
                  <span />
                  <span className="text-slate-500 pb-1 text-center">Predicted</span>
                  <span className="text-slate-500 pb-1 text-right">5 GHz</span>
                  {opt.rooms.map((r) => (
                    <div key={r.room_id} className="contents">
                      <span className="text-slate-300 truncate py-0.5" title={`${r.floor} · ${r.name}`}>{r.name}</span>
                      <span className={`text-center font-semibold ${GRADE_COLOR[r.baseline_grade] ?? 'text-slate-600'}`}>
                        {r.baseline_grade ?? '–'}
                      </span>
                      <span className="text-center text-slate-600">→</span>
                      <span className={`text-center font-semibold ${GRADE_COLOR[r.grade]}`}>{r.grade}</span>
                      <span className="text-right font-mono tabular-nums text-slate-400">{Math.round(r.median_dbm['5'])} dBm</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
          {plan.warnings?.length > 0 && (
            <ul className="text-xs text-amber-400/90 list-disc pl-4 space-y-0.5">
              {plan.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          <p className="text-xs text-slate-600">
            Planned at {plan.ap_model.planning_eirp_dbm['5']} dBm EIRP (client-matched power) with a {plan.design_margin_db} dB
            margin for model error. Test the top spot with one AP before mounting (spec step 6).
          </p>
        </>
      )}
    </div>
  )
}

function AnalysisCard({ analysis, busy, error, onAnalyze, show, onShow, band, onBand, donePoints, bands: bandOverride }) {
  const bands = bandOverride ?? (analysis ? Object.keys(analysis.bands).sort() : [])
  return (
    <div className="card space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200"><Activity size={15} /> Coverage model</h3>
        <button className="btn-ghost !py-1 !px-2.5 text-xs disabled:opacity-40" disabled={busy || !donePoints} onClick={onAnalyze}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} {analysis ? 'Re-run' : 'Analyse'}
        </button>
      </div>
      {error && <p className="text-xs text-red-400">{error}</p>}
      {!analysis && !error && (
        <p className="text-xs text-slate-500">
          Fits a wall-by-wall signal model to your {donePoints} measurements and draws a heatmap of the whole floor.
        </p>
      )}
      {analysis && (
        <>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input type="checkbox" className="accent-brand-500" checked={show} onChange={(e) => onShow(e.target.checked)} />
              Heatmap
            </label>
            <div className="ml-auto flex gap-1">
              {bands.map((b) => (
                <button key={b} onClick={() => onBand(b)}
                  className={`px-2 py-0.5 rounded text-xs border ${band === b ? 'bg-brand-600/25 text-brand-300 border-brand-600/40' : 'border-slate-700 text-slate-400'}`}>
                  {b} GHz
                </button>
              ))}
            </div>
          </div>
          {analysis.rooms?.length > 0 && (
            <div className="flex flex-wrap gap-1 pt-1">
              {analysis.rooms.map((r) => (
                <span key={r.room_id} title={`${r.name}: ${r.issues.join('; ') || 'meets target'}`}
                  className="px-1.5 py-0.5 rounded bg-slate-800 text-[11px]">
                  <span className={`font-semibold ${GRADE_COLOR[r.grade]}`}>{r.grade}</span>
                  <span className="text-slate-400"> {r.name}</span>
                </span>
              ))}
            </div>
          )}
          {analysis.bands[band] && (() => {
            const b = analysis.bands[band]
            const good = b.rmse_db <= 6
            return (
              <div className="space-y-2">
                <Row label="Readings" value={b.n_obs} />
                <Row label="Model error (RMSE)" mono={false}
                  value={<span className={`font-mono ${good ? 'text-brand-400' : 'text-amber-400'}`}>{b.rmse_db} dB {good ? '✓' : '(target ≤ 6)'}</span>} />
                <Row label="Distance falloff (n)" value={b.path_loss_exponent} />
                <div className="border-t border-slate-800 pt-2">
                  <div className="text-xs text-slate-500 mb-1">Loss per crossing: starting → fitted</div>
                  {Object.entries(b.material_factors).map(([k, f]) => {
                    const fitted = b.material_loss_db[k]
                    const start = f ? fitted / f : fitted
                    const atLimit = f <= 0.2 || f >= 3.5
                    return (
                      <div key={k} className="flex justify-between text-xs py-0.5">
                        <span className="text-slate-400 truncate">{MATERIAL_LABEL(k)}</span>
                        <span className="font-mono text-slate-200">
                          {start.toFixed(0)} → {fitted.toFixed(1)} dB{atLimit && <span className="text-amber-400" title="Hit the fit's limit: the data says this table value is far off, or this material is rarely crossed"> *</span>}
                        </span>
                      </div>
                    )
                  })}
                </div>
                <div className="border-t border-slate-800 pt-2">
                  <div className="text-xs text-slate-500 mb-1">Radios matched to your APs</div>
                  {analysis.aps.map((a) => (
                    <div key={a.ap_id} className="text-xs flex justify-between py-0.5">
                      <span className="text-slate-300 truncate">{a.label}</span>
                      <span className="font-mono text-slate-500">
                        {a.radios.map((r) => `${r.band}/${r.channel}`).join(' ')} · {a.distance_m} m
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
          {analysis.warnings?.length > 0 && (
            <ul className="text-xs text-amber-400/90 list-disc pl-4 space-y-0.5">
              {analysis.warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
          <p className="text-xs text-slate-600">
            {new Date(analysis.createdAt).toLocaleString()} · {analysis.points_used} points. The heatmap is the model's
            prediction, nudged to match your readings near each spot.
          </p>
        </>
      )}
    </div>
  )
}

function ExportReportButton({ surveyId, hasAnalysis, hasPlan }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const run = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const r = await exportReport(surveyId)
      setMsg(`Downloaded (${(r.bytes / 1024 / 1024).toFixed(1)} MB)`)
    } catch (e) {
      setMsg(e.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="card space-y-2">
      <button className="btn-primary w-full justify-center disabled:opacity-50" disabled={busy} onClick={run}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Export report
      </button>
      <p className="text-xs text-slate-500">
        One HTML file that works offline: 3D house, before/after heatmaps, every AP option, room grades and an Omada setup checklist.
        {!hasAnalysis && ' Run the coverage model first for heatmaps.'}
        {hasAnalysis && !hasPlan && ' Run AP placement first to include the options.'}
      </p>
      {msg && <p className="text-xs text-slate-400">{msg}</p>}
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
  analysisProps, placementProps,
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
          <AnalysisCard {...analysisProps} donePoints={state.points.filter((p) => p.record).length} />
          <PlacementCard {...placementProps} />
          <ExportReportButton surveyId={surveyId} hasAnalysis={!!analysisProps.analysis} hasPlan={!!placementProps.plan} />
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
