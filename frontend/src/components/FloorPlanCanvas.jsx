import { useState, useRef, useEffect, useLayoutEffect, useMemo } from 'react'
import { ZoomIn, ZoomOut, Maximize } from 'lucide-react'
import {
  GRID, WALL_DEFAULTS, OPENING_DEFAULTS, uid, dist, roundTo, nodeMap, clonePlan, snapPoint, resolveAnchor, addWall,
  roomPoints, polygonArea, polygonCentroid, sqft, planBounds, fmtLen, findEnclosedArea, findRoomByNodes,
  projectOnSegment, openingSpan, openingFits, WALL_MATERIALS, wallMaterial, newDevice, DEVICE_TYPES,
} from '../floorplan/geometry'
import { DARK_THEME as T, DimLabel, OpeningShape, NorthArrowGlyph, DeviceGlyph } from '../floorplan/shapes'
import { signalClass, pointSignal, ACTIVE_STATUSES } from '../floorplan/survey'

const MIN_SCALE = 0.2   // px per inch
const MAX_SCALE = 24
const SNAP_PX = 10
const OPENING_SNAP_PX = 18
const clampScale = (s) => Math.max(MIN_SCALE, Math.min(MAX_SCALE, s))

const HINTS = {
  select: 'Click to select · Drag a point, wall, door or window to move it · Drag empty space to pan · Scroll to zoom',
  wallIdle: 'Click to start a wall · Hold Alt to disable snapping',
  wallActive: 'Click to add a corner · Click an existing point or wall to join · Double-click, right-click or Esc to finish',
  room: 'Click inside an area fully enclosed by walls to create a room',
  door: 'Hover a wall and click to place a door · It swings toward the side your cursor is on',
  window: 'Hover a wall and click to place a window',
  device: 'Click to place · Ethernet drops and candidate sites tell the Wi-Fi planner where APs can go',
  survey: 'Stand at a suggested spot and click it to measure · Click anywhere else to add your own spot · Drag to pan',
}

// Survey markers, drawn in screen-pixel sizes. `onPick` receives
// { kind: 'suggestion' | 'point', ... } from a click on a marker.
function SurveyMarkers({ survey, px, onPointerDown }) {
  const taken = new Set(survey.points.map((p) => p.label))
  return (
    <g>
      {survey.suggestions.filter((sg) => !taken.has(sg.key)).map((sg) => {
        const r = 8 * px
        return (
          <g key={sg.key} className="cursor-pointer" onPointerDown={(e) => onPointerDown(e, { kind: 'suggestion', suggestion: sg })}>
            {sg.kind === 'doorway' ? (
              <rect x={sg.x - r * 0.8} y={sg.y - r * 0.8} width={r * 1.6} height={r * 1.6}
                transform={`rotate(45 ${sg.x} ${sg.y})`} fill={T.bg} fillOpacity={0.85}
                stroke="#94a3b8" strokeWidth={1.5 * px} strokeDasharray={`${3 * px} ${2 * px}`} />
            ) : (
              <circle cx={sg.x} cy={sg.y} r={r} fill={T.bg} fillOpacity={0.85}
                stroke="#94a3b8" strokeWidth={1.5 * px} strokeDasharray={`${3 * px} ${2 * px}`} />
            )}
            <text x={sg.x} y={sg.y} textAnchor="middle" dominantBaseline="central" fontSize={9 * px}
              fill="#cbd5e1" fontWeight={600} style={{ userSelect: 'none' }} pointerEvents="none">{sg.index}</text>
            <circle cx={sg.x} cy={sg.y} r={13 * px} fill="transparent" />
          </g>
        )
      })}
      {survey.points.map((pt) => {
        const sel = survey.selectedId === pt.id
        const active = ACTIVE_STATUSES.includes(pt.status)
        const sig = pointSignal(pt.record)
        const cls = pt.record ? signalClass(sig) : null
        const r = 10 * px
        return (
          <g key={pt.id} className="cursor-pointer" onPointerDown={(e) => onPointerDown(e, { kind: 'point', point: pt })}>
            {sel && <circle cx={pt.x} cy={pt.y} r={r + 5 * px} fill="none" stroke="#f8fafc" strokeWidth={2 * px} />}
            {active ? (
              <>
                <circle cx={pt.x} cy={pt.y} r={r} fill="none" stroke={T.selected} strokeWidth={2.5 * px}>
                  <animate attributeName="r" values={`${r};${r * 1.8};${r}`} dur="1.6s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="1;0.2;1" dur="1.6s" repeatCount="indefinite" />
                </circle>
                <circle cx={pt.x} cy={pt.y} r={4 * px} fill={T.selected} />
              </>
            ) : cls ? (
              <>
                <circle cx={pt.x} cy={pt.y} r={r} fill={cls.color} stroke={T.bg} strokeWidth={1.5 * px} />
                <text x={pt.x} y={pt.y} textAnchor="middle" dominantBaseline="central" fontSize={8 * px}
                  fontWeight={700} fill={cls.text} style={{ userSelect: 'none' }} pointerEvents="none">
                  {Math.round(sig)}
                </text>
                {pt.error && <circle cx={pt.x + r * 0.8} cy={pt.y - r * 0.8} r={3 * px} fill="#f59e0b" />}
              </>
            ) : (
              <>
                <circle cx={pt.x} cy={pt.y} r={r} fill={T.bg} stroke="#ef4444" strokeWidth={2 * px} />
                <path d={`M ${pt.x - 4 * px} ${pt.y - 4 * px} L ${pt.x + 4 * px} ${pt.y + 4 * px} M ${pt.x + 4 * px} ${pt.y - 4 * px} L ${pt.x - 4 * px} ${pt.y + 4 * px}`}
                  stroke="#ef4444" strokeWidth={2 * px} strokeLinecap="round" />
              </>
            )}
            <circle cx={pt.x} cy={pt.y} r={14 * px} fill="transparent" />
          </g>
        )
      })}
    </g>
  )
}

export default function FloorPlanCanvas({
  plan, ghost, tool, wallType, deviceType = 'ethernet', wifiLayer = false, selection, onSelect, showDims, fitKey, north = 0,
  survey = null,
  onCommit, onBeginTransient, onTransient,
}) {
  const wrapRef = useRef(null)
  const svgRef = useRef(null)
  const drag = useRef(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [view, setView] = useState({ cx: 0, cy: 0, scale: 2 })
  const [cursor, setCursor] = useState(null) // { snap } | { area } | { opening, valid }
  const [drawStart, setDrawStart] = useState(null)
  const [message, setMessage] = useState(null)

  const nm = useMemo(() => nodeMap(plan), [plan])
  const wallsById = useMemo(() => Object.fromEntries(plan.walls.map((w) => [w.id, w])), [plan])
  const ghostNm = useMemo(() => (ghost ? nodeMap(ghost) : {}), [ghost])
  const px = 1 / view.scale
  const measured = size.w > 0 && size.h > 0

  // ── View management ──────────────────────────────────────────────────────

  useLayoutEffect(() => {
    const ro = new ResizeObserver(([entry]) => {
      setSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    })
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  const fit = () => {
    const b = planBounds([plan, ghost])
    if (!b || !measured) {
      setView({ cx: 240, cy: 180, scale: 2 })
      return
    }
    const pad = 60
    const w = Math.max(b.maxX - b.minX, 120), h = Math.max(b.maxY - b.minY, 120)
    const scale = clampScale(Math.min((size.w - pad * 2) / w, (size.h - pad * 2) / h))
    setView({ cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, scale })
  }

  // Fit when switching floors, and once the container has been measured.
  useEffect(() => {
    if (measured) fit()
    setDrawStart(null)
  }, [fitKey, measured]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setDrawStart(null)
    setCursor(null)
  }, [tool])

  useEffect(() => {
    const el = svgRef.current
    const onWheel = (e) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const sx = e.clientX - r.left - r.width / 2
      const sy = e.clientY - r.top - r.height / 2
      setView((v) => {
        const scale = clampScale(v.scale * Math.exp(-e.deltaY * 0.0015))
        const wx = v.cx + sx / v.scale, wy = v.cy + sy / v.scale
        return { scale, cx: wx - sx / scale, cy: wy - sy / scale }
      })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (drawStart) setDrawStart(null)
      else onSelect(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawStart, onSelect])

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(null), 2500)
    return () => clearTimeout(t)
  }, [message])

  const zoomBy = (f) => setView((v) => ({ ...v, scale: clampScale(v.scale * f) }))

  const toWorld = (e) => {
    const r = svgRef.current.getBoundingClientRect()
    return {
      x: view.cx + (e.clientX - r.left - size.w / 2) / view.scale,
      y: view.cy + (e.clientY - r.top - size.h / 2) / view.scale,
    }
  }

  const computeSnap = (world, e) =>
    snapPoint(plan, world, { from: drawStart, tol: SNAP_PX / view.scale, free: e.altKey })

  // Nearest wall to the pointer, with the projected distance along it.
  const nearestWall = (world) => {
    let best = null
    for (const w of plan.walls) {
      const a = nm[w.a], b = nm[w.b]
      if (!a || !b) continue
      const pr = projectOnSegment(world, a, b)
      const tol = w.thickness / 2 + OPENING_SNAP_PX * px
      if (pr.d <= tol && (!best || pr.d < best.d)) best = { wall: w, d: pr.d, along: pr.t * dist(a, b) }
    }
    return best
  }

  // Build a candidate opening of the current tool's type under the pointer.
  const openingCandidate = (world) => {
    const hit = nearestWall(world)
    if (!hit) return null
    const { wall, along } = hit
    const len = wallLength(wall)
    const { width, height } = OPENING_DEFAULTS[tool]
    const offset = Math.max(width / 2, Math.min(len - width / 2, Math.round(along)))
    const a = nm[wall.a]
    const n = { x: -(nm[wall.b].y - a.y) / len, y: (nm[wall.b].x - a.x) / len }
    const side = ((world.x - a.x) * n.x + (world.y - a.y) * n.y) >= 0 ? 1 : -1
    const opening = { id: uid(), wallId: wall.id, type: tool, offset, width, height }
    if (tool === 'door') { opening.side = side; opening.hinge = 'a' }
    return { opening, valid: openingFits(plan, wall.id, offset, width) }
  }

  const wallLength = (w) => dist(nm[w.a], nm[w.b])

  // ── Actions ──────────────────────────────────────────────────────────────

  const placeWallPoint = (s) => {
    if (!drawStart) {
      setDrawStart(s)
      return
    }
    // Clicking the same spot again (e.g. second half of a double-click) ends the chain.
    if (dist(s, drawStart) < 0.5) {
      setDrawStart(null)
      return
    }
    const next = clonePlan(plan)
    const a = resolveAnchor(next, drawStart)
    const b = resolveAnchor(next, s)
    if (addWall(next, a, b, { ...WALL_DEFAULTS[wallType] })) onCommit(next)
    // Landing on an existing point or wall closes the chain.
    setDrawStart(s.nodeId || s.wallId ? null : { x: s.x, y: s.y, nodeId: b })
  }

  const placeRoom = (world) => {
    const ids = findEnclosedArea(plan, world)
    if (!ids) {
      setMessage('No enclosed area here — rooms need walls on every side')
      return
    }
    const existing = findRoomByNodes(plan, ids)
    if (existing) {
      onSelect({ type: 'room', id: existing.id })
      return
    }
    const next = clonePlan(plan)
    const room = { id: uid(), name: `Room ${next.rooms.length + 1}`, nodeIds: ids }
    next.rooms.push(room)
    onCommit(next)
    onSelect({ type: 'room', id: room.id })
  }

  const placeOpening = (world) => {
    const cand = openingCandidate(world)
    if (!cand) {
      setMessage(`Hover over a wall to place a ${tool}`)
      return
    }
    if (!cand.valid) {
      setMessage(`Not enough room on this wall for a ${OPENING_DEFAULTS[tool].width}" ${tool}`)
      return
    }
    const next = clonePlan(plan)
    next.openings.push(cand.opening)
    onCommit(next)
    onSelect({ type: 'opening', id: cand.opening.id })
  }

  const devicePoint = (world, e) =>
    e.altKey ? { x: Math.round(world.x), y: Math.round(world.y) } : { x: roundTo(world.x, GRID), y: roundTo(world.y, GRID) }

  const placeDevice = (world, e) => {
    const { x, y } = devicePoint(world, e)
    const next = clonePlan(plan)
    const d = newDevice(next, deviceType, x, y)
    next.devices.push(d)
    onCommit(next)
    onSelect({ type: 'device', id: d.id })
  }

  // ── Pointer handling ─────────────────────────────────────────────────────

  const startPan = (e, click = false) => {
    drag.current = { type: 'pan', sx: e.clientX, sy: e.clientY, view, click, moved: false }
    svgRef.current.setPointerCapture(e.pointerId)
  }

  const handleDown = (e) => {
    if (e.button === 1) return startPan(e)
    if (e.button === 2) return setDrawStart(null)
    if (e.button !== 0) return
    if (tool === 'select') {
      // Element handlers stop propagation, so reaching here means empty space.
      onSelect(null)
      return startPan(e)
    }
    if (tool === 'survey') return startPan(e, true)  // a click without dragging picks a spot
    const world = toWorld(e)
    if (tool === 'wall') placeWallPoint(computeSnap(world, e))
    else if (tool === 'room') placeRoom(world)
    else if (tool === 'door' || tool === 'window') placeOpening(world)
    else if (tool === 'device') placeDevice(world, e)
  }

  const startElementDrag = (e, type, id) => {
    if (tool !== 'select' || e.button !== 0) return
    e.stopPropagation()
    onSelect({ type, id })
    drag.current = { type, id, base: plan, start: toWorld(e), moved: false }
    svgRef.current.setPointerCapture(e.pointerId)
  }

  const selectRoom = (e, id) => {
    if (tool !== 'select' || e.button !== 0) return
    e.stopPropagation()
    onSelect({ type: 'room', id })
    startPan(e)
  }

  const dragOpening = (d, world) => {
    const base = d.base
    const o = base.openings.find((x) => x.id === d.id)
    const w = base.walls.find((x) => x.id === o?.wallId)
    if (!o || !w) return
    const bnm = nodeMap(base)
    const a = bnm[w.a], b = bnm[w.b]
    const len = dist(a, b)
    const offset = Math.round(Math.max(o.width / 2, Math.min(len - o.width / 2, projectOnSegment(world, a, b).t * len)))
    if (offset === Math.round(o.offset) && !d.moved) return
    if (!openingFits(base, w.id, offset, o.width, o.id)) return
    const next = clonePlan(base)
    next.openings.find((x) => x.id === d.id).offset = offset
    if (!d.moved) { d.moved = true; onBeginTransient() }
    onTransient(next)
  }

  const handleMove = (e) => {
    const d = drag.current
    if (d?.type === 'pan') {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 4) d.moved = true
      setView({
        ...d.view,
        cx: d.view.cx - (e.clientX - d.sx) / d.view.scale,
        cy: d.view.cy - (e.clientY - d.sy) / d.view.scale,
      })
      return
    }
    const world = toWorld(e)
    if (d?.type === 'opening') return dragOpening(d, world)
    if (d?.type === 'device') {
      let dx = world.x - d.start.x, dy = world.y - d.start.y
      if (!e.altKey) { dx = roundTo(dx, GRID); dy = roundTo(dy, GRID) }
      if (!d.moved && dx === 0 && dy === 0) return
      const next = clonePlan(d.base)
      const dev = next.devices.find((x) => x.id === d.id)
      dev.x = Math.round((dev.x + dx) * 100) / 100
      dev.y = Math.round((dev.y + dy) * 100) / 100
      if (!d.moved) { d.moved = true; onBeginTransient() }
      onTransient(next)
      return
    }
    if (d?.type === 'node' || d?.type === 'wall') {
      let dx = world.x - d.start.x, dy = world.y - d.start.y
      if (!e.altKey) { dx = roundTo(dx, GRID); dy = roundTo(dy, GRID) }
      if (!d.moved && dx === 0 && dy === 0) return
      const next = clonePlan(d.base)
      const ids = d.type === 'node' ? [d.id] : (() => {
        const w = next.walls.find((x) => x.id === d.id)
        return [w.a, w.b]
      })()
      next.nodes.forEach((n) => {
        if (ids.includes(n.id)) { n.x = Math.round((n.x + dx) * 100) / 100; n.y = Math.round((n.y + dy) * 100) / 100 }
      })
      if (!d.moved) { d.moved = true; onBeginTransient() }
      onTransient(next)
      return
    }
    if (tool === 'wall') setCursor({ snap: computeSnap(world, e) })
    else if (tool === 'room') setCursor({ area: findEnclosedArea(plan, world) })
    else if (tool === 'door' || tool === 'window') setCursor(openingCandidate(world))
    else if (tool === 'device') setCursor({ device: { type: deviceType, ...devicePoint(world, e) } })
  }

  const handleUp = (e) => {
    const d = drag.current
    drag.current = null
    if (d?.type === 'pan' && d.click && !d.moved && survey) {
      const w = toWorld(e)
      survey.onPick({ kind: 'spot', x: Math.round(w.x), y: Math.round(w.y) })
    }
  }

  const pickSurveyMarker = (e, target) => {
    if (tool !== 'survey' || e.button !== 0) return
    e.stopPropagation()
    survey.onPick(target)
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const vbX = view.cx - size.w / 2 / view.scale
  const vbY = view.cy - size.h / 2 / view.scale
  const vbW = (size.w || 1) / view.scale
  const vbH = (size.h || 1) / view.scale
  const showMinorGrid = 12 * view.scale >= 8

  const isSel = (type, id) => selection?.type === type && selection?.id === id
  const previewThickness = WALL_DEFAULTS[wallType].thickness
  const snap = cursor?.snap
  const hoverArea = cursor?.area?.map((id) => nm[id]).filter(Boolean)
  const preview = cursor?.opening ? { ...cursor, span: openingSpan(cursor.opening, nm, wallsById) } : null

  const selOpening = selection?.type === 'opening' ? plan.openings.find((o) => o.id === selection.id) : null
  const selOpeningStart = selOpening ? nm[wallsById[selOpening.wallId]?.a] : null

  const hint = message ?? (tool === 'wall' ? (drawStart ? HINTS.wallActive : HINTS.wallIdle) : HINTS[tool])

  return (
    <div ref={wrapRef} className="relative w-full h-full overflow-hidden bg-slate-950">
      <svg
        ref={svgRef}
        width={size.w} height={size.h}
        viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
        className={`block touch-none ${tool === 'select' ? 'cursor-default' : 'cursor-crosshair'}`}
        onPointerDown={handleDown}
        onPointerMove={handleMove}
        onPointerUp={handleUp}
        onPointerCancel={() => { drag.current = null }}
        onPointerLeave={() => setCursor(null)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <defs>
          <pattern id="fp-grid-minor" width={12} height={12} patternUnits="userSpaceOnUse">
            <path d="M 12 0 L 0 0 0 12" fill="none" stroke="#1e293b" strokeWidth={px} />
          </pattern>
          <pattern id="fp-grid-major" width={60} height={60} patternUnits="userSpaceOnUse">
            {showMinorGrid && <rect width={60} height={60} fill="url(#fp-grid-minor)" />}
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="#334155" strokeWidth={px} />
          </pattern>
        </defs>
        <rect x={vbX} y={vbY} width={vbW} height={vbH} fill="url(#fp-grid-major)" />

        {/* Floor below, for alignment */}
        {ghost && (
          <g pointerEvents="none" opacity={0.35}>
            {ghost.walls.map((w) => {
              const a = ghostNm[w.a], b = ghostNm[w.b]
              if (!a || !b) return null
              return (
                <line key={w.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                  stroke="#475569" strokeWidth={w.thickness} strokeLinecap="square" />
              )
            })}
          </g>
        )}

        {/* Rooms */}
        {plan.rooms.map((r) => {
          const pts = roomPoints(r, nm)
          if (pts.length < 3) return null
          const sel = isSel('room', r.id)
          return (
            <polygon
              key={r.id}
              points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
              fill={T.roomFill} fillOpacity={sel ? 0.2 : 0.07}
              stroke={sel ? T.selected : 'none'} strokeWidth={2 * px} strokeDasharray={`${6 * px} ${4 * px}`}
              onPointerDown={(e) => selectRoom(e, r.id)}
            />
          )
        })}

        {hoverArea && hoverArea.length >= 3 && (
          <polygon
            points={hoverArea.map((p) => `${p.x},${p.y}`).join(' ')}
            fill={T.roomFill} fillOpacity={0.15}
            stroke={T.selected} strokeWidth={1.5 * px} strokeDasharray={`${6 * px} ${4 * px}`}
            pointerEvents="none"
          />
        )}

        {/* Walls — interior first so exterior walls cleanly cover the joints */}
        {[...plan.walls].sort((a, b) => Number(!!a.exterior) - Number(!!b.exterior)).map((w) => {
          const a = nm[w.a], b = nm[w.b]
          if (!a || !b) return null
          const sel = isSel('wall', w.id)
          return (
            <g key={w.id}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={sel ? T.selected : wifiLayer ? WALL_MATERIALS[wallMaterial(w)]?.color ?? T.interior : w.exterior ? T.exterior : T.interior}
                strokeWidth={w.thickness} strokeLinecap="square" pointerEvents="none" />
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke="transparent" strokeWidth={Math.max(w.thickness, 14 * px)}
                pointerEvents={tool === 'select' ? 'stroke' : 'none'}
                className={tool === 'select' ? 'cursor-move' : ''}
                onPointerDown={(e) => startElementDrag(e, 'wall', w.id)} />
            </g>
          )
        })}

        {/* Doors & windows */}
        {plan.openings.map((o) => {
          const span = openingSpan(o, nm, wallsById)
          if (!span) return null
          return (
            <g key={o.id}>
              <OpeningShape span={span} opening={o} px={px} theme={T} selected={isSel('opening', o.id)} />
              <line x1={span.p1.x} y1={span.p1.y} x2={span.p2.x} y2={span.p2.y}
                stroke="transparent" strokeWidth={Math.max(span.wall.thickness, 14 * px)}
                pointerEvents={tool === 'select' ? 'stroke' : 'none'}
                className={tool === 'select' ? 'cursor-ew-resize' : ''}
                onPointerDown={(e) => startElementDrag(e, 'opening', o.id)} />
            </g>
          )
        })}
        {preview?.span && (
          <OpeningShape span={preview.span} opening={preview.opening} px={px} theme={T} ghost invalid={!preview.valid} />
        )}

        {/* Room labels (above walls so they stay readable) */}
        {plan.rooms.map((r) => {
          const pts = roomPoints(r, nm)
          if (pts.length < 3) return null
          const c = polygonCentroid(pts)
          return (
            <g key={r.id} pointerEvents="none" className="select-none">
              <text x={c.x} y={c.y - 8 * px} textAnchor="middle" fontSize={13 * px} fill={T.label}
                stroke={T.halo} strokeWidth={3 * px} paintOrder="stroke" fontWeight={600}>
                {r.name}
              </text>
              <text x={c.x} y={c.y + 8 * px} textAnchor="middle" fontSize={11 * px} fill={T.subLabel}
                stroke={T.halo} strokeWidth={3 * px} paintOrder="stroke" className="font-mono">
                {Math.round(sqft(polygonArea(pts)))} sq ft
              </text>
            </g>
          )
        })}

        {/* Dimensions */}
        {plan.walls.map((w) => {
          if (!showDims && !isSel('wall', w.id)) return null
          const a = nm[w.a], b = nm[w.b]
          if (!a || !b) return null
          return (
            <DimLabel key={w.id} a={a} b={b} px={px} offset={w.thickness / 2 + 9 * px} theme={T}
              text={fmtLen(dist(a, b))} color={isSel('wall', w.id) ? T.selected : T.label} />
          )
        })}

        {/* Corner points */}
        {(tool === 'select' || tool === 'wall') && plan.nodes.map((n) => {
          const sel = isSel('node', n.id)
          return (
            <g key={n.id}>
              <circle cx={n.x} cy={n.y} r={(sel ? 5 : 3.5) * px}
                fill={sel ? T.selected : T.halo} stroke={sel ? T.selected : '#94a3b8'}
                strokeWidth={1.5 * px} pointerEvents="none" />
              {tool === 'select' && (
                <circle cx={n.x} cy={n.y} r={9 * px} fill="transparent" className="cursor-move"
                  onPointerDown={(e) => startElementDrag(e, 'node', n.id)} />
              )}
            </g>
          )
        })}

        {/* Marks the corner that "position along wall" is measured from */}
        {selOpeningStart && (
          <circle cx={selOpeningStart.x} cy={selOpeningStart.y} r={7 * px} fill="none"
            stroke={T.selected} strokeWidth={2 * px} strokeDasharray={`${3 * px} ${2 * px}`} pointerEvents="none" />
        )}

        {/* Network devices */}
        {plan.devices.map((dev) => (
          <g key={dev.id}>
            <DeviceGlyph device={dev} px={px} theme={T} selected={isSel('device', dev.id)} />
            {tool === 'select' && (
              <circle cx={dev.x} cy={dev.y} r={12 * px} fill="transparent" className="cursor-move"
                onPointerDown={(e) => startElementDrag(e, 'device', dev.id)} />
            )}
          </g>
        ))}
        {tool === 'survey' && survey && <SurveyMarkers survey={survey} px={px} onPointerDown={pickSurveyMarker} />}

        {tool === 'device' && cursor?.device && (
          <g opacity={0.6}><DeviceGlyph device={cursor.device} px={px} theme={T} showLabel={false} /></g>
        )}

        {/* Wall drawing preview */}
        {tool === 'wall' && drawStart && snap && (
          <g pointerEvents="none">
            <line x1={drawStart.x} y1={drawStart.y} x2={snap.x} y2={snap.y}
              stroke={T.selected} strokeOpacity={0.6} strokeWidth={previewThickness} strokeLinecap="square" />
            <DimLabel a={drawStart} b={snap} px={px} offset={previewThickness / 2 + 9 * px} theme={T}
              text={fmtLen(dist(drawStart, snap))} color={T.selected} />
          </g>
        )}
        {tool === 'wall' && snap && (
          <g pointerEvents="none">
            {snap.nodeId ? (
              <circle cx={snap.x} cy={snap.y} r={7 * px} fill="none" stroke={T.selected} strokeWidth={2 * px} />
            ) : snap.wallId ? (
              <rect x={snap.x - 5 * px} y={snap.y - 5 * px} width={10 * px} height={10 * px}
                transform={`rotate(45 ${snap.x} ${snap.y})`} fill="none" stroke={T.selected} strokeWidth={2 * px} />
            ) : (
              <circle cx={snap.x} cy={snap.y} r={3 * px} fill={T.selected} />
            )}
          </g>
        )}
      </svg>

      {/* Compass */}
      <svg className="absolute top-3 left-3 pointer-events-none" width={64} height={72} viewBox="-32 -40 64 72">
        <NorthArrowGlyph north={north} size={44} bg="rgba(15,23,42,0.85)" />
      </svg>

      {/* Wall material legend */}
      {wifiLayer && plan.walls.length > 0 && (
        <div className="absolute bottom-12 right-3 px-3 py-2 rounded-lg bg-slate-900/90 border border-slate-700 text-xs space-y-1 pointer-events-none">
          {[...new Set(plan.walls.map(wallMaterial))].map((m) => (
            <div key={m} className="flex items-center gap-2 text-slate-300">
              <span className="inline-block w-4 h-1.5 rounded-sm" style={{ background: WALL_MATERIALS[m]?.color }} />
              {WALL_MATERIALS[m]?.label ?? m}
            </div>
          ))}
          {Object.entries(DEVICE_TYPES).filter(([t]) => plan.devices.some((d) => d.type === t)).map(([t, { label }]) => (
            <div key={t} className="flex items-center gap-2 text-slate-300">
              <svg width={16} height={16} viewBox="-10 -10 20 20"><DeviceGlyph device={{ type: t, x: 0, y: 0 }} px={0.9} theme={T} showLabel={false} /></svg>
              {label}
            </div>
          ))}
        </div>
      )}

      {/* Zoom controls */}
      <div className="absolute top-3 right-3 flex flex-col gap-1">
        {[
          { icon: ZoomIn, label: 'Zoom in', onClick: () => zoomBy(1.25) },
          { icon: ZoomOut, label: 'Zoom out', onClick: () => zoomBy(0.8) },
          { icon: Maximize, label: 'Fit to view', onClick: fit },
        ].map(({ icon: Icon, label, onClick }) => (
          <button key={label} title={label} onClick={onClick}
            className="p-2 rounded-lg bg-slate-900/90 border border-slate-700 text-slate-300 hover:text-white hover:bg-slate-800">
            <Icon size={16} />
          </button>
        ))}
      </div>

      {/* Contextual hint */}
      <div className={`absolute bottom-3 left-3 right-3 sm:right-auto px-3 py-1.5 rounded-lg text-xs border pointer-events-none
        ${message ? 'bg-amber-950/90 border-amber-800/60 text-amber-200' : 'bg-slate-900/90 border-slate-700 text-slate-400'}`}>
        {hint}
      </div>
    </div>
  )
}
