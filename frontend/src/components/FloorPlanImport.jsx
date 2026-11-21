import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { Layers, ChevronDown, Check } from 'lucide-react'
import { api } from '../api'
import { normalizePlan, envelopeTakeoff } from '../floorplan/geometry'

const round = (v) => Math.round(v)
const roundHalf = (v) => Math.round(v * 2) / 2

// Fills a Manual J zone's envelope inputs from one or more drawn floors.
export default function FloorPlanImport({ zone, onChange }) {
  const [floors, setFloors] = useState(null)
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState(null)
  const [groups, setGroups] = useState({ envelope: true, windows: true, doors: true })
  const [applied, setApplied] = useState(false)

  useEffect(() => {
    api.getFloorPlans().then(setFloors).catch(() => setFloors([]))
  }, [])

  // Per-floor takeoff, plus how much of each floor's ceiling is exposed (not
  // covered by the next floor up) — that's Manual J's "ceiling area".
  const rows = useMemo(() => {
    if (!floors) return []
    const sorted = [...floors].sort((a, b) => a.level - b.level)
    const base = sorted.map((f) => ({ floor: f, t: envelopeTakeoff(normalizePlan(f.data), f.ceilingHt, f.north) }))
    return base.map((r) => {
      const above = base.find((x) => x.floor.level > r.floor.level)
      return { ...r, exposedCeiling: Math.max(0, r.t.floorArea - (above?.t.floorArea ?? 0)) }
    })
  }, [floors])

  // Default selection: floors whose name appears in the zone name (e.g. "Zone 1 — Main Floor"),
  // otherwise every floor that has an enclosed area.
  useEffect(() => {
    if (!rows.length) return
    const name = (zone.name || '').toLowerCase()
    const matches = rows.filter((r) => name.includes(r.floor.name.toLowerCase()))
    setPicked((matches.length ? matches : rows.filter((r) => r.t.floorArea > 0)).map((r) => r.floor.id))
    setApplied(false)
  }, [rows, zone.name])

  const chosen = rows.filter((r) => picked?.includes(r.floor.id))
  const agg = useMemo(() => {
    const floorArea = chosen.reduce((s, r) => s + r.t.floorArea, 0)
    const vol = chosen.reduce((s, r) => s + r.t.floorArea * r.floor.ceilingHt, 0)
    const sum = (fn) => chosen.reduce((s, r) => s + fn(r), 0)
    return {
      floorArea,
      ceilingHt: floorArea > 0 ? roundHalf(vol / floorArea) : null,
      netWall: sum((r) => r.t.netWall),
      ceilingArea: sum((r) => r.exposedCeiling),
      N: sum((r) => r.t.windows.N), S: sum((r) => r.t.windows.S),
      E: sum((r) => r.t.windows.E), W: sum((r) => r.t.windows.W),
      doorArea: sum((r) => r.t.doorArea),
      windowCount: sum((r) => r.t.windowCount),
      doorCount: sum((r) => r.t.doorCount),
    }
  }, [chosen])

  if (!floors) return null

  if (!floors.length) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-900/60 px-4 py-3 text-xs text-slate-500 mb-4 flex items-center gap-2">
        <Layers size={14} className="text-slate-600 flex-shrink-0" />
        <span>Tip: draw your home in <Link to="/floor-plans" className="text-brand-400 hover:underline">Floor Plans</Link> and these areas can be filled in automatically.</span>
      </div>
    )
  }

  const use = {
    envelope: groups.envelope && agg.floorArea > 0,
    windows: groups.windows && agg.windowCount > 0,
    doors: groups.doors && agg.doorCount > 0,
  }

  const fields = [
    { group: 'envelope', key: 'floor_area', label: 'Floor area', value: round(agg.floorArea), unit: 'ft²' },
    { group: 'envelope', key: 'ceiling_height', label: 'Ceiling height', value: agg.ceilingHt, unit: 'ft' },
    { group: 'envelope', key: 'wall_area', label: 'Wall area (net)', value: round(agg.netWall), unit: 'ft²' },
    { group: 'envelope', key: 'ceiling_area', label: 'Ceiling area (exposed)', value: round(agg.ceilingArea), unit: 'ft²' },
    { group: 'windows', key: 'north_window', label: 'North windows', value: round(agg.N), unit: 'ft²' },
    { group: 'windows', key: 'south_window', label: 'South windows', value: round(agg.S), unit: 'ft²' },
    { group: 'windows', key: 'east_window', label: 'East windows', value: round(agg.E), unit: 'ft²' },
    { group: 'windows', key: 'west_window', label: 'West windows', value: round(agg.W), unit: 'ft²' },
    { group: 'doors', key: 'door_area', label: 'Door area', value: round(agg.doorArea), unit: 'ft²' },
  ]

  const apply = () => {
    const updates = Object.fromEntries(fields.filter((f) => use[f.group] && f.value != null).map((f) => [f.key, f.value]))
    onChange({ ...zone, ...updates })
    setApplied(true)
  }

  const togglePick = (id) => {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
    setApplied(false)
  }
  const toggleGroup = (g) => { setGroups((s) => ({ ...s, [g]: !s[g] })); setApplied(false) }
  const hasBasement = chosen.some((r) => r.floor.level < 0)
  const nothing = !use.envelope && !use.windows && !use.doors

  return (
    <div className="rounded-lg border border-brand-700/40 bg-brand-900/10 mb-4">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <Layers size={16} className="text-brand-400 flex-shrink-0" />
        <div className="flex-1">
          <div className="text-sm font-medium text-slate-200">Fill from floor plan</div>
          <div className="text-xs text-slate-500">Calculate areas, windows and doors from your drawn floors</div>
        </div>
        <ChevronDown size={16} className={`text-slate-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-brand-700/30 pt-3">
          <div>
            <div className="text-xs text-slate-400 font-medium mb-2">Floors in this zone</div>
            <div className="flex flex-wrap gap-2">
              {rows.map((r) => (
                <label key={r.floor.id} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-sm cursor-pointer ${
                  picked?.includes(r.floor.id) ? 'border-brand-600/50 bg-brand-600/15 text-slate-200' : 'border-slate-700 text-slate-400'
                }`}>
                  <input type="checkbox" className="accent-brand-500" checked={!!picked?.includes(r.floor.id)} onChange={() => togglePick(r.floor.id)} />
                  {r.floor.name}
                  <span className="text-xs text-slate-500 font-mono">{round(r.t.floorArea)} ft²</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap gap-4 text-sm">
            {[
              ['envelope', 'Floor, wall & ceiling areas', agg.floorArea > 0, 'no enclosed area drawn'],
              ['windows', 'Window areas', agg.windowCount > 0, 'no windows on exterior walls'],
              ['doors', 'Door area', agg.doorCount > 0, 'no doors on exterior walls'],
            ].map(([g, label, available, why]) => (
              <label key={g} className={`flex items-center gap-2 ${available ? 'text-slate-300 cursor-pointer' : 'text-slate-600'}`}
                title={available ? '' : `Skipped: ${why}`}>
                <input type="checkbox" className="accent-brand-500" disabled={!available}
                  checked={available && groups[g]} onChange={() => toggleGroup(g)} />
                {label}
                {!available && <span className="text-xs">({why})</span>}
              </label>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="text-left font-medium py-1.5">Field</th>
                  <th className="text-right font-medium py-1.5">Current</th>
                  <th className="text-right font-medium py-1.5">From plan</th>
                </tr>
              </thead>
              <tbody>
                {fields.map((f) => {
                  const active = use[f.group] && f.value != null
                  const changed = active && zone[f.key] !== f.value
                  return (
                    <tr key={f.key} className={`border-b border-slate-800/60 ${active ? '' : 'opacity-40'}`}>
                      <td className="py-1.5 text-slate-400">{f.label}</td>
                      <td className="py-1.5 text-right font-mono text-slate-500">{zone[f.key] ?? 0} {f.unit}</td>
                      <td className={`py-1.5 text-right font-mono ${changed ? 'text-brand-300' : 'text-slate-400'}`}>
                        {active ? `${f.value} ${f.unit}` : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="text-xs text-slate-500 space-y-1">
            <p>Net wall area = exterior wall length × ceiling height, minus exterior windows and doors. Areas are measured to wall centrelines.</p>
            <p>Ceiling area counts only the part of each floor not covered by the floor above. Window and door areas also fill the next step.</p>
            {hasBasement && (
              <p className="text-amber-400/80">Basement walls are counted as above-grade. Move the buried portion into Below-Grade Wall yourself.</p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed" disabled={nothing || !chosen.length} onClick={apply}>
              Apply to {zone.name || 'zone'}
            </button>
            {applied && <span className="flex items-center gap-1 text-xs text-brand-400"><Check size={14} /> Applied</span>}
          </div>
        </div>
      )}
    </div>
  )
}
