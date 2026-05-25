import { useState, useEffect, useRef } from 'react'
import { api } from '../api'

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────
const ZONE_COLORS = ['#7c9ef5','#4fc3a1','#e8a020','#e05252','#b07cda','#f07c4a','#5cc8e8','#e87cb8']

const WH_STEPS = ['Overview','Climate','Envelope','Windows','Infiltration','Internals','Equipment','Results']
const Z_STEPS  = ['Climate','Envelope','Windows','Infiltration','Internals','Equipment','Zone Results']

const CITY_PRESETS = [
  ['Boston MA',       [9,  70, 91,  75, 65]],
  ['Chicago IL',      [-5, 70, 91,  75, 68]],
  ['New York NY',     [14, 70, 92,  75, 66]],
  ['Minneapolis MN',  [-15,70, 88,  75, 60]],
  ['Washington DC',   [18, 70, 92,  75, 70]],
  ['Atlanta GA',      [26, 70, 93,  75, 77]],
  ['Dallas TX',       [25, 70, 99,  75, 78]],
  ['Phoenix AZ',      [37, 70, 108, 75, 32]],
  ['Seattle WA',      [28, 70, 85,  75, 55]],
]

const DEFAULT_CLIMATE = { heat_design: 9, heat_indoor: 70, cool_design: 91, cool_indoor: 75, grains: 65 }

function mkZone(name, fa, wa, ca, occ, fCap, aCap) {
  return {
    name, floor_area: fa, ceiling_height: 9, wall_area: wa, ceiling_area: ca,
    floor_uncond: 0, bg_wall_area: 0, r_wall: 15, r_ceiling: 38, r_floor: 19, r_bg_wall: 0,
    window_area: Math.round(fa * 0.12), window_u: 0.30, window_shgc: 0.25,
    south_window: Math.round(fa * 0.04), door_area: 40, door_type: 'insulated',
    infiltration: 'average', custom_ach: 7, vent_cfm: 0, ventilation: 'none',
    occupants: occ, lighting: 0.8, appliances: 800,
    furnace_cap: fCap, ac_cap: aCap, duct_location: 'attic', duct_leakage: 'average',
  }
}

const DEFAULT_WHOLE = mkZone('Whole Home', 2000, 1400, 1000, 4, 80000, 36000)
const DEFAULT_ZONES = [
  mkZone('Zone 1 — Main Floor',  800, 600, 400, 2, 60000, 24000),
  mkZone('Zone 2 — Upper Floor', 700, 500, 350, 2, 60000, 24000),
  mkZone('Zone 3 — Basement',    400, 400, 200, 0, 40000, 18000),
  mkZone('Zone 4 — Addition',    300, 320, 150, 1, 40000, 18000),
]

// ─────────────────────────────────────────────
// CALCULATION ENGINE
// ─────────────────────────────────────────────
function calcZone(z, cl) {
  const hDT = cl.heat_indoor - cl.heat_design
  const cDT = cl.cool_design - cl.cool_indoor
  const uW  = 1 / Math.max(z.r_wall, 1)
  const uC  = 1 / Math.max(z.r_ceiling, 1)
  const uF  = 1 / Math.max(z.r_floor, 1)
  const uBG = z.r_bg_wall > 0 ? 1 / z.r_bg_wall : 0
  const uD  = 1 / ({ solid_wood: 2, insulated: 5, fiberglass: 7 }[z.door_type] || 5)
  const ach50  = ({ tight: 2, average: 7, loose: 15, very_loose: 25, custom: z.custom_ach }[z.infiltration] || 7)
  const airCFM = (ach50 / 18 * z.floor_area * z.ceiling_height) / 60
  const vEff   = z.ventilation === 'balanced' ? 0.25 : 1.0

  const HW      = uW * z.wall_area * hDT
  const HC      = uC * z.ceiling_area * hDT
  const HWin    = z.window_u * z.window_area * hDT
  const HD      = uD * z.door_area * hDT
  const HF      = z.floor_uncond > 0 ? uF * z.floor_uncond * hDT * 0.65 : 0
  const HBG     = uBG * z.bg_wall_area * (cl.heat_indoor - 52)
  const HInf    = 1.1 * airCFM * hDT
  const HVent   = 1.1 * z.vent_cfm * hDT * vEff
  const solCredit = z.south_window * z.window_shgc * 55 * 0.30
  const dMH     = z.duct_location === 'conditioned' ? 1.0 : z.duct_leakage === 'tight' ? 1.06 : z.duct_leakage === 'average' ? 1.13 : 1.22
  const HR      = HW + HC + HWin + HD + HF + HBG + HInf + HVent
  const HDuct   = HR * (dMH - 1)
  const HEAT    = Math.max(8000, Math.round((HR - solCredit + HDuct) / 500) * 500)

  const CW    = uW * z.wall_area * cDT * 1.15
  const CC    = uC * z.ceiling_area * (cDT + 18)
  const CWc   = z.window_u * z.window_area * cDT
  const CDoor = uD * z.door_area * cDT
  const CSol  = z.window_area * z.window_shgc * 125 * 0.60
  const CIs   = 1.1 * airCFM * cDT
  const CIl   = 0.68 * airCFM * Math.max(0, cl.grains - 60)
  const CVs   = 1.1 * z.vent_cfm * cDT * vEff
  const CVl   = 0.68 * z.vent_cfm * Math.max(0, cl.grains - 60) * vEff
  const CPpl  = z.occupants * 250
  const CPplL = z.occupants * 200
  const CLgt  = z.lighting * z.floor_area * 3.41
  const dMC   = z.duct_location === 'conditioned' ? 1.0 : z.duct_leakage === 'tight' ? 1.08 : z.duct_leakage === 'average' ? 1.16 : 1.26
  const CSens = CW + CC + CWc + CDoor + CSol + CIs + CVs + CPpl + CLgt + z.appliances
  const CLat  = CIl + CVl + CPplL
  const CDuct = CSens * (dMC - 1)
  const COOL  = Math.max(6000, Math.round((CSens + CLat + CDuct) / 500) * 500)

  return {
    HEAT, COOL,
    recH: Math.ceil(HEAT * 1.15 / 5000) * 5000,
    recC: Math.ceil(COOL * 1.10 / 6000) * 6000,
    SHR: (CSens / Math.max(CSens + CLat, 1)).toFixed(2),
    hDT, cDT,
    bd: { HW, HC, HWin, HD, HF, HBG, HInf, HVent, HDuct, solCredit },
  }
}

const fmt = n => Math.round(n).toLocaleString()

// ─────────────────────────────────────────────
// SHARED UI HELPERS
// ─────────────────────────────────────────────
function Field({ label, hint, children }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs text-slate-400 font-medium">{label}</label>
      {children}
      {hint && <span className="text-xs text-slate-600 leading-snug">{hint}</span>}
    </div>
  )
}

function FGrid({ children, cols = 2 }) {
  const cls = {
    1: 'grid grid-cols-1 gap-3',
    2: 'grid grid-cols-1 sm:grid-cols-2 gap-3',
    3: 'grid grid-cols-2 sm:grid-cols-3 gap-3',
  }[cols] || 'grid grid-cols-1 sm:grid-cols-2 gap-3'
  return <div className={cls}>{children}</div>
}

function Explainer({ children, type = 'info' }) {
  const cls = type === 'warn'
    ? 'bg-amber-950/20 border-slate-700 border-l-amber-500 text-slate-400'
    : 'bg-slate-900 border-slate-700 border-l-teal-500 text-slate-400'
  return (
    <div className={`rounded-lg border border-l-2 px-4 py-3 text-xs leading-relaxed mb-4 ${cls}`}>
      {children}
    </div>
  )
}

function SubTitle({ children }) {
  return (
    <div className="flex items-center gap-2 mt-5 mb-3">
      <span className="text-xs font-mono uppercase tracking-widest text-slate-600 whitespace-nowrap">{children}</span>
      <div className="flex-1 h-px bg-slate-800" />
    </div>
  )
}

function StepNav({ onBack, onNext, nextLabel = 'Next →' }) {
  return (
    <div className="flex gap-2 mt-6 pt-4 border-t border-slate-800 flex-wrap">
      {onBack && <button className="btn-ghost" onClick={onBack}>← Back</button>}
      {onNext && <button className="btn-primary" onClick={onNext}>{nextLabel}</button>}
    </div>
  )
}

function StepHeader({ tag, title, desc }) {
  if (!title) return null
  return (
    <div className="mb-5">
      {tag && <div className="text-xs font-mono uppercase tracking-widest text-amber-500 mb-1">{tag}</div>}
      <h2 className="font-display text-3xl tracking-widest uppercase text-slate-100 leading-none mb-1">{title}</h2>
      {desc && <p className="text-sm text-slate-500">{desc}</p>}
    </div>
  )
}

// ─────────────────────────────────────────────
// RESULTS HELPERS
// ─────────────────────────────────────────────
function Verdict({ ratio, name, icon }) {
  const [cls, text] = ratio < 0.9
    ? ['bg-red-950/30 border-red-800/40 text-red-400',   `may be undersized (${ratio.toFixed(2)}× load).`]
    : ratio <= 1.35
    ? ['bg-teal-950/30 border-teal-800/40 text-teal-400', `is well-sized (${ratio.toFixed(2)}× load).`]
    : ratio <= 1.8
    ? ['bg-amber-950/30 border-amber-800/40 text-amber-400', `is slightly oversized (${ratio.toFixed(2)}× load) — watch for short cycling.`]
    : ['bg-red-950/30 border-red-800/40 text-red-400',   `is significantly oversized (${ratio.toFixed(2)}× load) — likely causing short cycling.`]
  return (
    <div className={`rounded-lg border px-4 py-3 text-xs mb-2 ${cls}`}>
      {icon} <strong>{name}</strong> {text}
    </div>
  )
}

function LivePanel({ zone, climate }) {
  const r  = calcZone(zone, climate)
  const hR = zone.furnace_cap / r.HEAT
  const vCls = hR <= 1.35
    ? 'bg-teal-950/30 border-teal-800/40 text-teal-400'
    : hR <= 1.8
    ? 'bg-amber-950/30 border-amber-800/40 text-amber-400'
    : 'bg-red-950/30 border-red-800/40 text-red-400'
  return (
    <div className="space-y-3">
      <div className="bg-amber-950/20 border border-amber-800/30 rounded-lg p-3">
        <div className="text-xs font-mono uppercase tracking-wider text-slate-500 mb-1">Heating Load</div>
        <div className="font-display text-2xl text-amber-400">{fmt(r.HEAT)}</div>
        <div className="text-xs text-slate-500">BTU/hr · {(r.HEAT / 12000).toFixed(1)} tons</div>
      </div>
      <div className="bg-teal-950/20 border border-teal-800/30 rounded-lg p-3">
        <div className="text-xs font-mono uppercase tracking-wider text-slate-500 mb-1">Cooling Load</div>
        <div className="font-display text-2xl text-teal-400">{fmt(r.COOL)}</div>
        <div className="text-xs text-slate-500">BTU/hr · {(r.COOL / 12000).toFixed(1)} tons</div>
      </div>
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
        <div className="text-xs font-mono uppercase tracking-wider text-slate-500 mb-1">BTU / ft²</div>
        <div className="font-display text-2xl text-slate-200">{Math.round(r.HEAT / Math.max(zone.floor_area, 1))}</div>
        <div className="text-xs text-slate-500">heating (target: 20–50)</div>
      </div>
      <div className={`rounded-lg border px-3 py-2 text-xs ${vCls}`}>
        Furnace ratio: {hR.toFixed(2)}× load
      </div>
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3 space-y-1.5">
        <div className="text-xs font-mono uppercase tracking-wider text-slate-500 mb-2">Loss Breakdown</div>
        {[['Infiltration', r.bd.HInf], ['Windows', r.bd.HWin], ['Walls', r.bd.HW], ['Ceiling', r.bd.HC]].map(([l, v]) => (
          <div key={l} className="flex justify-between text-xs">
            <span className="text-slate-400">{l}</span>
            <span className="font-mono text-slate-300">{Math.round(v / r.HEAT * 100)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function FullResults({ zone, climate, onBack, onPrint }) {
  const r   = calcZone(zone, climate)
  const hR  = zone.furnace_cap / r.HEAT
  const cR  = zone.ac_cap / r.COOL
  const rows = [
    ['Walls', r.bd.HW], ['Ceiling', r.bd.HC], ['Windows', r.bd.HWin], ['Doors', r.bd.HD],
    ['Below-grade walls', r.bd.HBG], ['Floor over uncond.', r.bd.HF],
    ['Infiltration', r.bd.HInf], ['Ventilation', r.bd.HVent],
    ['Duct losses', r.bd.HDuct], ['Solar credit', -r.bd.solCredit],
  ].filter(([, v]) => Math.abs(v) > 50)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-amber-950/20 border border-amber-800/30 rounded-xl p-4">
          <div className="text-xs font-mono uppercase tracking-wider text-slate-500 mb-1">Heating Load</div>
          <div className="font-display text-3xl text-amber-400">{fmt(r.HEAT)}</div>
          <div className="text-xs text-slate-500 mt-1">{(r.HEAT / 12000).toFixed(1)} tons · ΔT {r.hDT}°F</div>
        </div>
        <div className="bg-teal-950/20 border border-teal-800/30 rounded-xl p-4">
          <div className="text-xs font-mono uppercase tracking-wider text-slate-500 mb-1">Cooling Load</div>
          <div className="font-display text-3xl text-teal-400">{fmt(r.COOL)}</div>
          <div className="text-xs text-slate-500 mt-1">{(r.COOL / 12000).toFixed(1)} tons · SHR {r.SHR}</div>
        </div>
      </div>
      <Verdict ratio={hR} name="Furnace" icon="🔥" />
      <Verdict ratio={cR} name="AC / Cooling" icon="❄️" />
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-700/50 text-xs font-mono uppercase tracking-wider text-slate-500">Equipment Comparison</div>
        {[
          ['Recommended furnace', `${fmt(r.recH)} BTU/hr`],
          ['Your furnace',        `${fmt(zone.furnace_cap)} BTU/hr`],
          ['Recommended AC',      `${fmt(r.recC)} (${(r.recC / 12000).toFixed(1)}T)`],
          ['Your AC',             `${fmt(zone.ac_cap)} (${(zone.ac_cap / 12000).toFixed(1)}T)`],
        ].map(([l, v]) => (
          <div key={l} className="flex justify-between px-4 py-2 border-b border-slate-700/30 last:border-0 text-xs">
            <span className="text-slate-400">{l}</span>
            <span className="font-mono text-slate-200">{v}</span>
          </div>
        ))}
      </div>
      <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-700/50 text-xs font-mono uppercase tracking-wider text-slate-500">Heating Loss Breakdown</div>
        {rows.map(([l, v]) => (
          <div key={l} className="flex justify-between px-4 py-2 border-b border-slate-700/30 last:border-0 text-xs">
            <span className="text-slate-400">{l}</span>
            <span className={`font-mono ${v < 0 ? 'text-teal-400' : 'text-slate-200'}`}>
              {v < 0 ? '−' : ''}{fmt(Math.abs(v))} BTU/hr
            </span>
          </div>
        ))}
      </div>
      <Explainer>
        <strong>Note:</strong> Simplified Manual J estimate. A certified ACCA calculation is required for permit applications and before purchasing equipment.
      </Explainer>
      <StepNav onBack={onBack} onNext={onPrint} nextLabel="🖨 Print" />
    </div>
  )
}

// ─────────────────────────────────────────────
// STEP COMPONENTS
// ─────────────────────────────────────────────
function LandingStep({ onStart }) {
  return (
    <div className="max-w-lg py-2 space-y-5">
      <div>
        <div className="font-display text-4xl tracking-widest text-slate-100 uppercase leading-none">Manual J</div>
        <div className="font-display text-4xl tracking-widest text-amber-400 uppercase leading-none">Load Calc</div>
        <p className="text-slate-400 text-sm leading-relaxed mt-3">
          The ACCA Manual J method calculates exactly how much heating and cooling your home needs at your local design conditions.
          Use <strong className="text-slate-300">Zone-by-Zone</strong> mode to calculate each furnace/AC pair independently.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[
          ['🌡️', 'Design Conditions', '99th-percentile cold / 1st-percentile hot — not averages.'],
          ['🧱', 'Envelope Analysis',  'Walls, ceiling, floor, windows — every heat loss surface.'],
          ['💨', 'Infiltration',        'Air leakage is often 25–40% of heating load.'],
          ['🏠', '4-Zone Support',      'Calculate each furnace/AC zone independently.'],
        ].map(([icon, title, desc]) => (
          <div key={title} className="bg-slate-900 border border-slate-800 rounded-xl p-4">
            <div className="text-lg mb-1.5">{icon}</div>
            <div className="text-sm font-medium text-slate-200 mb-1">{title}</div>
            <div className="text-xs text-slate-500 leading-relaxed">{desc}</div>
          </div>
        ))}
      </div>
      <Explainer type="warn">
        <strong>Multiple zones?</strong> Use the <strong>Zone-by-Zone</strong> toggle in the header. Each zone gets its own inputs and a combined summary.
      </Explainer>
      <button className="btn-primary px-6 py-3 text-base" onClick={onStart}>Start →</button>
    </div>
  )
}

function ClimateStep({ climate, onChange, onBack, onNext }) {
  const set = (k, v) => onChange({ ...climate, [k]: v })
  return (
    <div className="space-y-4 max-w-2xl">
      <Explainer>
        <strong>Design temps</strong> are the 99th-percentile cold / 1st-percentile hot outdoor temperatures — not averages.
        Boston: heating ≈ <strong>9°F</strong>, cooling ≈ <strong>91°F</strong>.
      </Explainer>
      <FGrid>
        <Field label="City Preset">
          <select className="input" defaultValue="" onChange={e => {
            if (!e.target.value) return
            const [hd, hi, cd, ci, gr] = e.target.value.split(',').map(Number)
            onChange({ heat_design: hd, heat_indoor: hi, cool_design: cd, cool_indoor: ci, grains: gr })
          }}>
            <option value="">— select or enter manually —</option>
            {CITY_PRESETS.map(([l, v]) => <option key={l} value={v.join(',')}>{l}</option>)}
          </select>
        </Field>
        <Field label="Humidity (gr/lb)" hint="Boston≈65 · South≈80+ · Desert≈35">
          <input className="input" type="number" value={climate.grains} onChange={e => set('grains', +e.target.value)} />
        </Field>
        <Field label="Heating Design (°F outdoor)">
          <input className="input" type="number" value={climate.heat_design} onChange={e => set('heat_design', +e.target.value)} />
        </Field>
        <Field label="Heat Setpoint (°F indoor)">
          <input className="input" type="number" value={climate.heat_indoor} onChange={e => set('heat_indoor', +e.target.value)} />
        </Field>
        <Field label="Cooling Design (°F outdoor)">
          <input className="input" type="number" value={climate.cool_design} onChange={e => set('cool_design', +e.target.value)} />
        </Field>
        <Field label="Cool Setpoint (°F indoor)">
          <input className="input" type="number" value={climate.cool_indoor} onChange={e => set('cool_indoor', +e.target.value)} />
        </Field>
      </FGrid>
      <StepNav onBack={onBack} onNext={onNext} nextLabel="Next: Envelope →" />
    </div>
  )
}

function EnvelopeStep({ zone, onChange, onBack, onNext }) {
  const set = (k, v) => onChange({ ...zone, [k]: v })
  return (
    <div className="space-y-2 max-w-2xl">
      <Explainer>
        <strong>Wall area</strong> = perimeter × ceiling height minus windows/doors.
        R-values are on insulation packaging (R-13, R-38, etc.).
      </Explainer>
      <SubTitle>Geometry</SubTitle>
      <FGrid cols={3}>
        <Field label="Floor Area (ft²)">
          <input className="input" type="number" value={zone.floor_area} onChange={e => set('floor_area', +e.target.value)} />
        </Field>
        <Field label="Ceiling Height (ft)">
          <input className="input" type="number" value={zone.ceiling_height} onChange={e => set('ceiling_height', +e.target.value)} />
        </Field>
        <Field label="Wall Area (ft²)" hint="Perimeter×ht minus openings">
          <input className="input" type="number" value={zone.wall_area} onChange={e => set('wall_area', +e.target.value)} />
        </Field>
        <Field label="Ceiling Area (ft²)" hint="Top-floor footprint">
          <input className="input" type="number" value={zone.ceiling_area} onChange={e => set('ceiling_area', +e.target.value)} />
        </Field>
        <Field label="Floor Over Uncond. (ft²)" hint="0 if slab/cond. basement">
          <input className="input" type="number" value={zone.floor_uncond} onChange={e => set('floor_uncond', +e.target.value)} />
        </Field>
        <Field label="Below-Grade Wall (ft²)" hint="Basement walls below grade">
          <input className="input" type="number" value={zone.bg_wall_area} onChange={e => set('bg_wall_area', +e.target.value)} />
        </Field>
      </FGrid>
      <SubTitle>Insulation R-values</SubTitle>
      <FGrid>
        <Field label="Wall R-value">
          <select className="input" value={zone.r_wall} onChange={e => set('r_wall', +e.target.value)}>
            {[['Uninsulated (R-2)',2],['R-11 (2×4 batts)',11],['R-13/15 (2×4)',15],['R-19/21 (2×6)',19],['R-26 (2×6+foam)',26],['R-30+ (spray foam)',30]].map(([l,v]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Ceiling R-value">
          <select className="input" value={zone.r_ceiling} onChange={e => set('r_ceiling', +e.target.value)}>
            {[['R-19',19],['R-30',30],['R-38 (common)',38],['R-49',49],['R-60',60],['R-75+',75]].map(([l,v]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Floor R-value">
          <select className="input" value={zone.r_floor} onChange={e => set('r_floor', +e.target.value)}>
            {[['R-11',11],['R-19',19],['R-30',30],['R-38',38]].map(([l,v]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Below-Grade R">
          <select className="input" value={zone.r_bg_wall} onChange={e => set('r_bg_wall', +e.target.value)}>
            {[['Uninsulated (0)',0],['R-5',5],['R-10',10],['R-15',15],['R-20',20]].map(([l,v]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      </FGrid>
      <StepNav onBack={onBack} onNext={onNext} nextLabel="Next: Windows →" />
    </div>
  )
}

function WindowsStep({ zone, onChange, onBack, onNext }) {
  const set = (k, v) => onChange({ ...zone, [k]: v })
  return (
    <div className="space-y-2 max-w-2xl">
      <Explainer>
        <strong>Window U-factor</strong> is on the NFRC/ENERGY STAR label.
        Single pane≈1.0, double low-e≈0.28–0.35, triple≈0.15–0.22.
      </Explainer>
      <SubTitle>Windows</SubTitle>
      <FGrid>
        <Field label="Window Type">
          <select className="input" value={zone.window_u} onChange={e => set('window_u', +e.target.value)}>
            {[['Single pane, alum (U=1.10)',1.1],['Single pane, wood (U=0.65)',0.65],['Dbl pane, clear (U=0.48)',0.48],['Dbl pane, low-e (U=0.30)',0.30],['Dbl pane, low-e argon (U=0.25)',0.25],['Triple pane (U=0.18)',0.18]].map(([l,v]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
        <Field label="Total Window Area (ft²)">
          <input className="input" type="number" value={zone.window_area} onChange={e => set('window_area', +e.target.value)} />
        </Field>
        <Field label="SHGC" hint="Low-e≈0.20–0.30 · Clear≈0.60">
          <input className="input" type="number" step="0.01" value={zone.window_shgc} onChange={e => set('window_shgc', +e.target.value)} />
        </Field>
        <Field label="South-Facing (ft²)" hint="Gets winter solar credit">
          <input className="input" type="number" value={zone.south_window} onChange={e => set('south_window', +e.target.value)} />
        </Field>
      </FGrid>
      <SubTitle>Doors</SubTitle>
      <FGrid>
        <Field label="Door Type">
          <select className="input" value={zone.door_type} onChange={e => set('door_type', e.target.value)}>
            <option value="solid_wood">Solid wood (R-2)</option>
            <option value="insulated">Insulated steel (R-5)</option>
            <option value="fiberglass">Insulated fiberglass (R-7)</option>
          </select>
        </Field>
        <Field label="Total Door Area (ft²)" hint="Typical door ≈ 20 ft²">
          <input className="input" type="number" value={zone.door_area} onChange={e => set('door_area', +e.target.value)} />
        </Field>
      </FGrid>
      <StepNav onBack={onBack} onNext={onNext} nextLabel="Next: Infiltration →" />
    </div>
  )
}

function InfiltrationStep({ zone, onChange, onBack, onNext }) {
  const set = (k, v) => onChange({ ...zone, [k]: v })
  return (
    <div className="space-y-4 max-w-2xl">
      <Explainer>
        <strong>ACH50</strong> from a blower door test is the most accurate. Without a test, use the descriptions below.
        Typical 1990s–2000s home: 6–10 ACH50.
      </Explainer>
      <FGrid>
        <Field label="Construction Tightness">
          <select className="input" value={zone.infiltration} onChange={e => set('infiltration', e.target.value)}>
            <option value="tight">Tight — 2010+ well-sealed (≈2 ACH50)</option>
            <option value="average">Average — 1990s–2000s (≈7 ACH50)</option>
            <option value="loose">Loose — older, some weatherizing (≈15)</option>
            <option value="very_loose">Very loose — pre-1980 (≈25 ACH50)</option>
            <option value="custom">Custom — I have a blower door result</option>
          </select>
        </Field>
        <Field label="Custom ACH50" hint="Only if above = Custom">
          <input className="input" type="number" step="0.5" value={zone.custom_ach} onChange={e => set('custom_ach', +e.target.value)} />
        </Field>
        <Field label="Mech. Ventilation (CFM)" hint="0 if none · ERV/HRV or exhaust">
          <input className="input" type="number" value={zone.vent_cfm} onChange={e => set('vent_cfm', +e.target.value)} />
        </Field>
        <Field label="Ventilation Type">
          <select className="input" value={zone.ventilation} onChange={e => set('ventilation', e.target.value)}>
            <option value="none">None / exhaust-only</option>
            <option value="balanced">Balanced HRV/ERV (75% recovery)</option>
          </select>
        </Field>
      </FGrid>
      <StepNav onBack={onBack} onNext={onNext} nextLabel="Next: Internals →" />
    </div>
  )
}

function InternalsStep({ zone, onChange, onBack, onNext }) {
  const set = (k, v) => onChange({ ...zone, [k]: v })
  return (
    <div className="space-y-4 max-w-2xl">
      <Explainer>
        <strong>Why it matters:</strong> Your AC must remove internal heat in addition to outdoor heat gain.
        Typical home: 1,000–3,000 BTU/hr from occupants, lighting, and appliances.
      </Explainer>
      <FGrid cols={3}>
        <Field label="Occupants (peak)">
          <input className="input" type="number" value={zone.occupants} onChange={e => set('occupants', +e.target.value)} />
        </Field>
        <Field label="Lighting (W/ft²)" hint="LED≈0.5 · Mixed≈0.8 · Old≈1.5">
          <input className="input" type="number" step="0.1" value={zone.lighting} onChange={e => set('lighting', +e.target.value)} />
        </Field>
        <Field label="Appliances (BTU/hr)" hint="Kitchen≈1500 · Office≈300">
          <input className="input" type="number" value={zone.appliances} onChange={e => set('appliances', +e.target.value)} />
        </Field>
      </FGrid>
      <StepNav onBack={onBack} onNext={onNext} nextLabel="Next: Equipment →" />
    </div>
  )
}

function EquipmentStep({ zone, onChange, onBack, onNext }) {
  const set = (k, v) => onChange({ ...zone, [k]: v })
  return (
    <div className="space-y-4 max-w-2xl">
      <Explainer>
        <strong>Finding capacity:</strong> Check the furnace nameplate for input BTU/hr.
        AC tonnage is often in the model number (e.g., "024" = 24,000 BTU = 2 ton). 12,000 BTU = 1 ton.
      </Explainer>
      <FGrid>
        <Field label="Furnace Capacity (BTU/hr)" hint="Input BTU from nameplate — typically 40k–120k">
          <input className="input" type="number" value={zone.furnace_cap} onChange={e => set('furnace_cap', +e.target.value)} />
        </Field>
        <Field label="AC Capacity (BTU/hr)" hint="2T=24k · 3T=36k · 4T=48k">
          <input className="input" type="number" value={zone.ac_cap} onChange={e => set('ac_cap', +e.target.value)} />
        </Field>
        <Field label="Duct Location">
          <select className="input" value={zone.duct_location} onChange={e => set('duct_location', e.target.value)}>
            <option value="conditioned">Inside conditioned space</option>
            <option value="attic">Unconditioned attic</option>
            <option value="crawl">Vented crawlspace</option>
          </select>
        </Field>
        <Field label="Duct Leakage">
          <select className="input" value={zone.duct_leakage} onChange={e => set('duct_leakage', e.target.value)}>
            <option value="tight">Well-sealed (&lt;5%)</option>
            <option value="average">Typical (5–15%)</option>
            <option value="leaky">Leaky (&gt;15%)</option>
          </select>
        </Field>
      </FGrid>
      <StepNav onBack={onBack} onNext={onNext} nextLabel="Calculate Results →" />
    </div>
  )
}

function SummaryStep({ zones, climate, onBack, onPrint }) {
  const results = zones.map(z => ({ z, r: calcZone(z, climate) }))
  const tH    = results.reduce((s, { r }) => s + r.HEAT, 0)
  const tC    = results.reduce((s, { r }) => s + r.COOL, 0)
  const tFA   = zones.reduce((s, z) => s + z.floor_area, 0)
  const tFurn = zones.reduce((s, z) => s + z.furnace_cap, 0)
  const tAC   = zones.reduce((s, z) => s + z.ac_cap, 0)

  return (
    <div className="space-y-4">
      <Explainer type="warn">
        <strong>{zones.length}-zone system</strong> — the table below shows each zone's calculated load vs. installed equipment.
      </Explainer>
      <div className="overflow-x-auto rounded-xl border border-slate-800">
        <table className="w-full text-sm" style={{ minWidth: 520 }}>
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/50">
              {['Zone','ft²','Heating','BTU/ft²','Cooling','Furnace (ratio)','AC'].map(h => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-mono uppercase tracking-wider text-slate-500 font-normal whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {results.map(({ z, r }, i) => {
              const col = ZONE_COLORS[i % ZONE_COLORS.length]
              const hR  = (z.furnace_cap / r.HEAT).toFixed(2)
              const hCls = parseFloat(hR) <= 1.35 ? 'text-teal-400' : parseFloat(hR) <= 1.8 ? 'text-amber-400' : 'text-red-400'
              return (
                <tr key={i} className="border-b border-slate-800/50">
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-mono whitespace-nowrap"
                      style={{ background: `${col}18`, color: col, border: `1px solid ${col}50` }}>
                      ● {z.name}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-300">{z.floor_area.toLocaleString()}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-300">{fmt(r.HEAT)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-300">{Math.round(r.HEAT / z.floor_area)}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-300">{(r.COOL / 12000).toFixed(1)}T</td>
                  <td className={`px-4 py-2.5 font-mono text-xs ${hCls}`}>{(z.furnace_cap / 1000).toFixed(0)}k ({hR}×)</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-300">{(z.ac_cap / 12000).toFixed(1)}T</td>
                </tr>
              )
            })}
            <tr className="bg-slate-900/50 border-t-2 border-slate-700">
              <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-200">TOTAL</td>
              <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-200">{tFA.toLocaleString()}</td>
              <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-200">{fmt(tH)}</td>
              <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-200">{Math.round(tH / tFA)}</td>
              <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-200">{(tC / 12000).toFixed(1)}T</td>
              <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-200">{(tFurn / 1000).toFixed(0)}k</td>
              <td className="px-4 py-2.5 font-mono text-xs font-semibold text-slate-200">{(tAC / 12000).toFixed(1)}T</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-amber-950/20 border border-amber-800/30 rounded-xl p-4">
          <div className="text-xs font-mono uppercase tracking-wider text-slate-500 mb-1">Combined Heating</div>
          <div className="font-display text-3xl text-amber-400">{fmt(tH)}</div>
          <div className="text-xs text-slate-500 mt-1">{(tH / 12000).toFixed(1)} tons · {Math.round(tH / tFA)} BTU/ft²</div>
        </div>
        <div className="bg-teal-950/20 border border-teal-800/30 rounded-xl p-4">
          <div className="text-xs font-mono uppercase tracking-wider text-slate-500 mb-1">Combined Cooling</div>
          <div className="font-display text-3xl text-teal-400">{fmt(tC)}</div>
          <div className="text-xs text-slate-500 mt-1">{(tC / 12000).toFixed(1)} tons total</div>
        </div>
      </div>
      <Explainer>
        <strong>Sizing note:</strong> Ratios above 1.5× indicate oversizing. Short cycling (5–10 min cycles) at mild temps
        is a classic signature. Ideal ratio: 1.0–1.35×.
      </Explainer>
      <StepNav onBack={onBack} onNext={onPrint} nextLabel="🖨 Print All" />
    </div>
  )
}

// ─────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────
export default function ManualJ() {
  const [mode,        setMode]        = useState('whole')
  const [step,        setStep]        = useState(0)
  const [currentZone, setCurrentZone] = useState(0)
  const [climate,     setClimate]     = useState(DEFAULT_CLIMATE)
  const [wholeZone,   setWholeZone]   = useState(DEFAULT_WHOLE)
  const [zones,       setZones]       = useState(DEFAULT_ZONES)
  const [drawerOpen,  setDrawerOpen]  = useState(false)
  const [menuOpen,    setMenuOpen]    = useState(false)
  const [saveStatus,  setSaveStatus]  = useState('saved')
  const initialized = useRef(false)
  const saveTimer   = useRef(null)

  const activeZone = mode === 'whole' ? wholeZone : zones[currentZone]
  const setActiveZone = mode === 'whole'
    ? z => setWholeZone(z)
    : z => setZones(zs => zs.map((old, i) => i === currentZone ? z : old))

  function goStep(n) { setStep(n); setMenuOpen(false) }

  function switchMode(m) { setMode(m); setStep(0) }

  function addZone() {
    const n = zones.length
    setZones(zs => [...zs, mkZone(`Zone ${n + 1}`, 400, 300, 200, 1, 40000, 18000)])
    setCurrentZone(n)
  }
  function removeZone(i) {
    if (zones.length <= 1) return
    setZones(zs => zs.filter((_, idx) => idx !== i))
    setCurrentZone(c => Math.min(c, zones.length - 2))
  }
  function renameZone(i, name) {
    setZones(zs => zs.map((z, idx) => idx === i ? { ...z, name } : z))
  }

  // Load saved state on mount
  useEffect(() => {
    api.getManualJ().then(data => {
      if (data) {
        if (data.mode) setMode(data.mode)
        if (data.climate && Object.keys(data.climate).length) setClimate(data.climate)
        if (data.wholeZone && Object.keys(data.wholeZone).length) setWholeZone(data.wholeZone)
        if (Array.isArray(data.zones) && data.zones.length) setZones(data.zones)
      }
      setTimeout(() => { initialized.current = true }, 0)
    }).catch(() => { initialized.current = true })
  }, [])

  // Auto-save on change
  useEffect(() => {
    if (!initialized.current) return
    setSaveStatus('saving')
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      api.saveManualJ({ mode, climate, wholeZone, zones })
        .then(() => setSaveStatus('saved'))
        .catch(() => setSaveStatus('error'))
    }, 800)
  }, [mode, climate, wholeZone, zones])

  function printManualJReport() {
    const date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
    const modeLabel = mode === 'whole' ? 'Whole-Home' : `Zone-by-Zone (${zones.length} zone${zones.length !== 1 ? 's' : ''})`

    const doorLabel  = { solid_wood: 'Solid wood (R-2)', insulated: 'Insulated steel (R-5)', fiberglass: 'Insulated fiberglass (R-7)' }
    const ventLabel  = { none: 'None / exhaust-only', balanced: 'Balanced HRV/ERV (75% recovery)' }
    const dLocLabel  = { conditioned: 'Conditioned space', attic: 'Unconditioned attic', crawl: 'Vented crawlspace' }
    const dLeakLabel = { tight: 'Well-sealed (<5%)', average: 'Typical (5–15%)', leaky: 'Leaky (>15%)' }
    const ach50Map   = { tight: 2, average: 7, loose: 15, very_loose: 25 }

    function infText(z) {
      if (z.infiltration === 'custom') return `Custom (${z.custom_ach} ACH50)`
      const labels = { tight: 'Tight', average: 'Average', loose: 'Loose', very_loose: 'Very loose' }
      return `${labels[z.infiltration] || z.infiltration} (≈${ach50Map[z.infiltration]} ACH50)`
    }
    function sizeCls(r) { return r < 0.9 ? 'over' : r <= 1.35 ? 'good' : r <= 1.8 ? 'warn' : 'over' }
    function sizeTxt(r) { return r < 0.9 ? 'Undersized' : r <= 1.35 ? 'Well-sized' : r <= 1.8 ? 'Slightly oversized' : 'Significantly oversized' }

    function zoneInputs(z) {
      return `
        <table>
          <thead><tr><th>Floor Area</th><th>Ceiling Ht</th><th>Wall Area</th><th>Ceiling Area</th><th>Floor/Uncond.</th><th>BG Wall</th></tr></thead>
          <tbody><tr>
            <td>${z.floor_area.toLocaleString()} ft²</td><td>${z.ceiling_height} ft</td>
            <td>${z.wall_area.toLocaleString()} ft²</td><td>${z.ceiling_area.toLocaleString()} ft²</td>
            <td>${z.floor_uncond > 0 ? z.floor_uncond + ' ft²' : '—'}</td>
            <td>${z.bg_wall_area > 0 ? z.bg_wall_area + ' ft²' : '—'}</td>
          </tr></tbody>
        </table>
        <table>
          <thead><tr><th>Wall R</th><th>Ceiling R</th><th>Floor R</th><th>BG Wall R</th><th>Window U</th><th>Window Area</th><th>SHGC</th><th>South-Facing</th></tr></thead>
          <tbody><tr>
            <td>R-${z.r_wall}</td><td>R-${z.r_ceiling}</td><td>R-${z.r_floor}</td>
            <td>${z.r_bg_wall > 0 ? 'R-' + z.r_bg_wall : '—'}</td>
            <td>U-${z.window_u}</td><td>${z.window_area} ft²</td><td>${z.window_shgc}</td><td>${z.south_window} ft²</td>
          </tr></tbody>
        </table>
        <table>
          <thead><tr><th>Door Type</th><th>Door Area</th><th>Infiltration</th><th>Mech. Vent</th><th>Occupants</th><th>Lighting</th><th>Appliances</th></tr></thead>
          <tbody><tr>
            <td>${doorLabel[z.door_type] || z.door_type}</td><td>${z.door_area} ft²</td>
            <td>${infText(z)}</td>
            <td>${z.vent_cfm > 0 ? z.vent_cfm + ' CFM · ' + (ventLabel[z.ventilation] || z.ventilation) : '—'}</td>
            <td>${z.occupants}</td><td>${z.lighting} W/ft²</td><td>${z.appliances.toLocaleString()} BTU/hr</td>
          </tr></tbody>
        </table>
        <table>
          <thead><tr><th>Furnace Installed</th><th>AC Installed</th><th>Duct Location</th><th>Duct Leakage</th></tr></thead>
          <tbody><tr>
            <td>${z.furnace_cap.toLocaleString()} BTU/hr</td>
            <td>${z.ac_cap.toLocaleString()} BTU/hr (${(z.ac_cap / 12000).toFixed(1)} tons)</td>
            <td>${dLocLabel[z.duct_location] || z.duct_location}</td>
            <td>${dLeakLabel[z.duct_leakage] || z.duct_leakage}</td>
          </tr></tbody>
        </table>`
    }

    function zoneResults(z, r) {
      const hR = z.furnace_cap / r.HEAT
      const cR = z.ac_cap / r.COOL
      const breakdown = [
        ['Walls', r.bd.HW], ['Ceiling', r.bd.HC], ['Windows', r.bd.HWin], ['Doors', r.bd.HD],
        ['Below-grade walls', r.bd.HBG], ['Floor over uncond.', r.bd.HF],
        ['Infiltration', r.bd.HInf], ['Ventilation', r.bd.HVent],
        ['Duct losses', r.bd.HDuct], ['Solar credit', -r.bd.solCredit],
      ].filter(([, v]) => Math.abs(v) > 50)
      return `
        <div class="summary-grid">
          <div class="summary-card">
            <div class="label">Heating Load</div>
            <div class="value" style="color:#b45309">${fmt(r.HEAT)}</div>
            <div class="sub">BTU/hr · ${(r.HEAT / 12000).toFixed(1)} tons · ΔT ${r.hDT}°F</div>
          </div>
          <div class="summary-card">
            <div class="label">Cooling Load</div>
            <div class="value" style="color:#0d9488">${fmt(r.COOL)}</div>
            <div class="sub">BTU/hr · ${(r.COOL / 12000).toFixed(1)} tons · SHR ${r.SHR}</div>
          </div>
          <div class="summary-card">
            <div class="label">Heating Intensity</div>
            <div class="value">${Math.round(r.HEAT / z.floor_area)}</div>
            <div class="sub">BTU/hr·ft² (target 20–50)</div>
          </div>
          <div class="summary-card">
            <div class="label">Floor Area</div>
            <div class="value">${z.floor_area.toLocaleString()}</div>
            <div class="sub">conditioned sq ft</div>
          </div>
        </div>
        <table>
          <thead><tr><th>Equipment</th><th>Calculated Load</th><th>Recommended</th><th>Installed</th><th>Ratio</th><th>Status</th></tr></thead>
          <tbody>
            <tr>
              <td>Furnace (heating)</td>
              <td>${fmt(r.HEAT)} BTU/hr</td><td>${fmt(r.recH)} BTU/hr</td>
              <td>${fmt(z.furnace_cap)} BTU/hr</td>
              <td class="${sizeCls(hR)}">${hR.toFixed(2)}×</td>
              <td class="${sizeCls(hR)}">${sizeTxt(hR)}</td>
            </tr>
            <tr>
              <td>AC / Cooling</td>
              <td>${fmt(r.COOL)} BTU/hr (${(r.COOL / 12000).toFixed(1)}T)</td>
              <td>${fmt(r.recC)} BTU/hr (${(r.recC / 12000).toFixed(1)}T)</td>
              <td>${fmt(z.ac_cap)} BTU/hr (${(z.ac_cap / 12000).toFixed(1)}T)</td>
              <td class="${sizeCls(cR)}">${cR.toFixed(2)}×</td>
              <td class="${sizeCls(cR)}">${sizeTxt(cR)}</td>
            </tr>
          </tbody>
        </table>
        <table>
          <thead><tr><th>Heat Loss Component</th><th>BTU/hr</th><th>% of Load</th></tr></thead>
          <tbody>
            ${breakdown.map(([l, v]) => `<tr>
              <td>${l}</td>
              <td style="${v < 0 ? 'color:#16a34a' : ''}">${v < 0 ? '−' : ''}${fmt(Math.abs(v))}</td>
              <td>${v < 0 ? '(credit)' : Math.round(Math.abs(v) / r.HEAT * 100) + '%'}</td>
            </tr>`).join('')}
            <tr style="background:#f0f0f0"><td><strong>Total Heating Load</strong></td><td><strong>${fmt(r.HEAT)} BTU/hr</strong></td><td><strong>100%</strong></td></tr>
          </tbody>
        </table>`
    }

    let summaryHtml = ''
    if (mode === 'zones' && zones.length > 1) {
      const results = zones.map(z => ({ z, r: calcZone(z, climate) }))
      const tH = results.reduce((s, { r }) => s + r.HEAT, 0)
      const tC = results.reduce((s, { r }) => s + r.COOL, 0)
      const tFA = zones.reduce((s, z) => s + z.floor_area, 0)
      summaryHtml = `
        <h2>Zone Summary</h2>
        <table>
          <thead><tr><th>Zone</th><th>Area (ft²)</th><th>Heating Load</th><th>BTU/ft²</th><th>Cooling</th><th>Furnace (ratio)</th><th>AC</th></tr></thead>
          <tbody>
            ${results.map(({ z, r }) => {
              const hR = z.furnace_cap / r.HEAT
              return `<tr>
                <td>${z.name}</td><td>${z.floor_area.toLocaleString()}</td>
                <td>${fmt(r.HEAT)}</td><td>${Math.round(r.HEAT / z.floor_area)}</td>
                <td>${(r.COOL / 12000).toFixed(1)}T</td>
                <td class="${sizeCls(hR)}">${(z.furnace_cap / 1000).toFixed(0)}k (${hR.toFixed(2)}×)</td>
                <td>${(z.ac_cap / 12000).toFixed(1)}T</td>
              </tr>`
            }).join('')}
            <tr style="background:#f0f0f0;font-weight:bold">
              <td>TOTAL</td><td>${tFA.toLocaleString()}</td>
              <td>${fmt(tH)}</td><td>${Math.round(tH / tFA)}</td>
              <td>${(tC / 12000).toFixed(1)}T</td><td colspan="2"></td>
            </tr>
          </tbody>
        </table>`
    }

    const zonesList = mode === 'whole' ? [wholeZone] : zones
    const bodyHtml = zonesList.map((z, i) => {
      const r = calcZone(z, climate)
      return `
        ${mode === 'zones' ? `<div class="zone-header">${z.name}</div>` : ''}
        <h2>Inputs</h2>${zoneInputs(z)}
        <h2>Results</h2>${zoneResults(z, r)}`
    }).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>Manual J Load Calculation</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:28px 36px;max-width:900px;margin:0 auto}
      h1{font-size:18px;font-weight:bold;margin-bottom:2px}
      .subtitle{font-size:11px;color:#555;margin-bottom:18px}
      h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:#555;border-bottom:2px solid #111;padding-bottom:4px;margin:20px 0 10px}
      table{width:100%;border-collapse:collapse;margin-bottom:10px}
      th{background:#f0f0f0;text-align:left;padding:5px 8px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;border:1px solid #ccc}
      td{padding:5px 8px;border:1px solid #ddd;vertical-align:top}
      tr:nth-child(even) td{background:#fafafa}
      .summary-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px}
      .summary-card{border:1px solid #ccc;border-radius:4px;padding:10px 12px}
      .summary-card .label{font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#777;margin-bottom:3px}
      .summary-card .value{font-size:18px;font-weight:bold;margin-bottom:1px}
      .summary-card .sub{font-size:10px;color:#777}
      .good{color:#16a34a}.warn{color:#b45309}.over{color:#dc2626}
      .zone-header{background:#f5f5f5;padding:8px 12px;margin:20px 0 8px;border-left:3px solid #555;font-weight:bold;font-size:13px}
      .disclaimer{margin-top:24px;padding:10px 12px;border:1px solid #ccc;border-radius:4px;font-size:10px;color:#555;line-height:1.6}
      .footer{margin-top:16px;font-size:10px;color:#999;border-top:1px solid #eee;padding-top:8px}
      @media print{body{padding:16px 20px}@page{margin:.75in}.zone-header{page-break-before:always}}
    </style>
    </head><body>
    <h1>ACCA Manual J Residential Load Calculation</h1>
    <div class="subtitle">Prepared: ${date} &nbsp;|&nbsp; Method: ACCA Manual J (Simplified) &nbsp;|&nbsp; Mode: ${modeLabel}</div>

    <h2>Climate &amp; Design Conditions</h2>
    <table>
      <thead><tr><th>Parameter</th><th>Heating Design</th><th>Cooling Design</th></tr></thead>
      <tbody>
        <tr><td>Outdoor Design Temperature</td><td>${climate.heat_design}°F</td><td>${climate.cool_design}°F</td></tr>
        <tr><td>Indoor Setpoint</td><td>${climate.heat_indoor}°F</td><td>${climate.cool_indoor}°F</td></tr>
        <tr><td>Design ΔT</td><td>${climate.heat_indoor - climate.heat_design}°F</td><td>${climate.cool_design - climate.cool_indoor}°F</td></tr>
        <tr><td>Outdoor Humidity (gr/lb)</td><td>—</td><td>${climate.grains} gr/lb</td></tr>
      </tbody>
    </table>

    ${summaryHtml}
    ${bodyHtml}

    <div class="disclaimer">
      <strong>Planning Estimate Only.</strong> This is a simplified implementation of the ACCA Manual J residential load calculation method.
      Results are suitable for planning and preliminary equipment sizing only. A certified Manual J calculation by a licensed HVAC contractor
      or mechanical engineer is required before purchasing equipment, applying for permits, or installing HVAC systems.
      Solar credit: south-facing glazing at 55 BTU/hr·ft²·SHGC×30% (heating) and 125 BTU/hr·ft²·SHGC×60% (cooling).
      Duct loss multipliers per ACCA Manual J Table 7A. Infiltration via ACH50 ÷ 18 rule-of-thumb.
    </div>
    <div class="footer">Generated by Home Planner &nbsp;|&nbsp; ${date}</div>
    </body></html>`

    const w = window.open('', '_blank')
    w.document.write(html)
    w.document.close()
    w.focus()
    setTimeout(() => w.print(), 400)
  }

  const stepLabels = mode === 'whole' ? WH_STEPS : Z_STEPS
  const maxStep    = 7

  // Step metadata for the header
  const WH_META = [
    null,
    { tag: 'Step 01', title: 'Climate & Design',  desc: 'Your local outdoor conditions. Boston defaults pre-filled.' },
    { tag: 'Step 02', title: 'Building Envelope',  desc: 'Every surface separating conditioned space from outside.' },
    { tag: 'Step 03', title: 'Windows & Doors',    desc: 'Often 25–40% of total heat loss. Glazing type and area matter most.' },
    { tag: 'Step 04', title: 'Infiltration',        desc: 'Uncontrolled air leakage is often 20–40% of heating load.' },
    { tag: 'Step 05', title: 'Internal Gains',      desc: 'People, lights, and appliances generate heat — mainly affects cooling load.' },
    { tag: 'Step 06', title: 'Your Equipment',      desc: 'Enter installed capacity so we can compare against calculated load.' },
    { tag: 'Results',  title: 'Whole-Home Load',    desc: 'Complete heating and cooling load with equipment comparison.' },
  ]
  const Z_META = [
    { tag: 'Step 01', title: 'Climate & Design',  desc: 'Shared across all zones — your local outdoor conditions.' },
    { tag: 'Step 02', title: 'Building Envelope',  desc: 'Envelope areas specific to this zone only.' },
    { tag: 'Step 03', title: 'Windows & Doors',    desc: 'Windows and doors in this zone only.' },
    { tag: 'Step 04', title: 'Infiltration',        desc: 'Air leakage for this zone.' },
    { tag: 'Step 05', title: 'Internal Gains',      desc: 'Occupants, lighting, and appliances in this zone.' },
    { tag: 'Step 06', title: 'Equipment',           desc: 'The furnace and AC unit serving this zone.' },
    { tag: 'Results',  title: 'Zone Results',       desc: 'Calculated load for this zone.' },
    { tag: 'Summary',  title: 'All Zones',          desc: 'Individual loads per zone and combined whole-home demand.' },
  ]
  const meta = (mode === 'whole' ? WH_META : Z_META)[step] ?? null

  function renderStep() {
    if (mode === 'whole') {
      if (step === 0) return <LandingStep onStart={() => goStep(1)} />
      if (step === 1) return <ClimateStep    climate={climate}    onChange={setClimate}     onBack={() => goStep(0)} onNext={() => goStep(2)} />
      if (step === 2) return <EnvelopeStep   zone={activeZone}    onChange={setActiveZone}  onBack={() => goStep(1)} onNext={() => goStep(3)} />
      if (step === 3) return <WindowsStep    zone={activeZone}    onChange={setActiveZone}  onBack={() => goStep(2)} onNext={() => goStep(4)} />
      if (step === 4) return <InfiltrationStep zone={activeZone}  onChange={setActiveZone}  onBack={() => goStep(3)} onNext={() => goStep(5)} />
      if (step === 5) return <InternalsStep  zone={activeZone}    onChange={setActiveZone}  onBack={() => goStep(4)} onNext={() => goStep(6)} />
      if (step === 6) return <EquipmentStep  zone={activeZone}    onChange={setActiveZone}  onBack={() => goStep(5)} onNext={() => goStep(7)} />
      if (step === 7) return <FullResults    zone={wholeZone}     climate={climate}         onBack={() => goStep(6)} onPrint={printManualJReport} />
    } else {
      if (step === 0) return (
        <>
          <Explainer type="warn"><strong>Shared setting:</strong> Climate settings apply to all zones.</Explainer>
          <ClimateStep climate={climate} onChange={setClimate} onBack={null} onNext={() => goStep(1)} />
        </>
      )
      if (step === 1) return <EnvelopeStep    zone={activeZone}  onChange={setActiveZone}  onBack={() => goStep(0)} onNext={() => goStep(2)} />
      if (step === 2) return <WindowsStep     zone={activeZone}  onChange={setActiveZone}  onBack={() => goStep(1)} onNext={() => goStep(3)} />
      if (step === 3) return <InfiltrationStep zone={activeZone} onChange={setActiveZone}  onBack={() => goStep(2)} onNext={() => goStep(4)} />
      if (step === 4) return <InternalsStep   zone={activeZone}  onChange={setActiveZone}  onBack={() => goStep(3)} onNext={() => goStep(5)} />
      if (step === 5) return <EquipmentStep   zone={activeZone}  onChange={setActiveZone}  onBack={() => goStep(4)} onNext={() => goStep(6)} />
      if (step === 6) return <FullResults     zone={activeZone}  climate={climate}         onBack={() => goStep(5)} onPrint={() => goStep(7)} />
      if (step === 7) return <SummaryStep     zones={zones}      climate={climate}         onBack={() => goStep(6)} onPrint={printManualJReport} />
    }
    return null
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header bar ── */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-slate-800 bg-slate-900/50 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-display text-lg tracking-widest uppercase text-slate-100">Manual</span>
          <span className="font-display text-lg tracking-widest uppercase text-amber-400">J</span>
          <span className="font-mono text-[10px] bg-amber-500 text-slate-950 px-1.5 py-0.5 rounded font-semibold tracking-wider">MULTI-ZONE</span>
          <span className={`text-[10px] font-mono hidden lg:inline ${saveStatus === 'saved' ? 'text-slate-600' : saveStatus === 'saving' ? 'text-amber-500' : 'text-red-400'}`}>
            {saveStatus === 'saved' ? '● Saved' : saveStatus === 'saving' ? '● Saving…' : '● Save failed'}
          </span>
        </div>
        <button onClick={printManualJReport} className="btn-ghost text-xs py-1 px-3 hidden lg:block ml-auto">🖨 Print / PDF</button>
        <div className="flex items-center gap-1 bg-slate-800 border border-slate-700 rounded-lg p-0.5">
          {(['whole', 'zones']).map(m => (
            <button key={m} onClick={() => switchMode(m)}
              className={`px-3 py-1.5 rounded-md text-xs font-mono transition-all ${
                mode === m ? 'bg-amber-500 text-slate-950 font-semibold' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {m === 'whole' ? 'Whole Home' : 'Zone-by-Zone'}
            </button>
          ))}
        </div>
      </div>


      {/* ── Desktop step progress bar ── */}
      <div className="hidden lg:flex items-center overflow-x-auto border-b border-slate-800 bg-slate-900/20 flex-shrink-0" style={{ scrollbarWidth: 'none' }}>
        {stepLabels.map((label, i) => (
          <button key={i} onClick={() => goStep(i)}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs border-b-2 transition-all whitespace-nowrap flex-shrink-0 ${
              i === step
                ? 'border-amber-500 text-amber-400 bg-amber-500/5'
                : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'
            }`}
          >
            <span className="font-mono text-slate-700 text-[10px] w-4 text-right">{String(i + (mode === 'zones' ? 1 : 0)).padStart(2, '0')}</span>
            {label}
          </button>
        ))}
        {mode === 'zones' && (
          <button onClick={() => goStep(7)}
            className={`flex items-center gap-2 px-4 py-2.5 text-xs border-b-2 transition-all whitespace-nowrap flex-shrink-0 ${
              step === 7
                ? 'border-amber-500 text-amber-400 bg-amber-500/5'
                : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-800/50'
            }`}
          >
            <span className="font-mono text-slate-700 text-[10px] w-4 text-right">Σ</span>
            All Zones
          </button>
        )}
      </div>

      {/* ── Content row ── */}
      <div className="flex flex-1 overflow-hidden">

      {/* ── Main column ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 pb-28 lg:pb-8">

            {/* Zone tabs (zones mode only, not on summary) */}
            {mode === 'zones' && step < 7 && (
              <>
                <div className="flex items-center gap-2 mb-4 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
                  {zones.map((z, i) => (
                    <button key={i} onClick={() => setCurrentZone(i)}
                      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono border transition-all whitespace-nowrap shrink-0 ${
                        i === currentZone
                          ? 'border-blue-600/50 text-blue-400 bg-blue-500/5'
                          : 'border-slate-700 text-slate-500 bg-slate-800/50 hover:text-slate-300'
                      }`}
                    >
                      <span className="w-2 h-2 rounded-full shrink-0" style={{ background: ZONE_COLORS[i % ZONE_COLORS.length] }} />
                      {z.name}
                      {zones.length > 1 && (
                        <span className="opacity-40 hover:opacity-100 hover:text-red-400 ml-0.5 transition-all"
                          onClick={e => { e.stopPropagation(); removeZone(i) }}>✕</span>
                      )}
                    </button>
                  ))}
                  {zones.length < 8 && (
                    <button onClick={addZone}
                      className="px-3 py-1.5 rounded-lg text-xs font-mono border border-dashed border-amber-500/40 text-amber-400 hover:bg-amber-500/5 whitespace-nowrap shrink-0 transition-all">
                      + Zone
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 mb-5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: ZONE_COLORS[currentZone % ZONE_COLORS.length] }} />
                  <input
                    className="bg-transparent border-b border-slate-700 focus:border-amber-500 focus:outline-none text-slate-100 font-display text-xl tracking-wide pb-0.5 min-w-0 flex-1 max-w-xs transition-colors"
                    value={zones[currentZone]?.name ?? ''}
                    onChange={e => renameZone(currentZone, e.target.value)}
                  />
                </div>
              </>
            )}

            {meta && <StepHeader tag={meta.tag} title={meta.title} desc={meta.desc} />}
            {renderStep()}
          </div>
        </div>

        {/* ── Mobile bottom nav ── */}
        <div className="lg:hidden fixed bottom-0 left-0 right-0 z-40 flex items-stretch border-t border-slate-800 bg-slate-950/95 backdrop-blur-sm">
          {[
            { label: 'Back',     icon: <polyline points="15 18 9 12 15 6"/>,                                           action: () => step > 0 && goStep(step - 1), disabled: step === 0 },
            { label: 'Steps',    icon: <><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></>, action: () => setMenuOpen(true),   disabled: false },
            { label: 'Estimate', icon: <path d="M18 20V10M12 20V4M6 20v-6"/>,                                         action: () => setDrawerOpen(true), disabled: false },
            { label: 'Next',     icon: <polyline points="9 18 15 12 9 6"/>,                                            action: () => step < maxStep && goStep(step + 1), disabled: step >= maxStep },
          ].map(({ label, icon, action, disabled }) => (
            <button key={label} onClick={action} disabled={disabled}
              className={`flex-1 flex flex-col items-center justify-center gap-1 py-3 transition-colors ${
                disabled ? 'text-slate-700' : 'text-slate-500 hover:text-slate-200 active:text-amber-400'
              }`}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{icon}</svg>
              <span className="text-[10px] font-mono uppercase tracking-wider">{label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Desktop results panel ── */}
      <aside className="hidden lg:block w-[260px] flex-shrink-0 border-l border-slate-800 overflow-y-auto p-4 bg-slate-900/30">
        <div className="text-xs font-mono uppercase tracking-widest text-slate-600 pb-3 border-b border-slate-800 mb-3">
          {mode === 'zones'
            ? <><span style={{ color: ZONE_COLORS[currentZone % ZONE_COLORS.length] }}>● </span>{zones[currentZone]?.name}</>
            : 'Live Estimate'}
        </div>
        <LivePanel zone={activeZone} climate={climate} />
      </aside>

      </div>{/* ── end content row ── */}

      {/* ── Mobile estimate drawer ── */}
      {drawerOpen && (
        <>
          <div className="fixed inset-0 bg-black/60 z-50 lg:hidden" onClick={() => setDrawerOpen(false)} />
          <div className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 rounded-t-2xl z-50 lg:hidden max-h-[80vh] overflow-y-auto">
            <div className="w-9 h-1 rounded-full bg-slate-700 mx-auto mt-3 mb-1" />
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
              <h3 className="font-display text-lg tracking-wide text-slate-100">Live Estimate</h3>
              <button className="text-slate-500 hover:text-slate-300 text-sm" onClick={() => setDrawerOpen(false)}>Close</button>
            </div>
            <div className="p-4"><LivePanel zone={activeZone} climate={climate} /></div>
          </div>
        </>
      )}

      {/* ── Mobile steps menu drawer ── */}
      {menuOpen && (
        <>
          <div className="fixed inset-0 bg-black/60 z-50 lg:hidden" onClick={() => setMenuOpen(false)} />
          <div className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 rounded-t-2xl z-50 lg:hidden max-h-[80vh] overflow-y-auto">
            <div className="w-9 h-1 rounded-full bg-slate-700 mx-auto mt-3 mb-1" />
            <div className="flex items-center justify-between px-5 py-3 border-b border-slate-800">
              <h3 className="font-display text-lg tracking-wide text-slate-100">Jump to Step</h3>
              <button className="text-slate-500 hover:text-slate-300 text-sm" onClick={() => setMenuOpen(false)}>Close</button>
            </div>
            <div className="p-3 space-y-0.5">
              {stepLabels.map((label, i) => (
                <button key={i} onClick={() => goStep(i)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs text-left transition-all ${
                    i === step ? 'bg-amber-500/10 text-amber-400' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  <span className="font-mono text-slate-600 w-5 text-right shrink-0">
                    {String(i + (mode === 'zones' ? 1 : 0)).padStart(2, '0')}
                  </span>
                  {label}
                </button>
              ))}
              {mode === 'zones' && (
                <button onClick={() => goStep(7)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 rounded-lg text-xs text-left transition-all ${
                    step === 7 ? 'bg-amber-500/10 text-amber-400' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
                  }`}
                >
                  <span className="font-mono text-slate-600 w-5 text-right shrink-0">Σ</span>
                  All Zones Summary
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
