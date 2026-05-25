import { useState } from 'react'
import { ArrowLeft, Wind, PaintBucket, TrendingUp, Calculator } from 'lucide-react'

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
// PAINT & MATERIAL CALCULATOR
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
// 4. ENERGY SAVINGS ESTIMATOR
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
// 5. BREAK-EVEN CALCULATOR
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
