import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  Plus, Trash2, MousePointer2, PenLine, Square, Undo2, Redo2, Ruler, Layers, Check, Loader2, AlertTriangle,
  DoorOpen, AppWindow, Download, FlipHorizontal2, FlipVertical2, RotateCw, Router, Wifi, Copy,
} from 'lucide-react'
import { api } from '../api'
import FloorPlanCanvas from '../components/FloorPlanCanvas'
import {
  WALL_DEFAULTS, OPENING_LABELS, normalizePlan, clonePlan, nodeMap, wallLength, roomPoints, polygonArea, polygonPerimeter,
  sqft, planStats, deleteSelection, setWallLength, fmtLen, parseLen, openingSpan, openingFits, outwardNormal,
  compassFacing, FACING_NAMES, enclosedFootprint, WALL_MATERIALS, wallMaterial, FLOOR_STRUCTURES, DEVICE_TYPES, MOUNTS,
  ROOM_PRIORITIES, ROOM_USES, DUPLICATE_PRESETS, duplicatePlan, levelName, repairPlan, AP_PLACEMENT,
} from '../floorplan/geometry'
import { downloadPng, downloadSvg } from '../floorplan/exportPlan'
import SurveyPanel from '../components/SurveyPanel'
import { useSurvey } from '../floorplan/useSurvey'
import { suggestSpots, customLabel } from '../floorplan/survey'
import { heatmapImage, heatmapValueAt } from '../floorplan/heatmap'

const HISTORY_LIMIT = 100
const SAVE_DELAY_MS = 700
const LAST_FLOOR_KEY = 'floorplans.currentId'

const TOOLS = [
  { id: 'select', label: 'Select', icon: MousePointer2, key: 'V' },
  { id: 'wall', label: 'Wall', icon: PenLine, key: 'W' },
  { id: 'room', label: 'Room', icon: Square, key: 'R' },
  { id: 'door', label: 'Door', icon: DoorOpen, key: 'D' },
  { id: 'window', label: 'Window', icon: AppWindow, key: 'N' },
  { id: 'device', label: 'Network', icon: Router, key: 'E' },
]

const storage = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* ignore */ } },
}

// Text input that commits on blur / Enter and resyncs when the source value changes.
function CommitInput({ value, onCommit, format = (v) => v, parse = (v) => v, validate = () => true, className = '', ...rest }) {
  const [text, setText] = useState(format(value))
  const [error, setError] = useState(false)
  useEffect(() => { setText(format(value)); setError(false) }, [value]) // eslint-disable-line react-hooks/exhaustive-deps
  const commit = () => {
    const v = parse(text)
    if (!validate(v)) { setError(true); return }
    if (v !== value) onCommit(v)
    else setText(format(value))
  }
  return (
    <input
      {...rest}
      className={`input ${error ? '!border-red-500' : ''} ${className}`}
      value={text}
      onChange={(e) => { setText(e.target.value); setError(false) }}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }}
    />
  )
}

function Stat({ label, value }) {
  return (
    <div className="flex justify-between text-sm py-1">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-200 font-mono">{value}</span>
    </div>
  )
}

function SaveIndicator({ state }) {
  if (state === 'saving') return <span className="flex items-center gap-1.5 text-xs text-slate-500"><Loader2 size={12} className="animate-spin" /> Saving…</span>
  if (state === 'error') return <span className="flex items-center gap-1.5 text-xs text-red-400"><AlertTriangle size={12} /> Save failed</span>
  return <span className="flex items-center gap-1.5 text-xs text-slate-500"><Check size={12} /> Saved</span>
}

// Copy the current floor to a new level above the top floor or below the bottom one.
function DuplicateFloor({ floor, floors, onDuplicate }) {
  const [open, setOpen] = useState(false)
  const [place, setPlace] = useState('above')
  const [preset, setPreset] = useState('outline')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const levels = floors.map((f) => f.level)
  const level = place === 'above' ? Math.max(...levels) + 1 : Math.min(...levels) - 1
  const defaultName = (() => {
    const base = levelName(level)
    return floors.some((f) => f.name === base) ? `${base} (copy)` : base
  })()

  if (!open) {
    return (
      <button className="btn-ghost w-full justify-center" onClick={() => setOpen(true)}>
        <Copy size={14} /> Duplicate floor
      </button>
    )
  }
  const create = async () => {
    setBusy(true)
    try {
      await onDuplicate({ name: name.trim() || defaultName, level, preset })
      setOpen(false)
      setName('')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="rounded-lg border border-slate-700 p-3 space-y-3">
      <div className="text-sm font-medium text-slate-200">Duplicate “{floor.name}”</div>
      <div className="grid grid-cols-2 gap-1">
        {[['above', 'Above top floor'], ['below', 'Below bottom floor']].map(([k, l]) => (
          <button key={k} onClick={() => setPlace(k)}
            className={`px-2 py-1.5 rounded-md text-xs border ${place === k
              ? 'bg-brand-600/25 text-brand-300 border-brand-600/40' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}>
            {l}
          </button>
        ))}
      </div>
      <div>
        <label className="label">Name</label>
        <input className="input" value={name} placeholder={defaultName} onChange={(e) => setName(e.target.value)} />
        <p className="text-xs text-slate-600 mt-1">Level {level}</p>
      </div>
      <div className="space-y-1.5">
        <label className="label">Copy</label>
        {Object.entries(DUPLICATE_PRESETS).map(([k, { label, hint }]) => (
          <label key={k} className="flex items-start gap-2 text-sm cursor-pointer">
            <input type="radio" name="dup-preset" className="accent-brand-500 mt-1" checked={preset === k} onChange={() => setPreset(k)} />
            <span>
              <span className="text-slate-200">{label}</span>
              <span className="block text-xs text-slate-500">{hint}</span>
            </span>
          </label>
        ))}
      </div>
      <div className="flex gap-2">
        <button className="btn-primary flex-1 justify-center disabled:opacity-50" disabled={busy} onClick={create}>
          <Copy size={14} /> Create
        </button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  )
}

export default function FloorPlans() {
  const [floors, setFloors] = useState([])
  const [currentId, setCurrentId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(null)
  const [tool, setTool] = useState('select')
  const [mode, setModeState] = useState(() => (storage.get('floorplans.mode') === 'survey' ? 'survey' : 'edit'))
  const [surveyId, setSurveyIdState] = useState(() => storage.get('floorplans.surveyId'))
  const [selectedPointId, setSelectedPointId] = useState(null)
  const [surveyMsg, setSurveyMsg] = useState(null)
  const [wallType, setWallType] = useState('exterior')
  const [deviceType, setDeviceType] = useState('ethernet')
  const [wifiLayer, setWifiLayer] = useState(() => storage.get('floorplans.wifiLayer') === '1')
  const [selection, setSelection] = useState(null)
  const [showDims, setShowDims] = useState(true)
  const [saveState, setSaveState] = useState('saved')
  const [, setHistVersion] = useState(0)

  const undoRef = useRef([])
  const redoRef = useRef([])
  const pending = useRef({})
  const timer = useRef(null)
  const saveChain = useRef(Promise.resolve())

  // ── Load ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    api.getFloorPlans()
      .then((fs) => {
        setFloors(fs)
        const last = storage.get(LAST_FLOOR_KEY)
        const pick = fs.find((f) => f.id === last) ?? fs.find((f) => f.level === 0) ?? fs[0]
        if (pick) setCurrentId(pick.id)
      })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false))
  }, [])

  // ── Autosave (debounced, serialized so writes can't land out of order) ───

  const flush = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = null
    const entries = Object.entries(pending.current)
    pending.current = {}
    if (!entries.length) return saveChain.current
    saveChain.current = saveChain.current
      .then(() => Promise.all(entries.map(([id, patch]) => api.updateFloorPlan(id, patch))))
      .then(() => { if (!timer.current) setSaveState('saved') })
      .catch(() => setSaveState('error'))
    return saveChain.current
  }, [])

  const queueSave = useCallback((id, patch) => {
    pending.current[id] = { ...pending.current[id], ...patch }
    setSaveState('saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, SAVE_DELAY_MS)
  }, [flush])

  useEffect(() => {
    const onUnload = (e) => {
      if (timer.current) { flush(); e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', onUnload)
    return () => { window.removeEventListener('beforeunload', onUnload); flush() }
  }, [flush])

  // ── Derived state ────────────────────────────────────────────────────────

  const sortedFloors = useMemo(
    () => [...floors].sort((a, b) => a.level - b.level || new Date(a.createdAt) - new Date(b.createdAt)),
    [floors],
  )
  const floor = floors.find((f) => f.id === currentId)
  const plan = useMemo(() => normalizePlan(floor?.data), [floor?.data])
  const ghost = useMemo(() => {
    if (!floor) return null
    const below = sortedFloors.filter((f) => f.level < floor.level)
    return below.length ? normalizePlan(below[below.length - 1].data) : null
  }, [sortedFloors, floor])
  const nm = useMemo(() => nodeMap(plan), [plan])
  const stats = useMemo(() => planStats(plan, floor?.ceilingHt ?? 9), [plan, floor?.ceilingHt])

  // ── Wi-Fi survey mode ────────────────────────────────────────────────────
  const surveyState = useSurvey(surveyId, mode === 'survey')
  const suggestions = useMemo(() => suggestSpots(plan), [plan])
  const floorPoints = useMemo(() => surveyState.points.filter((p) => p.floorId === currentId), [surveyState.points, currentId])
  const selectedPoint = surveyState.points.find((p) => p.id === selectedPointId) ?? null

  // Coverage model / heatmap for the selected survey.
  const [analysis, setAnalysis] = useState(null)
  const [analysisBusy, setAnalysisBusy] = useState(false)
  const [analysisError, setAnalysisError] = useState(null)
  const [showHeatmap, setShowHeatmap] = useState(true)
  const [heatBand, setHeatBand] = useState('5')
  useEffect(() => {
    setAnalysis(null)
    setAnalysisError(null)
    if (mode !== 'survey' || !surveyId) return
    let alive = true
    api.getSurveyAnalysis(surveyId).then((a) => { if (alive) setAnalysis(a) }).catch(() => {})
    return () => { alive = false }
  }, [surveyId, mode])
  const runAnalysis = async () => {
    setAnalysisBusy(true)
    setAnalysisError(null)
    try {
      const a = await api.analyzeSurvey(surveyId)
      setAnalysis(a)
      setShowHeatmap(true)
      if (!a.bands[heatBand]) setHeatBand(Object.keys(a.bands)[0] ?? '5')
    } catch (e) {
      setAnalysisError(e.message)
    } finally {
      setAnalysisBusy(false)
    }
  }
  const heatGrid = analysis?.grids?.[currentId]
  const heatmap = useMemo(() => {
    if (mode !== 'survey' || !showHeatmap || !heatGrid) return null
    const image = heatmapImage(heatGrid, heatBand)
    return image ? { image, valueAt: (pt) => heatmapValueAt(heatGrid, heatBand, pt) } : null
  }, [mode, showHeatmap, heatGrid, heatBand])

  const setMode = (m) => {
    setModeState(m)
    storage.set('floorplans.mode', m)
    setSelection(null)
    setSurveyMsg(null)
  }
  const setSurveyId = (id) => {
    setSurveyIdState(id)
    storage.set('floorplans.surveyId', id)
    setSelectedPointId(null)
  }

  useEffect(() => {
    if (!surveyMsg) return
    const t = setTimeout(() => setSurveyMsg(null), 10000)
    return () => clearTimeout(t)
  }, [surveyMsg])

  const surveyPick = async (target) => {
    if (target.kind === 'point') { setSelectedPointId(target.point.id); return }
    if (!surveyId) { setSurveyMsg('Start or choose a survey first.'); return }
    const body = target.kind === 'suggestion'
      ? { floorId: currentId, roomId: target.suggestion.roomId, label: target.suggestion.key, x: target.suggestion.x, y: target.suggestion.y }
      : { floorId: currentId, ...customLabel(plan, surveyState.points, currentId, target), x: target.x, y: target.y }
    try {
      const pt = await api.queueSurveyPoint(surveyId, body)
      setSelectedPointId(pt.id)
      setSurveyMsg(surveyState.agents.some((a) => a.online) ? null
        : 'No laptop agent is connected. Start `wifi-survey agent` within 2 minutes or this request expires.')
      surveyState.refresh()
    } catch (e) {
      setSurveyMsg(e.message)
    }
  }

  const surveyAction = async (kind, point) => {
    try {
      if (kind === 'remeasure') await api.remeasureSurveyPoint(point.id)
      else if (kind === 'cancel') await api.cancelSurveyPoint(point.id)
      else if (kind === 'delete') {
        if (!confirm(`Delete measurement ${point.label}?`)) return
        await api.deleteSurveyPoint(point.id)
        setSelectedPointId(null)
      }
      surveyState.refresh()
    } catch (e) {
      setSurveyMsg(e.message)
    }
  }

  const selWall = selection?.type === 'wall' ? plan.walls.find((w) => w.id === selection.id) : null
  const selRoom = selection?.type === 'room' ? plan.rooms.find((r) => r.id === selection.id) : null
  const selNode = selection?.type === 'node' ? nm[selection.id] : null
  const selOpening = selection?.type === 'opening' ? plan.openings.find((o) => o.id === selection.id) : null
  const selDevice = selection?.type === 'device' ? plan.devices.find((d) => d.id === selection.id) : null
  const north = floor?.north ?? 0

  const selOpeningInfo = useMemo(() => {
    if (!selOpening) return null
    const wallsById = Object.fromEntries(plan.walls.map((w) => [w.id, w]))
    const span = openingSpan(selOpening, nm, wallsById)
    if (!span) return null
    const facing = span.wall.exterior ? compassFacing(outwardNormal(plan, span.wall, nm), north) : null
    return { span, facing }
  }, [selOpening, plan, nm, north])

  // ── Mutations & history ──────────────────────────────────────────────────

  const updateFloor = (id, patch) => {
    setFloors((fs) => fs.map((f) => (f.id === id ? { ...f, ...patch } : f)))
    queueSave(id, patch)
  }
  const setPlan = (next) => updateFloor(currentId, { data: next })

  const pushUndo = () => {
    undoRef.current.push(plan)
    if (undoRef.current.length > HISTORY_LIMIT) undoRef.current.shift()
    redoRef.current = []
    setHistVersion((v) => v + 1)
  }
  // Every edit goes through repairPlan so walls only ever meet at shared corners.
  const commit = (next) => { repairPlan(next); pushUndo(); setPlan(next) }
  const finishTransient = () => {
    const next = clonePlan(plan)
    if (repairPlan(next)) setPlan(next)
  }
  const edit = (fn) => { const next = clonePlan(plan); fn(next); commit(next) }

  const undo = () => {
    const prev = undoRef.current.pop()
    if (!prev) return
    redoRef.current.push(plan)
    setSelection(null)
    setPlan(prev)
  }
  const redo = () => {
    const next = redoRef.current.pop()
    if (!next) return
    undoRef.current.push(plan)
    setSelection(null)
    setPlan(next)
  }

  const editDevice = (fn) => edit((p) => fn(p.devices.find((d) => d.id === selDevice.id), p))
  const editRoom = (fn) => edit((p) => fn(p.rooms.find((r) => r.id === selRoom.id), p))
  const toggleWifiLayer = () => setWifiLayer((v) => { storage.set('floorplans.wifiLayer', v ? '0' : '1'); return !v })

  const editOpening = (fn) => edit((p) => fn(p.openings.find((o) => o.id === selOpening.id), p))

  // North is a property of the house, so keep every floor in sync.
  const setNorth = (deg) => {
    const v = ((Math.round(deg) % 360) + 360) % 360
    floors.forEach((f) => updateFloor(f.id, { north: v }))
  }

  const [exportOpen, setExportOpen] = useState(false)
  const runExport = async (kind) => {
    setExportOpen(false)
    if (!plan.nodes.length) { alert('Nothing to export yet — draw some walls first.'); return }
    const opts = { floorName: floor.name, north, showDims, showNetwork: wifiLayer }
    try {
      if (kind === 'png') await downloadPng(plan, opts)
      else downloadSvg(plan, opts)
    } catch (e) {
      alert(`Export failed: ${e.message}`)
    }
  }

  const deleteSelected = () => {
    if (!selWall && !selRoom && !selNode && !selOpening && !selDevice) return
    edit((p) => deleteSelection(p, selection))
    setSelection(null)
  }

  // ── Floors ───────────────────────────────────────────────────────────────

  const switchFloor = (id) => {
    setCurrentId(id)
    setSelection(null)
    undoRef.current = []
    redoRef.current = []
    storage.set(LAST_FLOOR_KEY, id)
  }

  const addFloor = async () => {
    const level = floors.length ? Math.max(...floors.map((f) => f.level)) + 1 : 0
    const name = floors.some((f) => f.name === levelName(level)) ? `Floor ${floors.length + 1}` : levelName(level)
    try {
      const f = await api.createFloorPlan({ name, level, north: floors[0]?.north ?? 0 })
      setFloors((fs) => [...fs, f])
      switchFloor(f.id)
    } catch (e) {
      alert(`Could not create floor: ${e.message}`)
    }
  }

  const duplicateFloor = async ({ name, level, preset }) => {
    try {
      const f = await api.createFloorPlan({
        name, level, ceilingHt: floor.ceilingHt, north: floor.north ?? 0, data: duplicatePlan(plan, preset),
      })
      setFloors((fs) => [...fs, f])
      switchFloor(f.id)
    } catch (e) {
      alert(`Could not duplicate floor: ${e.message}`)
    }
  }

  const deleteFloor = async () => {
    if (!floor || !confirm(`Delete "${floor.name}" and everything drawn on it?`)) return
    delete pending.current[floor.id]
    await api.deleteFloorPlan(floor.id)
    const rest = floors.filter((f) => f.id !== floor.id)
    setFloors(rest)
    const next = rest.find((f) => f.level === 0) ?? rest[0]
    if (next) switchFloor(next.id)
    else setCurrentId(null)
  }

  // Floors drawn before wall repair existed may have overlapping or unjoined
  // walls; fix them once when opened (connectivity only — nothing moves).
  const repairedFloors = useRef(new Set())
  useEffect(() => {
    if (!floor || repairedFloors.current.has(floor.id)) return
    repairedFloors.current.add(floor.id)
    const next = clonePlan(plan)
    if (repairPlan(next)) updateFloor(floor.id, { data: next })
  }, [floor?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Keyboard shortcuts ───────────────────────────────────────────────────

  const keyHandler = useRef(null)
  keyHandler.current = (e) => {
    if (e.target.closest('input, textarea, select, [contenteditable]')) return
    if (mode === 'survey') return
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return }
    if (mod && k === 'y') { e.preventDefault(); redo(); return }
    if (mod || e.altKey) return
    if (k === 'delete' || k === 'backspace') { e.preventDefault(); deleteSelected(); return }
    const t = TOOLS.find((x) => x.key.toLowerCase() === k)
    if (t) setTool(t.id)
  }
  useEffect(() => {
    const h = (e) => keyHandler.current(e)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [])

  // ── Render ───────────────────────────────────────────────────────────────

  if (loading) return <div className="p-8 text-slate-500 text-sm">Loading…</div>
  if (loadError) return <div className="p-8 text-red-400 text-sm">Failed to load floor plans: {loadError}</div>

  if (!floors.length) {
    return (
      <div className="p-4 md:p-8 space-y-6">
        <div>
          <h1 className="page-title">Floor Plans</h1>
          <p className="text-slate-500 text-sm mt-1">Lay out each floor of your home: walls, rooms, and dimensions</p>
        </div>
        <div className="card text-center py-16">
          <Layers size={28} className="mx-auto text-slate-600 mb-3" />
          <p className="text-slate-500 mb-3">No floors yet. Start with your main floor.</p>
          <button className="btn-primary mx-auto" onClick={addFloor}>
            <Plus size={16} /> Create first floor
          </button>
        </div>
      </div>
    )
  }

  const toolBtn = (active) =>
    `inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
      active ? 'bg-brand-600/25 text-brand-300 border border-brand-600/40' : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-transparent'
    }`

  return (
    <div className="h-full flex flex-col p-4 md:p-6 gap-3 md:gap-4 min-h-0">
      {/* Header + floor tabs */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex items-end gap-4">
          <h1 className="page-title">Floor Plans</h1>
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-900 border border-slate-800 mb-1">
            <button onClick={() => setMode('edit')} className={toolBtn(mode === 'edit')}><PenLine size={15} /> Edit</button>
            <button onClick={() => setMode('survey')} className={toolBtn(mode === 'survey')}><Wifi size={15} /> Survey</button>
          </div>
        </div>
        {mode === 'edit' && <SaveIndicator state={saveState} />}
      </div>

      <div className="flex items-center gap-1 overflow-x-auto border-b border-slate-800 -mb-px">
        {sortedFloors.map((f) => (
          <button key={f.id} onClick={() => switchFloor(f.id)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              f.id === currentId ? 'border-brand-500 text-slate-100' : 'border-transparent text-slate-500 hover:text-slate-300'
            }`}>
            {f.name}
          </button>
        ))}
        <button onClick={addFloor} title="Add floor"
          className="ml-1 p-2 text-slate-500 hover:text-brand-400 rounded-md hover:bg-slate-800">
          <Plus size={16} />
        </button>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {mode === 'edit' && <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-900 border border-slate-800">
          {TOOLS.map(({ id, label, icon: Icon, key }) => (
            <button key={id} onClick={() => setTool(id)} className={toolBtn(tool === id)} title={`${label} (${key})`}>
              <Icon size={15} /> <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>}

        {mode === 'edit' && tool === 'wall' && (
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-900 border border-slate-800">
            {Object.keys(WALL_DEFAULTS).map((t) => (
              <button key={t} onClick={() => setWallType(t)} className={toolBtn(wallType === t)}>
                {t === 'exterior' ? 'Exterior' : 'Interior'}
                <span className="text-xs text-slate-500 font-mono">{WALL_DEFAULTS[t].thickness}"</span>
              </button>
            ))}
          </div>
        )}

        {mode === 'edit' && tool === 'device' && (
          <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-900 border border-slate-800">
            {Object.entries(DEVICE_TYPES).map(([t, { label }]) => (
              <button key={t} onClick={() => setDeviceType(t)} className={toolBtn(deviceType === t)}>{label}</button>
            ))}
          </div>
        )}

        <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-900 border border-slate-800">
          {mode === 'edit' && <>
            <button onClick={undo} disabled={!undoRef.current.length} title="Undo (Ctrl+Z)"
              className={`${toolBtn(false)} disabled:opacity-30 disabled:pointer-events-none`}><Undo2 size={15} /></button>
            <button onClick={redo} disabled={!redoRef.current.length} title="Redo (Ctrl+Shift+Z)"
              className={`${toolBtn(false)} disabled:opacity-30 disabled:pointer-events-none`}><Redo2 size={15} /></button>
          </>}
          <button onClick={() => setShowDims((v) => !v)} title="Show all wall dimensions" className={toolBtn(showDims)}>
            <Ruler size={15} /> <span className="hidden sm:inline">Dimensions</span>
          </button>
          <button onClick={toggleWifiLayer} title="Colour walls by material and show the Wi-Fi legend" className={toolBtn(wifiLayer)}>
            <Wifi size={15} /> <span className="hidden sm:inline">Wi-Fi layer</span>
          </button>
        </div>

        <div className="relative">
          <button onClick={() => setExportOpen((v) => !v)} className="btn-ghost !py-1.5" title="Export this floor">
            <Download size={15} /> <span className="hidden sm:inline">Export</span>
          </button>
          {exportOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setExportOpen(false)} />
              <div className="absolute right-0 sm:left-0 sm:right-auto mt-1 z-20 w-56 rounded-lg bg-slate-900 border border-slate-700 shadow-xl p-1">
                <button onClick={() => runExport('png')} className="w-full text-left px-3 py-2 rounded-md hover:bg-slate-800">
                  <div className="text-sm text-slate-200">PNG image</div>
                  <div className="text-xs text-slate-500">For printing or sharing</div>
                </button>
                <button onClick={() => runExport('svg')} className="w-full text-left px-3 py-2 rounded-md hover:bg-slate-800">
                  <div className="text-sm text-slate-200">SVG vector</div>
                  <div className="text-xs text-slate-500">Scales cleanly; opens in Inkscape, Illustrator, browsers</div>
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Editor + side panel */}
      <div className="flex-1 min-h-[420px] flex flex-col lg:flex-row gap-3 md:gap-4">
        <div className="flex-1 min-h-[360px] rounded-xl border border-slate-800 overflow-hidden">
          <FloorPlanCanvas
            plan={plan}
            ghost={ghost}
            tool={mode === 'survey' ? 'survey' : tool}
            heatmap={heatmap}
            survey={mode === 'survey' ? {
              suggestions, points: floorPoints, selectedId: selectedPointId, onPick: surveyPick,
            } : null}
            wallType={wallType}
            deviceType={deviceType}
            wifiLayer={wifiLayer}
            selection={selection}
            onSelect={setSelection}
            showDims={showDims}
            fitKey={currentId}
            north={north}
            onCommit={commit}
            onBeginTransient={pushUndo}
            onTransient={setPlan}
            onTransientEnd={finishTransient}
          />
        </div>

        <aside className="lg:w-72 flex-shrink-0 space-y-3 lg:overflow-y-auto">
          {mode === 'survey' ? (
            <SurveyPanel
              surveyId={surveyId}
              onSurveyChange={setSurveyId}
              state={surveyState}
              suggestions={suggestions}
              floorPoints={floorPoints}
              selectedPoint={selectedPoint}
              onSelectPoint={setSelectedPointId}
              message={surveyMsg ?? surveyState.error}
              onAction={surveyAction}
              analysisProps={{
                analysis, busy: analysisBusy, error: analysisError, onAnalyze: runAnalysis,
                show: showHeatmap, onShow: setShowHeatmap, band: heatBand, onBand: setHeatBand,
              }}
            />
          ) : (<>
          {selWall && (
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-200">Wall</h3>
                <button className="text-slate-500 hover:text-red-400" title="Delete wall (Del)" onClick={deleteSelected}><Trash2 size={15} /></button>
              </div>
              <div>
                <label className="label">Length</label>
                <CommitInput
                  className="font-mono"
                  value={Math.round(wallLength(selWall, nm) * 100) / 100}
                  format={fmtLen}
                  parse={parseLen}
                  validate={(v) => Number.isFinite(v) && v > 0}
                  onCommit={(v) => edit((p) => setWallLength(p, selWall.id, v))}
                />
                <p className="text-xs text-slate-600 mt-1">e.g. 12'6", 12.5, or 150in. Moves the far end.</p>
              </div>
              <div>
                <label className="label">Thickness (in)</label>
                <CommitInput
                  className="font-mono" inputMode="decimal"
                  value={selWall.thickness}
                  parse={Number}
                  validate={(v) => Number.isFinite(v) && v > 0 && v <= 36}
                  onCommit={(v) => edit((p) => { p.walls.find((w) => w.id === selWall.id).thickness = v })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input type="checkbox" className="accent-brand-500" checked={!!selWall.exterior}
                  onChange={(e) => edit((p) => {
                    const w = p.walls.find((x) => x.id === selWall.id)
                    const old = WALL_DEFAULTS[w.exterior ? 'exterior' : 'interior']
                    const wasDefaultThickness = w.thickness === old.thickness
                    const wasDefaultMaterial = wallMaterial(w) === old.material
                    w.exterior = e.target.checked
                    const nu = WALL_DEFAULTS[w.exterior ? 'exterior' : 'interior']
                    if (wasDefaultThickness) w.thickness = nu.thickness
                    if (wasDefaultMaterial) w.material = nu.material
                  })} />
                Exterior wall
              </label>
              <div>
                <label className="label">Material</label>
                <select className="input" value={wallMaterial(selWall)}
                  onChange={(e) => edit((p) => { p.walls.find((w) => w.id === selWall.id).material = e.target.value })}>
                  {Object.entries(WALL_MATERIALS).map(([k, { label }]) => <option key={k} value={k}>{label}</option>)}
                </select>
                <p className="text-xs text-slate-600 mt-1">Used to estimate how much Wi-Fi signal this wall blocks.</p>
              </div>
            </div>
          )}

          {selRoom && (
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-200">Room</h3>
                <button className="text-slate-500 hover:text-red-400" title="Delete room (Del)" onClick={deleteSelected}><Trash2 size={15} /></button>
              </div>
              <div>
                <label className="label">Name</label>
                <CommitInput
                  value={selRoom.name}
                  validate={(v) => v.trim().length > 0}
                  onCommit={(v) => edit((p) => { p.rooms.find((r) => r.id === selRoom.id).name = v.trim() })}
                />
              </div>
              <div>
                <Stat label="Area" value={`${sqft(polygonArea(roomPoints(selRoom, nm))).toFixed(1)} sq ft`} />
                <Stat label="Perimeter" value={fmtLen(polygonPerimeter(roomPoints(selRoom, nm)))} />
              </div>
              <p className="text-xs text-slate-600">Measured to wall centerlines.</p>
              <div className="border-t border-slate-800 pt-3 space-y-3">
                <div>
                  <label className="label">Wi-Fi priority</label>
                  <div className="grid grid-cols-3 gap-1">
                    {Object.entries(ROOM_PRIORITIES).map(([k, l]) => (
                      <button key={k} onClick={() => editRoom((r) => { r.priority = k })}
                        className={`px-2 py-1.5 rounded-md text-xs border ${(selRoom.priority ?? 'normal') === k
                          ? 'bg-brand-600/25 text-brand-300 border-brand-600/40' : 'border-slate-700 text-slate-400 hover:bg-slate-800'}`}>
                        {l}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="label">Used for</label>
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(ROOM_USES).map(([k, l]) => {
                      const on = (selRoom.uses ?? []).includes(k)
                      return (
                        <button key={k}
                          onClick={() => editRoom((r) => { r.uses = on ? (r.uses ?? []).filter((u) => u !== k) : [...(r.uses ?? []), k] })}
                          className={`px-2 py-1 rounded-full text-xs border ${on
                            ? 'bg-brand-600/25 text-brand-300 border-brand-600/40' : 'border-slate-700 text-slate-500 hover:text-slate-300'}`}>
                          {l}
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-xs text-slate-600 mt-1">Sets the signal target, e.g. video calls need about -67 dBm or better.</p>
                </div>
                <label className="flex items-start gap-2 text-sm text-slate-300 cursor-pointer">
                  <input type="checkbox" className="accent-brand-500 mt-0.5" checked={!!selRoom.noAp}
                    onChange={(e) => editRoom((r) => { r.noAp = e.target.checked || undefined })} />
                  <span>
                    Don't put an AP in this room
                    {plan.apPlacement !== 'anywhere' && (
                      <span className="block text-xs text-slate-500">Only matters when the floor's AP placement is "Anywhere".</span>
                    )}
                  </span>
                </label>
              </div>
            </div>
          )}

          {selOpening && selOpeningInfo && (
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-200">{OPENING_LABELS[selOpening.type]}</h3>
                <button className="text-slate-500 hover:text-red-400" title="Delete (Del)" onClick={deleteSelected}><Trash2 size={15} /></button>
              </div>
              <div>
                <label className="label">Type</label>
                <select className="input" value={selOpening.type}
                  onChange={(e) => editOpening((o) => {
                    o.type = e.target.value
                    if (o.type === 'door') { o.side ??= 1; o.hinge ??= 'a' }
                  })}>
                  {Object.entries(OPENING_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">Width (in)</label>
                  <CommitInput
                    className="font-mono" inputMode="decimal"
                    value={selOpening.width}
                    parse={Number}
                    validate={(v) => Number.isFinite(v) && v > 0 && openingFits(plan, selOpening.wallId, selOpeningInfo.span.offset, v, selOpening.id)}
                    onCommit={(v) => editOpening((o) => { o.width = v; o.offset = selOpeningInfo.span.offset })}
                  />
                </div>
                <div>
                  <label className="label">Height (in)</label>
                  <CommitInput
                    className="font-mono" inputMode="decimal"
                    value={selOpening.height}
                    parse={Number}
                    validate={(v) => Number.isFinite(v) && v > 0 && v <= 240}
                    onCommit={(v) => editOpening((o) => { o.height = v })}
                  />
                </div>
              </div>
              <div>
                <label className="label">Position along wall</label>
                <CommitInput
                  className="font-mono"
                  value={Math.round((selOpeningInfo.span.offset - selOpeningInfo.span.width / 2) * 100) / 100}
                  format={fmtLen}
                  parse={(s) => (s.trim() === '0' ? 0 : parseLen(s))}
                  validate={(v) => Number.isFinite(v) && v >= 0 &&
                    openingFits(plan, selOpening.wallId, v + selOpeningInfo.span.width / 2, selOpeningInfo.span.width, selOpening.id)}
                  onCommit={(v) => editOpening((o) => { o.offset = v + selOpeningInfo.span.width / 2 })}
                />
                <p className="text-xs text-slate-600 mt-1">From the circled corner to the near edge. Wall is {fmtLen(selOpeningInfo.span.len)}.</p>
              </div>
              {selOpening.type === 'door' && (
                <div className="grid grid-cols-2 gap-2">
                  <button className="btn-ghost justify-center !px-2" onClick={() => editOpening((o) => { o.side = o.side === -1 ? 1 : -1 })}>
                    <FlipVertical2 size={14} /> Swing side
                  </button>
                  <button className="btn-ghost justify-center !px-2" onClick={() => editOpening((o) => { o.hinge = o.hinge === 'b' ? 'a' : 'b' })}>
                    <FlipHorizontal2 size={14} /> Hinge
                  </button>
                </div>
              )}
              <div>
                <Stat label="Area" value={`${sqft(selOpeningInfo.span.width * selOpening.height).toFixed(1)} sq ft`} />
                <Stat label="Wall" value={selOpeningInfo.span.wall.exterior ? 'Exterior' : 'Interior'} />
                {selOpeningInfo.facing && <Stat label="Faces" value={FACING_NAMES[selOpeningInfo.facing]} />}
              </div>
            </div>
          )}

          {selDevice && (
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-200">{DEVICE_TYPES[selDevice.type].label}</h3>
                <button className="text-slate-500 hover:text-red-400" title="Delete (Del)" onClick={deleteSelected}><Trash2 size={15} /></button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label">Label</label>
                  <CommitInput value={selDevice.label} validate={(v) => v.trim().length > 0}
                    onCommit={(v) => editDevice((d) => { d.label = v.trim() })} />
                </div>
                <div>
                  <label className="label">Mount</label>
                  <select className="input" value={selDevice.mount}
                    onChange={(e) => editDevice((d) => { d.mount = e.target.value })}>
                    {Object.entries(MOUNTS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Type</label>
                <select className="input" value={selDevice.type}
                  onChange={(e) => editDevice((d) => {
                    d.type = e.target.value
                    if (d.type === 'ethernet') d.existing ??= true
                    if (d.type === 'candidate') d.cableFeasible ??= true
                    if (d.type === 'ap') d.model ??= ''
                  })}>
                  {Object.entries(DEVICE_TYPES).map(([k, { label }]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </div>
              {selDevice.type === 'ethernet' && (
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                  <input type="checkbox" className="accent-brand-500" checked={selDevice.existing !== false}
                    onChange={(e) => editDevice((d) => { d.existing = e.target.checked })} />
                  Already installed (untick for a possible future run)
                </label>
              )}
              {selDevice.type === 'candidate' && (
                <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                  <input type="checkbox" className="accent-brand-500" checked={selDevice.cableFeasible !== false}
                    onChange={(e) => editDevice((d) => { d.cableFeasible = e.target.checked })} />
                  Ethernet can reach this spot
                </label>
              )}
              {selDevice.type === 'ap' && (
                <div>
                  <label className="label">Model</label>
                  <CommitInput value={selDevice.model ?? ''} placeholder="e.g. ISP router, Deco X55"
                    onCommit={(v) => editDevice((d) => { d.model = v.trim() })} />
                  <p className="text-xs text-slate-600 mt-1">Marking where your current router and mesh units sit lets the survey calibrate its model.</p>
                </div>
              )}
            </div>
          )}

          {selNode && (
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-200">Corner</h3>
                <button className="text-slate-500 hover:text-red-400" title="Delete corner and its walls (Del)" onClick={deleteSelected}><Trash2 size={15} /></button>
              </div>
              <Stat label="Connected walls" value={plan.walls.filter((w) => w.a === selNode.id || w.b === selNode.id).length} />
              <p className="text-xs text-slate-600">Drag to move. Deleting removes attached walls too.</p>
            </div>
          )}

          {floor && (
            <div className="card space-y-3">
              <h3 className="text-sm font-semibold text-slate-200">Floor</h3>
              <div>
                <label className="label">Name</label>
                <CommitInput
                  value={floor.name}
                  validate={(v) => v.trim().length > 0}
                  onCommit={(v) => updateFloor(floor.id, { name: v.trim() })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="label" title="Floors are ordered by level. The floor directly below is shown faintly for alignment.">Level</label>
                  <CommitInput
                    className="font-mono" inputMode="numeric"
                    value={floor.level}
                    parse={(v) => Number(v)}
                    validate={(v) => Number.isInteger(v)}
                    onCommit={(v) => updateFloor(floor.id, { level: v })}
                  />
                </div>
                <div>
                  <label className="label">Ceiling (ft)</label>
                  <CommitInput
                    className="font-mono" inputMode="decimal"
                    value={floor.ceilingHt}
                    parse={Number}
                    validate={(v) => Number.isFinite(v) && v > 0 && v < 50}
                    onCommit={(v) => updateFloor(floor.id, { ceilingHt: v })}
                  />
                </div>
              </div>
              <p className="text-xs text-slate-600">Level: -1 basement, 0 main, 1 upper…</p>
              <div>
                <label className="label">North direction (°)</label>
                <div className="flex gap-2">
                  <CommitInput
                    className="font-mono" inputMode="numeric"
                    value={north}
                    parse={Number}
                    validate={(v) => Number.isFinite(v)}
                    onCommit={setNorth}
                  />
                  <button className="btn-ghost !px-3 flex-shrink-0" title="Rotate north 45°" onClick={() => setNorth(north + 45)}>
                    <RotateCw size={14} />
                  </button>
                </div>
                <p className="text-xs text-slate-600 mt-1">Clockwise from the top of the screen. Shared by all floors; sets which way windows face.</p>
              </div>
              <div>
                <label className="label">Floor structure (below this level)</label>
                <select className="input" value={plan.floorStructure}
                  onChange={(e) => edit((p) => { p.floorStructure = e.target.value })}>
                  {Object.entries(FLOOR_STRUCTURES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <p className="text-xs text-slate-600 mt-1">How much Wi-Fi this floor loses to the level beneath. Ignored on the lowest floor.</p>
              </div>
              <div>
                <label className="label">New AP placement</label>
                <select className="input" value={plan.apPlacement}
                  onChange={(e) => edit((p) => { p.apPlacement = e.target.value })}>
                  {Object.entries(AP_PLACEMENT).map(([k, { label }]) => <option key={k} value={k}>{label}</option>)}
                </select>
                <p className="text-xs text-slate-600 mt-1">{AP_PLACEMENT[plan.apPlacement]?.hint}. Exclude single rooms from the room panel.</p>
              </div>
              <div className="border-t border-slate-800 pt-2">
                <Stat label="Enclosed area" value={`${Math.round(sqft(enclosedFootprint(plan)))} sq ft`} />
                <Stat label="Room area" value={`${Math.round(stats.roomArea)} sq ft`} />
                <Stat label="Doors / windows" value={`${plan.openings.filter((o) => o.type === 'door').length} / ${plan.openings.filter((o) => o.type === 'window').length}`} />
                <Stat label="Exterior walls" value={fmtLen(stats.extLen)} />
                <Stat label="Ext. wall area (gross)" value={`${Math.round(stats.extWallArea)} sq ft`} />
                <Stat label="Interior walls" value={fmtLen(stats.intLen)} />
              </div>
              <DuplicateFloor floor={floor} floors={floors} onDuplicate={duplicateFloor} />
              <button className="btn-danger w-full justify-center" onClick={deleteFloor}>
                <Trash2 size={14} /> Delete floor
              </button>
            </div>
          )}

          <div className="card text-xs text-slate-500 space-y-1">
            <p><span className="text-slate-300 font-mono">V W R D N E</span> select, wall, room, door, window, network</p>
            <p><span className="text-slate-300 font-mono">Alt</span> hold to disable snapping</p>
            <p><span className="text-slate-300 font-mono">Del</span> delete selection</p>
            <p><span className="text-slate-300 font-mono">Ctrl+Z</span> undo · <span className="text-slate-300 font-mono">Ctrl+Shift+Z</span> redo</p>
            <p><span className="text-slate-300 font-mono">Esc</span> finish wall / deselect</p>
          </div>
          </>)}
        </aside>
      </div>
    </div>
  )
}
