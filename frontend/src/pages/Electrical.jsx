import { useState, useEffect, useRef } from 'react'
import { api } from '../api/index.js'

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-500 mt-1">{hint}</p>}
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="space-y-4">
      <h3 className="font-display tracking-widest uppercase text-slate-400 text-base border-b border-slate-800 pb-2">{title}</h3>
      {children}
    </div>
  )
}

function Result({ label, value, sub, highlight, status }) {
  const statusStyle = {
    good: { card: 'bg-brand-900/20 border-brand-800/40',   text: 'text-brand-300'  },
    warn: { card: 'bg-amber-950/30 border-amber-800/40',   text: 'text-amber-400'  },
    over: { card: 'bg-red-950/30   border-red-800/40',     text: 'text-red-400'    },
  }
  const s = status ? statusStyle[status] : null
  const cardCls = s ? s.card : highlight ? 'bg-brand-900/20 border-brand-800/40' : 'bg-slate-800/50 border-slate-700/50'
  const textCls = s ? s.text : highlight ? 'text-brand-300' : 'text-slate-100'
  return (
    <div className={`rounded-lg p-4 border ${cardCls}`}>
      <div className="text-xs uppercase tracking-wider text-slate-500 mb-1">{label}</div>
      <div className={`font-display text-2xl tracking-wide ${textCls}`}>{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  )
}

function InfoBox({ children, type = 'info' }) {
  const styles = {
    info: 'bg-blue-950/30 border-blue-800/40 text-blue-300',
    warn: 'bg-amber-950/30 border-amber-800/40 text-amber-300',
    good: 'bg-brand-950/30 border-brand-800/40 text-brand-300',
  }
  return (
    <div className={`rounded-lg border px-4 py-3 text-xs leading-relaxed ${styles[type]}`}>
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────
// NEC 220 ELECTRICAL LOAD CALCULATOR
// ─────────────────────────────────────────────
//
// NEC 220 Optional Method (220.82):
//   VA = amps × circuit voltage × qty
//   Demand: first 10,000 VA at 100%, remainder at 40%
//   Demand amps = demand VA ÷ 240 (split-phase service is always 240V)
//   Continuous 125% factor: breaker/conductor sizing only, NOT service demand
//   Sub-panels: their NEC demand VA feeds into the main panel total
//
const BREAKER_SIZES = [15,20,25,30,35,40,50,60,70,80,90,100,110,125,150,175,200]

function applyLoad(ld) {
  const a = parseFloat(ld.amps) || 0
  const q = parseInt(ld.qty) || 1
  const va = a * (ld.volts || 240) * q
  const minBreaker = ld.continuous
    ? (BREAKER_SIZES.find(s => s >= Math.ceil(a * 1.25)) ?? a)
    : a
  return { ...ld, va, minBreaker }
}

function nec220({ totalVA, panelAmps }) {
  const demandVA = totalVA <= 10000 ? totalVA : 10000 + (totalVA - 10000) * 0.40
  const demandAmps = demandVA / 240
  const rawAmps = totalVA / 240
  const loadPct = panelAmps ? (demandAmps / panelAmps) * 100 : 0
  const remaining = panelAmps - demandAmps
  const status = loadPct > 100 ? 'over' : loadPct > 80 ? 'warn' : 'good'
  return { totalVA, demandVA, demandAmps, rawAmps, loadPct, remaining, status }
}

function ElecLoadTable({ loads, onSet, onAdd, onRemove }) {
  const calcLoads = loads.map(applyLoad)
  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/50">
              <th className="text-left px-3 py-2.5 text-xs text-slate-500 uppercase tracking-wider">Load</th>
              <th className="text-right px-3 py-2.5 text-xs text-slate-500 uppercase tracking-wider">Amps</th>
              <th className="text-center px-3 py-2.5 text-xs text-slate-500 uppercase tracking-wider">Volts</th>
              <th className="text-right px-3 py-2.5 text-xs text-slate-500 uppercase tracking-wider">Qty</th>
              <th className="text-right px-3 py-2.5 text-xs text-slate-500 uppercase tracking-wider">VA</th>
              <th className="text-center px-3 py-2.5 text-xs text-slate-500 uppercase tracking-wider">Cont.</th>
              <th className="px-3 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {calcLoads.map(ld => (
              <tr key={ld.id} className="border-b border-slate-800/50">
                <td className="px-3 py-2">
                  <input className="input py-1 text-xs" value={ld.name} onChange={e => onSet(ld.id, 'name', e.target.value)} placeholder="Load name" />
                </td>
                <td className="px-3 py-2">
                  <input className="input w-16 py-1 text-xs text-right" type="number" value={ld.amps} onChange={e => onSet(ld.id, 'amps', e.target.value)} />
                </td>
                <td className="px-3 py-2">
                  <select className="input py-1 text-xs" style={{width:'5rem'}} value={ld.volts} onChange={e => onSet(ld.id, 'volts', Number(e.target.value))}>
                    <option value={120}>120V</option>
                    <option value={240}>240V</option>
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input className="input w-14 py-1 text-xs text-right" type="number" min="1" value={ld.qty} onChange={e => onSet(ld.id, 'qty', e.target.value)} />
                </td>
                <td className="px-3 py-2 text-right font-mono text-xs text-slate-400">
                  {ld.va > 0 ? `${(ld.va / 1000).toFixed(1)}k` : '—'}
                </td>
                <td className="px-3 py-2 text-center">
                  <input type="checkbox" className="w-4 h-4 accent-brand-500" checked={ld.continuous} onChange={e => onSet(ld.id, 'continuous', e.target.checked)} />
                </td>
                <td className="px-3 py-2">
                  <button className="text-slate-600 hover:text-red-400 text-xs" onClick={() => onRemove(ld.id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="btn-ghost w-full" onClick={onAdd}>+ Add Load</button>
    </>
  )
}

function SubPanelCard({ sp, onUpdate, onRemove, onAddLoad, onSetLoad, onRemoveLoad }) {
  const calcLoads = sp.loads.map(applyLoad)
  const totalVA = calcLoads.reduce((s, l) => s + l.va, 0)
  const { demandVA, demandAmps, loadPct, remaining, status } = nec220({ totalVA, panelAmps: sp.amps })
  const continuousLoads = calcLoads.filter(l => l.continuous && parseFloat(l.amps) > 0)
  const statusColors = { over: 'text-red-400', warn: 'text-amber-400', good: 'text-brand-400' }
  const statusLabels = { over: 'Overloaded', warn: 'Near capacity', good: 'Good headroom' }

  return (
    <div className="card p-4 space-y-4 border-slate-700">
      <div className="flex items-center gap-3">
        <input
          className="input flex-1 font-medium"
          value={sp.name}
          onChange={e => onUpdate(sp.id, 'name', e.target.value)}
          placeholder="Sub-panel name"
        />
        <div className="flex items-center gap-2 shrink-0">
          <select
            className="input py-1 text-xs"
            style={{width:'7rem'}}
            value={sp.amps}
            onChange={e => onUpdate(sp.id, 'amps', Number(e.target.value))}
          >
            <option value={40}>40A</option>
            <option value={60}>60A</option>
            <option value={70}>70A</option>
            <option value={100}>100A</option>
            <option value={125}>125A</option>
            <option value={150}>150A</option>
            <option value={200}>200A</option>
          </select>
          <button className="text-slate-500 hover:text-red-400 text-xs px-2" onClick={() => onRemove(sp.id)}>Remove</button>
        </div>
      </div>

      <ElecLoadTable
        loads={sp.loads}
        onSet={(ldId, k, v) => onSetLoad(sp.id, ldId, k, v)}
        onAdd={() => onAddLoad(sp.id)}
        onRemove={ldId => onRemoveLoad(sp.id, ldId)}
      />

      {totalVA > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1">
          <div className="rounded-lg bg-slate-800/50 border border-slate-700/50 p-3">
            <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Capacity</div>
            <div className="font-display text-lg text-slate-100">{sp.amps}A</div>
            <div className="text-xs text-slate-500">{(sp.amps * 240 / 1000).toFixed(1)} kVA</div>
          </div>
          <div className="rounded-lg bg-slate-800/50 border border-slate-700/50 p-3">
            <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Demand</div>
            <div className="font-display text-lg text-brand-300">{demandAmps.toFixed(0)}A</div>
            <div className="text-xs text-slate-500">{(demandVA/1000).toFixed(1)} kVA</div>
          </div>
          <div className="rounded-lg bg-slate-800/50 border border-slate-700/50 p-3">
            <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Load %</div>
            <div className={`font-display text-lg ${statusColors[status]}`}>{loadPct.toFixed(0)}%</div>
            <div className="text-xs text-slate-500">{statusLabels[status]}</div>
          </div>
          <div className="rounded-lg bg-slate-800/50 border border-slate-700/50 p-3">
            <div className="text-xs text-slate-500 uppercase tracking-wider mb-1">Remaining</div>
            <div className="font-display text-lg text-slate-100">{Math.round(remaining)}A</div>
            <div className="text-xs text-slate-500">in sub-panel</div>
          </div>
        </div>
      )}

      {continuousLoads.length > 0 && (
        <div className="rounded-xl border border-slate-800 overflow-hidden">
          <div className="bg-slate-900/50 border-b border-slate-800 px-3 py-2 text-xs uppercase tracking-wider text-slate-500">Min. breaker sizes (NEC 210.20)</div>
          {continuousLoads.map(l => (
            <div key={l.id} className="flex justify-between px-3 py-1.5 border-b border-slate-800/40 last:border-0 text-xs">
              <span className="text-slate-300">{l.name || '(unnamed)'}</span>
              <span className="font-mono text-brand-400">{l.minBreaker}A min</span>
            </div>
          ))}
        </div>
      )}

      <div className="text-xs text-slate-500 pt-1">
        Feeder to main panel: <span className="font-mono text-slate-300">{sp.amps}A / 240V breaker</span> — demand contribution: <span className="font-mono text-slate-300">{demandAmps.toFixed(0)}A ({(demandVA/1000).toFixed(1)} kVA)</span>
      </div>
    </div>
  )
}

const ELEC_DEFAULT_LOADS = [
  { id: 1, name: 'HVAC / Heat Pump',       amps: '30', volts: 240, qty: 1, continuous: true  },
  { id: 2, name: 'Electric Range',          amps: '50', volts: 240, qty: 1, continuous: false },
  { id: 3, name: 'Water Heater (electric)', amps: '25', volts: 240, qty: 1, continuous: false },
  { id: 4, name: 'Clothes Dryer',           amps: '30', volts: 240, qty: 1, continuous: false },
  { id: 5, name: 'Washer',                  amps: '20', volts: 120, qty: 1, continuous: false },
  { id: 6, name: 'Dishwasher',              amps: '15', volts: 120, qty: 1, continuous: false },
  { id: 7, name: 'Refrigerator',            amps: '6',  volts: 120, qty: 1, continuous: false },
  { id: 8, name: 'Microwave',               amps: '15', volts: 120, qty: 1, continuous: false },
]

function ElecCalc() {
  const [panelAmps, setPanelAmps] = useState(200)
  const [sqft, setSqft] = useState(0)
  const [smallAppCircuits, setSmallAppCircuits] = useState(2)
  const [laundry, setLaundry] = useState(true)
  const [loads, setLoads] = useState(ELEC_DEFAULT_LOADS)
  const [subPanels, setSubPanels] = useState([])
  const [saveStatus, setSaveStatus] = useState('saved')
  const initialized = useRef(false)
  const saveTimer = useRef(null)

  useEffect(() => {
    api.getElec().then(data => {
      if (data.panelAmps) setPanelAmps(data.panelAmps)
      if (data.sqft) setSqft(data.sqft)
      if (data.smallAppCircuits != null) setSmallAppCircuits(data.smallAppCircuits)
      if (data.laundry != null) setLaundry(data.laundry)
      if (Array.isArray(data.loads) && data.loads.length) setLoads(data.loads)
      if (Array.isArray(data.subPanels)) setSubPanels(data.subPanels)
      setTimeout(() => { initialized.current = true }, 0)
    }).catch(() => { initialized.current = true })
  }, [])

  useEffect(() => {
    if (!initialized.current) return
    setSaveStatus('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      api.saveElec({ panelAmps, sqft, smallAppCircuits, laundry, loads, subPanels })
        .then(() => setSaveStatus('saved'))
        .catch(() => setSaveStatus('error'))
    }, 800)
  }, [panelAmps, sqft, smallAppCircuits, laundry, loads, subPanels])

  const addLoad    = () => setLoads(l => [...l, { id: Date.now(), name: '', amps: '', volts: 240, qty: 1, continuous: false }])
  const setLoad    = (id, k, v) => setLoads(l => l.map(ld => ld.id === id ? { ...ld, [k]: v } : ld))
  const removeLoad = (id) => setLoads(l => l.filter(ld => ld.id !== id))

  const addSubPanel    = () => setSubPanels(sps => [...sps, { id: Date.now(), name: 'New Sub-Panel', amps: 60, loads: [] }])
  const updateSubPanel = (spId, k, v) => setSubPanels(sps => sps.map(sp => sp.id === spId ? { ...sp, [k]: v } : sp))
  const removeSubPanel = (spId) => setSubPanels(sps => sps.filter(sp => sp.id !== spId))
  const addSubLoad     = (spId) => setSubPanels(sps => sps.map(sp =>
    sp.id === spId ? { ...sp, loads: [...sp.loads, { id: Date.now(), name: '', amps: '', volts: 120, qty: 1, continuous: false }] } : sp
  ))
  const setSubLoad     = (spId, ldId, k, v) => setSubPanels(sps => sps.map(sp =>
    sp.id === spId ? { ...sp, loads: sp.loads.map(ld => ld.id === ldId ? { ...ld, [k]: v } : ld) } : sp
  ))
  const removeSubLoad  = (spId, ldId) => setSubPanels(sps => sps.map(sp =>
    sp.id === spId ? { ...sp, loads: sp.loads.filter(ld => ld.id !== ldId) } : sp
  ))

  const generalVA    = (parseInt(sqft) || 0) * 3
  const smallAppVA   = smallAppCircuits * 1500
  const laundryVA    = laundry ? 1500 : 0
  const mandatoryVA  = generalVA + smallAppVA + laundryVA

  const calcLoads = loads.map(applyLoad)
  const directVA  = calcLoads.reduce((s, l) => s + l.va, 0)

  const subPanelDemandVA = subPanels.reduce((s, sp) => {
    const spTotalVA = sp.loads.map(applyLoad).reduce((a, l) => a + l.va, 0)
    const { demandVA } = nec220({ totalVA: spTotalVA, panelAmps: sp.amps })
    return s + demandVA
  }, 0)

  const combinedVA = mandatoryVA + directVA + subPanelDemandVA
  const { demandVA, demandAmps, rawAmps, loadPct, remaining, status } = nec220({ totalVA: combinedVA, panelAmps })
  const panelCapacityVA = panelAmps * 240
  const continuousLoads = calcLoads.filter(l => l.continuous && parseFloat(l.amps) > 0)

  const saveColors = { saved: 'text-slate-500', saving: 'text-amber-400', error: 'text-red-400' }
  const saveLabels = { saved: 'Saved', saving: 'Saving…', error: 'Save failed' }

  function printElecReport() {
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    const statusText = { good: 'Good headroom', warn: 'Near capacity (>80%)', over: 'OVERLOADED (>100%)' }

    const loadRows = (loadsArr) => loadsArr.map(applyLoad).map(ld => `
      <tr>
        <td>${ld.name || '—'}</td>
        <td>${ld.amps || '—'}</td>
        <td>${ld.volts}V</td>
        <td>${ld.qty}</td>
        <td>${ld.va > 0 ? (ld.va / 1000).toFixed(2) + ' kVA' : '—'}</td>
        <td>${ld.continuous ? 'Yes' : ''}</td>
        <td>${ld.continuous ? ld.minBreaker + 'A' : ''}</td>
      </tr>`).join('')

    const subPanelSections = subPanels.map(sp => {
      const spLoads = sp.loads.map(applyLoad)
      const spTotalVA = spLoads.reduce((s, l) => s + l.va, 0)
      const { demandVA: spDemandVA, demandAmps: spDemandAmps, loadPct: spLoadPct, status: spStatus } = nec220({ totalVA: spTotalVA, panelAmps: sp.amps })
      const spContLoads = spLoads.filter(l => l.continuous && parseFloat(l.amps) > 0)
      return `
        <h3 style="margin:24px 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#555;border-bottom:1px solid #ddd;padding-bottom:4px">
          Sub-Panel: ${sp.name} (${sp.amps}A)
        </h3>
        <table>
          <thead><tr><th>Load</th><th>Amps</th><th>Volts</th><th>Qty</th><th>VA</th><th>Cont.</th><th>Min. Breaker</th></tr></thead>
          <tbody>${loadRows(sp.loads)}</tbody>
        </table>
        <table style="margin-top:10px">
          <thead><tr><th>Sub-Panel Capacity</th><th>Connected Load</th><th>NEC Demand</th><th>Load %</th><th>Feeder Breaker (main panel)</th></tr></thead>
          <tbody><tr>
            <td>${sp.amps}A / ${(sp.amps * 240 / 1000).toFixed(1)} kVA</td>
            <td>${(spTotalVA / 240).toFixed(0)}A / ${(spTotalVA / 1000).toFixed(2)} kVA</td>
            <td>${spDemandAmps.toFixed(0)}A / ${(spDemandVA / 1000).toFixed(2)} kVA</td>
            <td>${spLoadPct.toFixed(0)}% — ${statusText[spStatus]}</td>
            <td>${sp.amps}A / 240V 2-pole</td>
          </tr></tbody>
        </table>
        ${spContLoads.length ? `
          <p style="font-size:11px;color:#555;margin:6px 0 2px">Continuous load minimum breakers (NEC 210.20):</p>
          <ul style="font-size:11px;margin:0;padding-left:18px">
            ${spContLoads.map(l => `<li>${l.name || '(unnamed)'}: ${l.minBreaker}A minimum</li>`).join('')}
          </ul>` : ''}`
    }).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Electrical Load Calculation</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:28px 36px;max-width:900px;margin:0 auto}
      h1{font-size:18px;font-weight:bold;margin-bottom:2px}
      .subtitle{font-size:11px;color:#555;margin-bottom:18px}
      h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#555;border-bottom:2px solid #111;padding-bottom:4px;margin:20px 0 10px}
      h3{font-size:12px}
      table{width:100%;border-collapse:collapse;margin-bottom:8px}
      th{background:#f0f0f0;text-align:left;padding:5px 8px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;border:1px solid #ccc}
      td{padding:5px 8px;border:1px solid #ddd;vertical-align:top}
      tr:nth-child(even) td{background:#fafafa}
      .summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
      .summary-card{border:1px solid #ccc;border-radius:4px;padding:10px 12px}
      .summary-card .label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#777;margin-bottom:3px}
      .summary-card .value{font-size:18px;font-weight:bold;margin-bottom:1px}
      .summary-card .sub{font-size:10px;color:#777}
      .good{color:#16a34a}.warn{color:#b45309}.over{color:#dc2626}
      .disclaimer{margin-top:24px;padding:10px 12px;border:1px solid #ccc;border-radius:4px;font-size:10px;color:#555;line-height:1.6}
      .footer{margin-top:16px;font-size:10px;color:#999;border-top:1px solid #eee;padding-top:8px}
      @media print{body{padding:16px 20px}@page{margin:.75in}}
    </style>
    </head><body>
    <h1>Residential Electrical Load Calculation</h1>
    <div class="subtitle">Prepared: ${date} &nbsp;|&nbsp; Method: NEC Article 220 Optional Method (Section 220.82) &nbsp;|&nbsp; Service: 120/240V Single-Phase Split-Phase</div>

    <h2>Main Panel</h2>
    <table style="margin-bottom:14px">
      <thead><tr><th>Panel Rating</th><th>Panel Capacity</th></tr></thead>
      <tbody><tr><td>${panelAmps}A</td><td>${(panelCapacityVA/1000).toFixed(0)} kVA at 240V</td></tr></tbody>
    </table>

    <h2>NEC Required Loads (220.82(B))</h2>
    <table style="margin-bottom:14px">
      <thead><tr><th>Load</th><th>Rule</th><th>VA</th></tr></thead>
      <tbody>
        <tr><td>General lighting &amp; receptacles</td><td>220.82(B)(1) · ${sqft > 0 ? sqft + ' sq ft × 3 VA' : 'sq ft not entered'}</td><td>${generalVA.toLocaleString()} VA</td></tr>
        <tr><td>Kitchen small appliance circuits (${smallAppCircuits})</td><td>220.52(A) · 1,500 VA each</td><td>${smallAppVA.toLocaleString()} VA</td></tr>
        <tr><td>Laundry branch circuit</td><td>220.52(B) · 1,500 VA fixed</td><td>${laundry ? '1,500 VA' : 'Not included'}</td></tr>
        <tr><td><strong>Required loads subtotal</strong></td><td></td><td><strong>${mandatoryVA.toLocaleString()} VA</strong></td></tr>
      </tbody>
    </table>

    <h2>Appliance &amp; Motor Loads</h2>
    <table>
      <thead><tr><th>Load</th><th>Amps</th><th>Volts</th><th>Qty</th><th>VA</th><th>Continuous</th><th>Min. Breaker</th></tr></thead>
      <tbody>${loadRows(loads)}</tbody>
    </table>

    ${subPanelSections}

    <h2>NEC Demand Calculation — Main Panel</h2>
    <div class="summary-grid">
      <div class="summary-card">
        <div class="label">Panel Capacity</div>
        <div class="value">${panelAmps}A</div>
        <div class="sub">${(panelCapacityVA/1000).toFixed(0)} kVA at 240V</div>
      </div>
      <div class="summary-card">
        <div class="label">Connected Load</div>
        <div class="value">${(combinedVA/240).toFixed(0)}A</div>
        <div class="sub">${(combinedVA/1000).toFixed(2)} kVA total</div>
      </div>
      <div class="summary-card">
        <div class="label">NEC Demand Load</div>
        <div class="value ${status}">${demandAmps.toFixed(0)}A</div>
        <div class="sub">${(demandVA/1000).toFixed(2)} kVA after demand factors</div>
      </div>
      <div class="summary-card">
        <div class="label">Load % / Status</div>
        <div class="value ${status}">${loadPct.toFixed(0)}%</div>
        <div class="sub">${statusText[status]}</div>
      </div>
    </div>
    <table>
      <thead><tr><th>Demand Factor Step</th><th>VA</th><th>Factor</th><th>Result</th></tr></thead>
      <tbody>
        <tr><td>First 10,000 VA</td><td>${Math.min(combinedVA,10000).toLocaleString()} VA</td><td>100%</td><td>${Math.min(combinedVA,10000).toLocaleString()} VA</td></tr>
        ${combinedVA > 10000 ? `<tr><td>Remaining VA</td><td>${(combinedVA-10000).toLocaleString()} VA</td><td>40%</td><td>${((combinedVA-10000)*0.4).toLocaleString(undefined,{maximumFractionDigits:0})} VA</td></tr>` : ''}
        <tr><td><strong>Total demand VA</strong></td><td></td><td></td><td><strong>${demandVA.toLocaleString(undefined,{maximumFractionDigits:0})} VA = ${demandAmps.toFixed(1)}A at 240V</strong></td></tr>
        <tr><td><strong>Headroom</strong></td><td></td><td></td><td><strong>${Math.round(remaining)}A / ${((panelCapacityVA-demandVA)/1000).toFixed(2)} kVA remaining</strong></td></tr>
      </tbody>
    </table>

    ${continuousLoads.length ? `
    <h2>Minimum Breaker Sizes — Continuous Loads (NEC 210.20)</h2>
    <table>
      <thead><tr><th>Load</th><th>Circuit Amps</th><th>125% Calc</th><th>Minimum Breaker</th></tr></thead>
      <tbody>${continuousLoads.map(l => `
        <tr><td>${l.name||'(unnamed)'}</td><td>${l.amps}A</td><td>${(parseFloat(l.amps)*1.25).toFixed(1)}A</td><td>${l.minBreaker}A</td></tr>`).join('')}
      </tbody>
    </table>` : ''}

    <div class="disclaimer">
      <strong>Planning Estimate Only.</strong> This calculation uses the NEC Article 220 Optional Method (220.82) as a planning tool.
      It is not a certified load calculation and must not be used as the sole basis for panel upgrades, service changes, or permit applications.
      A licensed electrician must perform and sign off on the official load calculation before any service work is performed.
      Demand factors per NEC 220.82: first 10,000 VA at 100%, remainder at 40%. Sub-panel demand (after its own factors) is included in the main panel total.
      Feeder breakers are sized at sub-panel rated capacity, not calculated demand.
    </div>
    <div class="footer">Generated by Home Planner &nbsp;|&nbsp; ${date}</div>
    </body></html>`

    const w = window.open('', '_blank')
    w.document.write(html)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 400)
  }

  return (
    <div className="flex gap-6 items-start">
      {/* Left column — entry fields */}
      <div className="min-w-0 max-w-2xl flex-1 space-y-6">
        <div className="flex items-center justify-between">
          <Field label="Main Panel Size" hint="120/240V split-phase — panel amps are rated at 240V">
            <select className="input max-w-xs" value={panelAmps} onChange={e => setPanelAmps(Number(e.target.value))}>
              <option value={100}>100A — older homes, limited additions</option>
              <option value={125}>125A</option>
              <option value={150}>150A</option>
              <option value={200}>200A — standard new construction</option>
              <option value={320}>320A — large all-electric / dual-meter</option>
              <option value={400}>400A — large all-electric with EV + HVAC</option>
            </select>
          </Field>
          <div className="flex items-center gap-3 mt-5 shrink-0">
            <span className={`text-xs ${saveColors[saveStatus]}`}>{saveLabels[saveStatus]}</span>
            <button className="btn-ghost text-xs py-1 px-3" onClick={printElecReport}>🖨 Print / PDF</button>
          </div>
        </div>

        <Section title="NEC Required Loads">
          <div className="rounded-xl border border-slate-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/50">
                  <th className="text-left px-3 py-2.5 text-xs text-slate-500 uppercase tracking-wider">Load</th>
                  <th className="text-left px-3 py-2.5 text-xs text-slate-500 uppercase tracking-wider">NEC Rule</th>
                  <th className="text-right px-3 py-2.5 text-xs text-slate-500 uppercase tracking-wider">VA</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-800/50">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-300 text-xs">General lighting &amp; receptacles</span>
                      <input
                        className="input w-20 py-1 text-xs text-right"
                        type="number" min="0" placeholder="sq ft"
                        value={sqft || ''}
                        onChange={e => setSqft(e.target.value)}
                      />
                      <span className="text-slate-500 text-xs">sq ft</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">220.82(B)(1) · 3 VA/sq ft</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-slate-400">
                    {generalVA > 0 ? `${(generalVA/1000).toFixed(1)}k` : '—'}
                  </td>
                </tr>
                <tr className="border-b border-slate-800/50">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-300 text-xs">Kitchen small appliance circuits</span>
                      <input
                        className="input w-14 py-1 text-xs text-right"
                        type="number" min="2"
                        value={smallAppCircuits}
                        onChange={e => setSmallAppCircuits(Math.max(2, parseInt(e.target.value) || 2))}
                      />
                      <span className="text-slate-500 text-xs">× 20A</span>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">220.52(A) · 1,500 VA each · min. 2</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-slate-400">
                    {(smallAppVA/1000).toFixed(1)}k
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="text-slate-300 text-xs">Laundry branch circuit</span>
                      <input
                        type="checkbox" className="w-4 h-4 accent-brand-500"
                        checked={laundry}
                        onChange={e => setLaundry(e.target.checked)}
                      />
                    </div>
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">220.52(B) · 1,500 VA fixed</td>
                  <td className="px-3 py-2 text-right font-mono text-xs text-slate-400">
                    {laundry ? '1.5k' : '—'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <InfoBox type="info">
            These loads are required by NEC regardless of actual usage. General lighting covers all receptacles and lighting circuits — do not add those circuits individually to the appliance table below. Enter your home's total conditioned square footage (outside dimensions, excluding garages and unfinished spaces).
          </InfoBox>
        </Section>

        <Section title="Appliance &amp; Motor Loads">
          <ElecLoadTable loads={loads} onSet={setLoad} onAdd={addLoad} onRemove={removeLoad} />

          {subPanels.filter(sp => sp.loads.length > 0).map(sp => {
            const spCalcLoads = sp.loads.map(applyLoad)
            const spTotalVA = spCalcLoads.reduce((s, l) => s + l.va, 0)
            const { demandVA: spDemandVA, demandAmps: spDemandAmps } = nec220({ totalVA: spTotalVA, panelAmps: sp.amps })
            return (
              <div key={sp.id} className="rounded-xl border border-slate-700/50 overflow-hidden">
                <div className="flex items-center justify-between bg-slate-800/60 border-b border-slate-700/50 px-4 py-2">
                  <span className="text-xs font-medium text-slate-300">{sp.name}</span>
                  <span className="text-xs text-slate-500">{sp.amps}A sub-panel — feeder: {spDemandAmps.toFixed(0)}A demand / {(spDemandVA/1000).toFixed(1)} kVA</span>
                </div>
                <table className="w-full text-sm">
                  <tbody>
                    {spCalcLoads.map(ld => (
                      <tr key={ld.id} className="border-b border-slate-800/40 last:border-0 text-slate-400">
                        <td className="px-4 py-2 text-slate-300">{ld.name || <span className="italic text-slate-600">(unnamed)</span>}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{ld.amps || '—'}A</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{ld.volts}V</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">×{ld.qty}</td>
                        <td className="px-3 py-2 text-right font-mono text-xs">{ld.va > 0 ? `${(ld.va/1000).toFixed(1)}k VA` : '—'}</td>
                        <td className="px-3 py-2 text-center text-xs">{ld.continuous ? <span className="text-brand-400">Cont.</span> : ''}</td>
                      </tr>
                    ))}
                    <tr className="bg-slate-900/40">
                      <td colSpan={4} className="px-4 py-2 text-xs text-slate-500">Sub-panel feeder to main panel</td>
                      <td className="px-3 py-2 text-right font-mono text-xs text-brand-400">{(spDemandVA/1000).toFixed(1)}k VA</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
            )
          })}

          <InfoBox type="info">
            Enter the equipment's actual maximum draw — not the breaker size. For example, a 32A EV charger on a 40A circuit should be entered as 32A; the <strong>Cont.</strong> flag will then recommend the 40A breaker. Breaker size already includes the 125% safety factor, so using it as input overstates the load. 240V loads (HVAC, range, dryer) contribute twice the VA of the same amps at 120V.
          </InfoBox>
          <InfoBox type="warn">
            <strong>HVAC (NEC 220.82(C)):</strong> Include the <em>larger</em> of your heating load or cooling load — not both. If you have a heat pump, use the compressor amps only and omit any backup electric heat strips unless they run simultaneously.
          </InfoBox>
        </Section>

        <Section title="Sub-Panels">
          {subPanels.length === 0 && (
            <p className="text-sm text-slate-500">No sub-panels added. Each sub-panel's NEC demand flows into the main panel calculation.</p>
          )}
          {subPanels.map(sp => (
            <SubPanelCard
              key={sp.id}
              sp={sp}
              onUpdate={updateSubPanel}
              onRemove={removeSubPanel}
              onAddLoad={addSubLoad}
              onSetLoad={setSubLoad}
              onRemoveLoad={removeSubLoad}
            />
          ))}
          <button className="btn-ghost w-full" onClick={addSubPanel}>+ Add Sub-Panel</button>
        </Section>
      </div>

      {/* Right column — results (sticky) */}
      <div className="w-80 shrink-0 sticky top-4 space-y-4">
        <div className="text-xs uppercase tracking-wider text-slate-500 font-medium pb-1 border-b border-slate-800">Main Panel Results</div>

        <div className="space-y-2">
          <div className="grid grid-cols-3 gap-2">
            <Result label="Panel Capacity"  value={`${panelAmps}A`}            sub={`${(panelCapacityVA/1000).toFixed(0)} kVA`} />
            <Result label="Connected Load"  value={`${(combinedVA/240).toFixed(0)}A`} sub={`${(combinedVA/1000).toFixed(1)} kVA`} />
            <Result label="NEC Demand"      value={`${demandAmps.toFixed(0)}A`} sub={`${(demandVA/1000).toFixed(1)} kVA`} status={status} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Result label="Load %"    value={`${loadPct.toFixed(0)}%`}    sub="of panel (NEC)" />
            <Result label="Remaining" value={`${Math.round(remaining)}A`} sub={`${((panelCapacityVA - demandVA)/1000).toFixed(1)} kVA left`} />
          </div>
        </div>

        {subPanels.length > 0 && (
          <div className="rounded-xl border border-slate-800 overflow-hidden">
            <div className="bg-slate-900/50 border-b border-slate-800 px-4 py-2 text-xs uppercase tracking-wider text-slate-500">Sub-panel feeders</div>
            {subPanels.map(sp => {
              const spTotalVA = sp.loads.map(applyLoad).reduce((s, l) => s + l.va, 0)
              const { demandAmps: spDemandAmps, demandVA: spDemandVA } = nec220({ totalVA: spTotalVA, panelAmps: sp.amps })
              return (
                <div key={sp.id} className="px-4 py-2 border-b border-slate-800/40 last:border-0 text-xs">
                  <div className="text-slate-300">{sp.name} <span className="text-slate-500">({sp.amps}A)</span></div>
                  <div className="font-mono text-slate-400">{spDemandAmps.toFixed(0)}A demand / {sp.amps}A breaker</div>
                </div>
              )
            })}
          </div>
        )}

        {continuousLoads.length > 0 && (
          <div className="rounded-xl border border-slate-800 overflow-hidden">
            <div className="bg-slate-900/50 border-b border-slate-800 px-4 py-2 text-xs uppercase tracking-wider text-slate-500">Continuous loads (NEC 210.20)</div>
            {continuousLoads.map(l => (
              <div key={l.id} className="px-4 py-2 border-b border-slate-800/40 last:border-0 text-xs">
                <div className="text-slate-300">{l.name || '(unnamed)'}</div>
                <div className="font-mono text-brand-400">{l.minBreaker}A breaker min.</div>
              </div>
            ))}
          </div>
        )}

        {status === 'over' && <InfoBox type="warn">NEC demand load exceeds panel capacity. A service upgrade is required. Consult a licensed electrician.</InfoBox>}
        {status === 'warn' && <InfoBox type="warn">Demand load above 80% of panel capacity. Limited headroom for additions like EV chargers or added HVAC zones.</InfoBox>}
        {status === 'good' && <InfoBox type="good">Panel has good headroom after NEC demand factors.</InfoBox>}
        <InfoBox type="info">
          <strong>NEC 220.82:</strong> first 10,000 VA at 100%, remainder at 40%. Sub-panel demand flows into the main panel total. A licensed electrician must perform the official calculation before any service change.
        </InfoBox>
      </div>
    </div>
  )
}

export default function Electrical() {
  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-6">
      <div>
        <h1 className="page-title">Electrical</h1>
        <p className="text-slate-500 text-sm mt-1">NEC 220 panel load calculation — check headroom before adding circuits</p>
      </div>
      <ElecCalc />
    </div>
  )
}
