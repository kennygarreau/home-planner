import { useState, useEffect, useRef } from 'react'
import { api } from '../api/index.js'
import { ArrowLeft, Wind, Zap, Thermometer, PaintBucket, TrendingUp, Calculator } from 'lucide-react'

// ─────────────────────────────────────────────
// SHARED UI HELPERS
// ─────────────────────────────────────────────
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

function ResultGrid({ children }) {
  return <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{children}</div>
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
// 1. MANUAL J (iframe)
// ─────────────────────────────────────────────
function ManualJ() {
  return (
    <div className="flex flex-col h-full">
      <p className="text-sm text-slate-500 mb-4">
        ACCA Manual J residential load calculation — sizes heating and cooling equipment by calculating heat loss/gain through every surface of your home.
      </p>
      <div className="flex-1 rounded-xl overflow-hidden border border-slate-800" style={{ minHeight: '75vh' }}>
        <iframe
          src="/tools/manual-j.html"
          className="w-full h-full"
          style={{ minHeight: '75vh' }}
          title="Manual J Load Calculator"
        />
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// 2. PAINT & MATERIAL CALCULATOR
// ─────────────────────────────────────────────
function PaintCalc() {
  const [rooms, setRooms] = useState([{ id: 1, name: 'Living Room', length: '', width: '', height: '', doors: 1, windows: 2 }])
  const [coats, setCoats] = useState(2)
  const [coverage, setCoverage] = useState(350)
  const [materialType, setMaterialType] = useState('paint')
  const [tileSize, setTileSize] = useState(12)
  const [wastePct, setWastePct] = useState(10)

  const addRoom = () => setRooms(r => [...r, { id: Date.now(), name: `Room ${r.length + 1}`, length: '', width: '', height: '', doors: 1, windows: 2 }])
  const updateRoom = (id, key, val) => setRooms(r => r.map(rm => rm.id === id ? { ...rm, [key]: val } : rm))
  const removeRoom = (id) => setRooms(r => r.filter(rm => rm.id !== id))

  const DOOR_SF = 21   // 3×7
  const WINDOW_SF = 15 // avg window

  const roomResults = rooms.map(rm => {
    const l = parseFloat(rm.length) || 0
    const w = parseFloat(rm.width) || 0
    const h = parseFloat(rm.height) || 8
    const wallArea = 2 * (l + w) * h
    const deductions = (rm.doors * DOOR_SF) + (rm.windows * WINDOW_SF)
    const netWall = Math.max(0, wallArea - deductions)
    const ceilingArea = l * w
    const floorArea = l * w
    return { ...rm, wallArea, netWall, ceilingArea, floorArea }
  })

  const totalWall = roomResults.reduce((s, r) => s + r.netWall, 0)
  const totalCeiling = roomResults.reduce((s, r) => s + r.ceilingArea, 0)
  const totalFloor = roomResults.reduce((s, r) => s + r.floorArea, 0)

  // Paint
  const paintArea = totalWall + totalCeiling
  const gallons = Math.ceil((paintArea * coats) / coverage)

  // Flooring
  const floorWithWaste = totalFloor * (1 + wastePct / 100)
  const sqYards = floorWithWaste / 9
  const boxes12 = Math.ceil(floorWithWaste / (tileSize === 12 ? 1 : tileSize === 18 ? 2.25 : 4)) // tiles per box ~20

  return (
    <div className="space-y-6 max-w-2xl">
      <Section title="Rooms">
        <div className="space-y-3">
          {rooms.map(rm => (
            <div key={rm.id} className="card p-4 space-y-3">
              <div className="flex items-center gap-2">
                <input className="input flex-1" value={rm.name} onChange={e => updateRoom(rm.id, 'name', e.target.value)} placeholder="Room name" />
                {rooms.length > 1 && (
                  <button className="p-1.5 text-slate-500 hover:text-red-400" onClick={() => removeRoom(rm.id)}>✕</button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="label">Length (ft)</label>
                  <input className="input" type="number" value={rm.length} onChange={e => updateRoom(rm.id, 'length', e.target.value)} placeholder="0" />
                </div>
                <div>
                  <label className="label">Width (ft)</label>
                  <input className="input" type="number" value={rm.width} onChange={e => updateRoom(rm.id, 'width', e.target.value)} placeholder="0" />
                </div>
                <div>
                  <label className="label">Height (ft)</label>
                  <input className="input" type="number" value={rm.height} onChange={e => updateRoom(rm.id, 'height', e.target.value)} placeholder="8" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">Doors</label>
                  <input className="input" type="number" min="0" value={rm.doors} onChange={e => updateRoom(rm.id, 'doors', e.target.value)} />
                </div>
                <div>
                  <label className="label">Windows</label>
                  <input className="input" type="number" min="0" value={rm.windows} onChange={e => updateRoom(rm.id, 'windows', e.target.value)} />
                </div>
              </div>
            </div>
          ))}
          <button className="btn-ghost w-full" onClick={addRoom}>+ Add Room</button>
        </div>
      </Section>

      <Section title="Paint Settings">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Coats">
            <select className="input" value={coats} onChange={e => setCoats(Number(e.target.value))}>
              <option value={1}>1 coat</option>
              <option value={2}>2 coats</option>
              <option value={3}>3 coats</option>
            </select>
          </Field>
          <Field label="Coverage (sq ft / gallon)" hint="Typical: 350–400">
            <input className="input" type="number" value={coverage} onChange={e => setCoverage(Number(e.target.value))} />
          </Field>
        </div>
      </Section>

      <Section title="Flooring Settings">
        <div className="grid grid-cols-2 gap-4">
          <Field label="Tile Size">
            <select className="input" value={tileSize} onChange={e => setTileSize(Number(e.target.value))}>
              <option value={12}>12×12</option>
              <option value={18}>18×18</option>
              <option value={24}>24×24</option>
            </select>
          </Field>
          <Field label="Waste Factor %" hint="10% standard, 15% diagonal">
            <input className="input" type="number" value={wastePct} onChange={e => setWastePct(Number(e.target.value))} />
          </Field>
        </div>
      </Section>

      {totalWall > 0 && (
        <Section title="Results">
          <ResultGrid>
            <Result label="Total Wall Area" value={`${Math.round(totalWall).toLocaleString()} ft²`} sub="after door/window deductions" />
            <Result label="Total Ceiling Area" value={`${Math.round(totalCeiling).toLocaleString()} ft²`} />
            <Result label="Total Floor Area" value={`${Math.round(totalFloor).toLocaleString()} ft²`} />
            <Result label="Paint Needed" value={`${gallons} gal`} sub={`${coats} coats, walls + ceiling`} highlight />
            <Result label="Floor w/ Waste" value={`${Math.round(floorWithWaste).toLocaleString()} ft²`} sub={`${wastePct}% waste factor`} highlight />
            <Result label="Carpet / Sheet" value={`${sqYards.toFixed(1)} yd²`} sub="for carpet or sheet vinyl" />
          </ResultGrid>
          <InfoBox type="info">
            Paint covers walls and ceiling. Doors ({DOOR_SF} ft²) and windows ({WINDOW_SF} ft²) are deducted from wall area automatically.
          </InfoBox>
        </Section>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// 3. DUCT SIZING CALCULATOR
// ─────────────────────────────────────────────
function DuctCalc() {
  const [rooms, setRooms] = useState([
    { id: 1, name: 'Living Room', area: '', loads: '' },
  ])
  const [systemCFM, setSystemCFM] = useState('')
  const [totalLoad, setTotalLoad] = useState('')
  const [ductType, setDuctType] = useState('flex')
  const [velocity, setVelocity] = useState(600)

  const addRoom = () => setRooms(r => [...r, { id: Date.now(), name: `Room ${r.length + 1}`, area: '', loads: '' }])
  const updateRoom = (id, k, v) => setRooms(r => r.map(rm => rm.id === id ? { ...rm, [k]: v } : rm))
  const removeRoom = (id) => setRooms(r => r.filter(rm => rm.id !== id))

  // CFM per room = (room load / total load) * system CFM
  // Duct diameter = sqrt(4 * CFM / (π * velocity)) * 12
  const sysCFM = parseFloat(systemCFM) || 0
  const totLoad = parseFloat(totalLoad) || 0

  const roomResults = rooms.map(rm => {
    const load = parseFloat(rm.loads) || 0
    const area = parseFloat(rm.area) || 0
    const cfm = totLoad > 0 && sysCFM > 0 ? (load / totLoad) * sysCFM : area * 1 // fallback: 1 CFM/sqft
    const areaSqFt = Math.PI * Math.pow(cfm / velocity, 1) // πr²= A, A=CFM/vel
    const diam = Math.sqrt((4 * cfm) / (Math.PI * velocity)) * 12
    return { ...rm, cfm: Math.round(cfm), diam: diam.toFixed(1) }
  })

  const STANDARD_SIZES = [4, 5, 6, 7, 8, 10, 12, 14]
  const roundUp = (d) => STANDARD_SIZES.find(s => s >= parseFloat(d)) || 14

  const VELOCITY_LABELS = {
    400: 'Very quiet (bedrooms)',
    600: 'Standard residential',
    800: 'Acceptable (main runs)',
    1000: 'Higher velocity (tight spaces)',
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <Section title="System Parameters">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Total System CFM" hint="From equipment specs or Manual J">
            <input className="input" type="number" value={systemCFM} onChange={e => setSystemCFM(e.target.value)} placeholder="e.g. 1200" />
          </Field>
          <Field label="Total Cooling Load (BTU/hr)" hint="From Manual J — used to proportion room CFMs">
            <input className="input" type="number" value={totalLoad} onChange={e => setTotalLoad(e.target.value)} placeholder="e.g. 36000" />
          </Field>
          <Field label="Design Duct Velocity (FPM)">
            <select className="input" value={velocity} onChange={e => setVelocity(Number(e.target.value))}>
              {Object.entries(VELOCITY_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{v} FPM — {l}</option>
              ))}
            </select>
          </Field>
          <Field label="Duct Type">
            <select className="input" value={ductType} onChange={e => setDuctType(e.target.value)}>
              <option value="flex">Flexible duct</option>
              <option value="sheet">Sheet metal (rigid)</option>
              <option value="fiberboard">Fiberboard</option>
            </select>
          </Field>
        </div>
        {ductType === 'flex' && (
          <InfoBox type="warn">
            Flex duct has ~20% more friction than sheet metal. Size up one diameter for runs over 15 ft or with 2+ bends.
          </InfoBox>
        )}
      </Section>

      <Section title="Rooms / Zones">
        <div className="space-y-3">
          {rooms.map(rm => (
            <div key={rm.id} className="card p-4">
              <div className="flex items-center gap-2 mb-3">
                <input className="input flex-1" value={rm.name} onChange={e => updateRoom(rm.id, 'name', e.target.value)} placeholder="Room name" />
                {rooms.length > 1 && <button className="p-1.5 text-slate-500 hover:text-red-400" onClick={() => removeRoom(rm.id)}>✕</button>}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Room Area (ft²)">
                  <input className="input" type="number" value={rm.area} onChange={e => updateRoom(rm.id, 'area', e.target.value)} placeholder="0" />
                </Field>
                <Field label="Room Cooling Load (BTU/hr)" hint="Optional — more accurate">
                  <input className="input" type="number" value={rm.loads} onChange={e => updateRoom(rm.id, 'loads', e.target.value)} placeholder="0" />
                </Field>
              </div>
            </div>
          ))}
          <button className="btn-ghost w-full" onClick={addRoom}>+ Add Room</button>
        </div>
      </Section>

      {roomResults.some(r => r.cfm > 0) && (
        <Section title="Duct Sizing Results">
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-900/50">
                  <th className="text-left px-4 py-2.5 text-xs text-slate-500 uppercase tracking-wider">Room</th>
                  <th className="text-right px-4 py-2.5 text-xs text-slate-500 uppercase tracking-wider">CFM</th>
                  <th className="text-right px-4 py-2.5 text-xs text-slate-500 uppercase tracking-wider">Calc Ø</th>
                  <th className="text-right px-4 py-2.5 text-xs text-slate-500 uppercase tracking-wider">Use Ø</th>
                </tr>
              </thead>
              <tbody>
                {roomResults.map(r => (
                  <tr key={r.id} className="border-b border-slate-800/50 hover:bg-slate-800/20">
                    <td className="px-4 py-2.5 text-slate-200">{r.name}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-300">{r.cfm}</td>
                    <td className="px-4 py-2.5 text-right font-mono text-slate-400">{r.diam}"</td>
                    <td className="px-4 py-2.5 text-right font-mono text-brand-400 font-medium">{roundUp(r.diam)}"</td>
                  </tr>
                ))}
                <tr className="bg-slate-900/50">
                  <td className="px-4 py-2.5 text-slate-400 text-xs">Total</td>
                  <td className="px-4 py-2.5 text-right font-mono text-slate-300 font-medium">
                    {roomResults.reduce((s, r) => s + r.cfm, 0)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tbody>
            </table>
          </div>
          <InfoBox type="info">
            <strong>Calc Ø</strong> is the exact calculated diameter. <strong>Use Ø</strong> is the next available standard size. Always round up — never down.
            {ductType === 'flex' && ' Add 1" for flex duct runs over 15 ft.'}
          </InfoBox>
        </Section>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// 4. ELECTRICAL LOAD CALCULATOR
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

  // Load persisted state on mount
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

  // Debounced auto-save whenever state changes (after initial load)
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

  // Main panel load helpers
  const addLoad    = () => setLoads(l => [...l, { id: Date.now(), name: '', amps: '', volts: 240, qty: 1, continuous: false }])
  const setLoad    = (id, k, v) => setLoads(l => l.map(ld => ld.id === id ? { ...ld, [k]: v } : ld))
  const removeLoad = (id) => setLoads(l => l.filter(ld => ld.id !== id))

  // Sub-panel helpers
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

  // NEC 220.82 mandatory base loads
  const generalVA    = (parseInt(sqft) || 0) * 3          // 220.82(B)(1): 3 VA/sq ft
  const smallAppVA   = smallAppCircuits * 1500             // 220.52(A): 1,500 VA per 20A circuit
  const laundryVA    = laundry ? 1500 : 0                  // 220.52(B): 1,500 VA
  const mandatoryVA  = generalVA + smallAppVA + laundryVA

  // Appliance / motor loads from the manual table
  const calcLoads = loads.map(applyLoad)
  const directVA  = calcLoads.reduce((s, l) => s + l.va, 0)

  // Each sub-panel contributes its NEC demand VA (not its full connected VA) to the main panel
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

// ─────────────────────────────────────────────
// 5. ENERGY SAVINGS ESTIMATOR
// ─────────────────────────────────────────────
function EnergySavings() {
  const [upgrade, setUpgrade] = useState('insulation')
  const [currentVal, setCurrentVal] = useState('')
  const [newVal, setNewVal] = useState('')
  const [sqft, setSqft] = useState('')
  const [energyCost, setEnergyCost] = useState('0.14')
  const [heatingCoolingHours, setHeatingCoolingHours] = useState('2000')
  const [btu, setBtu] = useState('60000')
  const [upgradeCost, setUpgradeCost] = useState('')

  const UPGRADES = {
    insulation: {
      label: 'Attic Insulation',
      currentLabel: 'Current R-Value',
      newLabel: 'New R-Value',
      currentPlaceholder: 'e.g. R-11',
      newPlaceholder: 'e.g. R-49',
      hint: 'Typical attic upgrade: R-11 → R-49',
    },
    windows: {
      label: 'Window Replacement',
      currentLabel: 'Current U-Factor',
      newLabel: 'New U-Factor',
      currentPlaceholder: 'e.g. 0.87 (single pane)',
      newPlaceholder: 'e.g. 0.25 (triple pane)',
      hint: 'Single pane: ~0.87 · Double: ~0.48 · Triple: ~0.25',
    },
    hvac: {
      label: 'HVAC Efficiency Upgrade',
      currentLabel: 'Current SEER / AFUE %',
      newLabel: 'New SEER / AFUE %',
      currentPlaceholder: 'e.g. 10 SEER or 80%',
      newPlaceholder: 'e.g. 18 SEER or 96%',
      hint: 'SEER for cooling, AFUE % for gas heat',
    },
    airsealing: {
      label: 'Air Sealing',
      currentLabel: 'Current ACH (air changes/hr)',
      newLabel: 'Target ACH',
      currentPlaceholder: 'e.g. 8 (leaky old home)',
      newPlaceholder: 'e.g. 3 (after sealing)',
      hint: 'Typical homes: 5–15 ACH. Target: <3 ACH',
    },
  }

  const cfg = UPGRADES[upgrade]
  const cur = parseFloat(currentVal) || 0
  const nw = parseFloat(newVal) || 0
  const area = parseFloat(sqft) || 0
  const cost = parseFloat(energyCost) || 0.14
  const hours = parseFloat(heatingCoolingHours) || 2000
  const systemBtu = parseFloat(btu) || 60000
  const upCost = parseFloat(upgradeCost) || 0

  let annualSavingsKwh = 0
  let savingsPct = 0

  if (cur > 0 && nw > 0) {
    if (upgrade === 'insulation') {
      // Q = BTU * hours * (1/R_old - 1/R_new) * area / 3412
      const deltaQ = systemBtu * hours * (1 / cur - 1 / nw)
      annualSavingsKwh = Math.max(0, deltaQ / 3412)
      savingsPct = Math.max(0, (1 - cur / nw) * 100)
    } else if (upgrade === 'windows') {
      // Heat loss reduction: area * deltaU * HDD * 24 / 3412
      const deltaU = cur - nw
      annualSavingsKwh = Math.max(0, (area * deltaU * hours * 0.5) / 3412 * 10)
      savingsPct = Math.max(0, ((cur - nw) / cur) * 100)
    } else if (upgrade === 'hvac') {
      savingsPct = Math.max(0, (1 - cur / nw) * 100)
      const annualKwh = (systemBtu * hours) / (3412 * cur)
      annualSavingsKwh = annualKwh * (savingsPct / 100)
    } else if (upgrade === 'airsealing') {
      savingsPct = Math.max(0, ((cur - nw) / cur) * 100 * 0.6) // ~60% of ACH reduction translates to savings
      const annualKwh = (systemBtu * hours) / 3412
      annualSavingsKwh = annualKwh * (savingsPct / 100)
    }
  }

  const annualSavingsDollars = annualSavingsKwh * cost
  const paybackYears = upCost > 0 && annualSavingsDollars > 0 ? upCost / annualSavingsDollars : 0
  const tenYearSavings = annualSavingsDollars * 10

  return (
    <div className="space-y-6 max-w-2xl">
      <Section title="Upgrade Type">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {Object.entries(UPGRADES).map(([key, u]) => (
            <button
              key={key}
              onClick={() => setUpgrade(key)}
              className={`px-3 py-2.5 rounded-lg text-xs font-medium border transition-all text-left ${
                upgrade === key
                  ? 'bg-brand-600/20 border-brand-600/40 text-brand-400'
                  : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              {u.label}
            </button>
          ))}
        </div>
      </Section>

      <Section title="Parameters">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label={cfg.currentLabel} hint={cfg.hint}>
            <input className="input" type="number" value={currentVal} onChange={e => setCurrentVal(e.target.value)} placeholder={cfg.currentPlaceholder} />
          </Field>
          <Field label={cfg.newLabel}>
            <input className="input" type="number" value={newVal} onChange={e => setNewVal(e.target.value)} placeholder={cfg.newPlaceholder} />
          </Field>
          {(upgrade === 'insulation' || upgrade === 'windows') && (
            <Field label="Area (ft²)" hint="Ceiling area for insulation, total window area for windows">
              <input className="input" type="number" value={sqft} onChange={e => setSqft(e.target.value)} placeholder="e.g. 1500" />
            </Field>
          )}
          <Field label="System Size (BTU/hr)" hint="From nameplate or Manual J">
            <input className="input" type="number" value={btu} onChange={e => setBtu(e.target.value)} placeholder="e.g. 60000" />
          </Field>
          <Field label="Annual Run Hours" hint="Heating + cooling combined (typ. 1500–3000)">
            <input className="input" type="number" value={heatingCoolingHours} onChange={e => setHeatingCoolingHours(e.target.value)} />
          </Field>
          <Field label="Energy Cost ($/kWh)" hint="Check your utility bill">
            <input className="input" type="number" step="0.01" value={energyCost} onChange={e => setEnergyCost(e.target.value)} />
          </Field>
          <Field label="Upgrade Cost ($)" hint="For payback calculation">
            <input className="input" type="number" value={upgradeCost} onChange={e => setUpgradeCost(e.target.value)} placeholder="0" />
          </Field>
        </div>
      </Section>

      {annualSavingsKwh > 0 && (
        <Section title="Estimated Savings">
          <ResultGrid>
            <Result label="Energy Reduction" value={`${savingsPct.toFixed(0)}%`} sub="of related load" />
            <Result label="Annual kWh Saved" value={Math.round(annualSavingsKwh).toLocaleString()} sub="kilowatt-hours" highlight />
            <Result label="Annual $ Saved" value={`$${annualSavingsDollars.toFixed(0)}`} sub={`at $${energyCost}/kWh`} highlight />
            <Result label="10-Year Savings" value={`$${Math.round(tenYearSavings).toLocaleString()}`} sub="before inflation" />
            {paybackYears > 0 && (
              <Result label="Simple Payback" value={`${paybackYears.toFixed(1)} yrs`} sub={`$${upCost.toLocaleString()} upgrade cost`} />
            )}
          </ResultGrid>
          <InfoBox type="info">
            Estimates are simplified models — actual savings vary with climate, usage patterns, and installation quality. Use as a planning benchmark, not a guarantee.
          </InfoBox>
        </Section>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// 6. BREAK-EVEN CALCULATOR
// ─────────────────────────────────────────────
function BreakEven() {
  const [upgradeCost, setUpgradeCost] = useState('')
  const [annualSavings, setAnnualSavings] = useState('')
  const [incentives, setIncentives] = useState('')
  const [appreciation, setAppreciation] = useState('2')
  const [savingsGrowth, setSavingsGrowth] = useState('3')

  const cost = parseFloat(upgradeCost) || 0
  const savings = parseFloat(annualSavings) || 0
  const rebate = parseFloat(incentives) || 0
  const appPct = parseFloat(appreciation) / 100
  const growthPct = parseFloat(savingsGrowth) / 100

  const netCost = Math.max(0, cost - rebate)
  const simplePayback = savings > 0 ? netCost / savings : 0

  // Year-by-year with growing savings and home value appreciation
  const years = []
  let cumSavings = 0
  let annSav = savings
  for (let y = 1; y <= 25; y++) {
    annSav *= (1 + growthPct)
    cumSavings += annSav
    const homeValueGain = cost * Math.pow(1 + appPct, y) - cost
    const totalBenefit = cumSavings + homeValueGain
    years.push({ y, cumSavings: Math.round(cumSavings), totalBenefit: Math.round(totalBenefit), breakEven: totalBenefit >= netCost })
  }

  const breakEvenYear = years.find(y => y.breakEven)
  const yr10 = years[9]
  const yr20 = years[19]

  return (
    <div className="space-y-6 max-w-2xl">
      <Section title="Upgrade Details">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Upgrade Cost ($)">
            <input className="input" type="number" value={upgradeCost} onChange={e => setUpgradeCost(e.target.value)} placeholder="e.g. 15000" />
          </Field>
          <Field label="Rebates / Tax Credits ($)" hint="Federal IRA credits, utility rebates, etc.">
            <input className="input" type="number" value={incentives} onChange={e => setIncentives(e.target.value)} placeholder="e.g. 2000" />
          </Field>
          <Field label="Annual Savings ($)" hint="Energy, maintenance, or rental income">
            <input className="input" type="number" value={annualSavings} onChange={e => setAnnualSavings(e.target.value)} placeholder="e.g. 800" />
          </Field>
          <Field label="Savings Growth Rate (%/yr)" hint="Energy price inflation (typ. 2–5%)">
            <input className="input" type="number" step="0.5" value={savingsGrowth} onChange={e => setSavingsGrowth(e.target.value)} />
          </Field>
          <Field label="Home Value Appreciation (%/yr)" hint="National avg ~4%, local varies">
            <input className="input" type="number" step="0.5" value={appreciation} onChange={e => setAppreciation(e.target.value)} />
          </Field>
        </div>
      </Section>

      {cost > 0 && savings > 0 && (
        <Section title="Results">
          <ResultGrid>
            <Result label="Net Cost" value={`$${netCost.toLocaleString()}`} sub={rebate > 0 ? `after $${rebate.toLocaleString()} rebates` : 'no rebates applied'} />
            <Result label="Simple Payback" value={`${simplePayback.toFixed(1)} yrs`} sub="savings only, no appreciation" highlight />
            {breakEvenYear && (
              <Result label="True Break-Even" value={`Yr ${breakEvenYear.y}`} sub="savings + home value gain" highlight />
            )}
            {yr10 && <Result label="10-Year Benefit" value={`$${yr10.totalBenefit.toLocaleString()}`} sub="cumulative savings + value" />}
            {yr20 && <Result label="20-Year Benefit" value={`$${yr20.totalBenefit.toLocaleString()}`} sub="cumulative savings + value" />}
          </ResultGrid>

          {/* Year-by-year table */}
          <div className="overflow-x-auto rounded-xl border border-slate-800 max-h-64">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-900">
                <tr className="border-b border-slate-800">
                  <th className="text-left px-4 py-2 text-xs text-slate-500 uppercase tracking-wider">Year</th>
                  <th className="text-right px-4 py-2 text-xs text-slate-500 uppercase tracking-wider">Cum. Savings</th>
                  <th className="text-right px-4 py-2 text-xs text-slate-500 uppercase tracking-wider">Total Benefit</th>
                  <th className="text-right px-4 py-2 text-xs text-slate-500 uppercase tracking-wider">vs Net Cost</th>
                </tr>
              </thead>
              <tbody>
                {years.map(yr => (
                  <tr key={yr.y} className={`border-b border-slate-800/40 ${yr.breakEven ? 'bg-brand-900/10' : ''}`}>
                    <td className="px-4 py-1.5 text-slate-400 font-mono text-xs">Yr {yr.y}</td>
                    <td className="px-4 py-1.5 text-right font-mono text-xs text-slate-300">${yr.cumSavings.toLocaleString()}</td>
                    <td className="px-4 py-1.5 text-right font-mono text-xs text-slate-200">${yr.totalBenefit.toLocaleString()}</td>
                    <td className={`px-4 py-1.5 text-right font-mono text-xs ${yr.breakEven ? 'text-brand-400 font-medium' : 'text-slate-500'}`}>
                      {yr.breakEven ? '✓ Break-even' : `-$${(netCost - yr.totalBenefit).toLocaleString()}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <InfoBox type="info">
            Total benefit includes cumulative energy/cost savings plus estimated home value appreciation on the upgrade cost. Savings grow at {savingsGrowth}%/yr (energy inflation).
          </InfoBox>
        </Section>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────
// TOOL REGISTRY
// ─────────────────────────────────────────────
const TOOLS = [
  {
    id: 'manualj',
    label: 'Manual J',
    icon: Thermometer,
    desc: 'ACCA Manual J residential heat load calculation — right-size your HVAC equipment',
    component: ManualJ,
    color: 'text-orange-400',
    bg: 'bg-orange-900/20 border-orange-800/30',
  },
  {
    id: 'paint',
    label: 'Paint & Materials',
    icon: PaintBucket,
    desc: 'Room-by-room paint gallons, flooring square footage with waste factor',
    component: PaintCalc,
    color: 'text-blue-400',
    bg: 'bg-blue-900/20 border-blue-800/30',
  },
  {
    id: 'duct',
    label: 'Duct Sizing',
    icon: Wind,
    desc: 'Calculate CFM per room and recommended duct diameters from Manual J output',
    component: DuctCalc,
    color: 'text-cyan-400',
    bg: 'bg-cyan-900/20 border-cyan-800/30',
  },
  {
    id: 'electrical',
    label: 'Electrical Load',
    icon: Zap,
    desc: 'NEC 220 panel load calculation — check headroom before adding circuits',
    component: ElecCalc,
    color: 'text-yellow-400',
    bg: 'bg-yellow-900/20 border-yellow-800/30',
  },
  {
    id: 'energy',
    label: 'Energy Savings',
    icon: TrendingUp,
    desc: 'Estimate annual savings and payback for insulation, windows, HVAC, and air sealing',
    component: EnergySavings,
    color: 'text-brand-400',
    bg: 'bg-brand-900/20 border-brand-800/30',
  },
  {
    id: 'breakeven',
    label: 'Break-Even',
    icon: Calculator,
    desc: 'True break-even including savings growth, rebates, and home value appreciation',
    component: BreakEven,
    color: 'text-purple-400',
    bg: 'bg-purple-900/20 border-purple-800/30',
  },
]

// ─────────────────────────────────────────────
// MAIN TOOLS PAGE
// ─────────────────────────────────────────────
export default function Tools() {
  const [activeTool, setActiveTool] = useState(null)

  if (activeTool) {
    const tool = TOOLS.find(t => t.id === activeTool)
    const Component = tool.component
    return (
      <div className="p-4 md:p-8 space-y-4 md:space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setActiveTool(null)}
            className="btn-ghost p-2"
          >
            <ArrowLeft size={16} />
          </button>
          <div className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${tool.bg}`}>
            <tool.icon size={16} className={tool.color} />
          </div>
          <div>
            <h1 className="page-title leading-none">{tool.label}</h1>
            <p className="text-xs text-slate-500 mt-0.5">{tool.desc}</p>
          </div>
        </div>
        <Component />
      </div>
    )
  }

  return (
    <div className="p-4 md:p-8 space-y-4 md:space-y-6">
      <div>
        <h1 className="page-title">Tools</h1>
        <p className="text-slate-500 text-sm mt-1">Calculators for planning, sizing, and estimating</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {TOOLS.map(tool => (
          <button
            key={tool.id}
            onClick={() => setActiveTool(tool.id)}
            className="card text-left hover:border-slate-600 transition-all group hover:bg-slate-800/40"
          >
            <div className={`w-10 h-10 rounded-xl border flex items-center justify-center mb-4 transition-colors ${tool.bg}`}>
              <tool.icon size={20} className={tool.color} />
            </div>
            <h3 className="font-display tracking-widest uppercase text-slate-200 text-lg leading-none mb-2 group-hover:text-white transition-colors">
              {tool.label}
            </h3>
            <p className="text-xs text-slate-500 leading-relaxed">{tool.desc}</p>
          </button>
        ))}
      </div>
    </div>
  )
}
