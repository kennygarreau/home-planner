// Floor plan geometry. All coordinates and lengths are in inches.
// Plan shape:
//   nodes:    [{ id, x, y }]
//   walls:    [{ id, a, b, thickness, exterior }]
//   rooms:    [{ id, name, nodeIds }]
//   openings: [{ id, wallId, type: 'door'|'window'|'passage', offset, width, height, side?, hinge? }]
//             offset = distance from wall.a to the opening's centre; side = ±1 swing side; hinge = 'a'|'b'
//   devices:  [{ id, type: 'ethernet'|'candidate'|'ap', x, y, label, mount, existing?, cableFeasible?, model? }]
//   floorStructure: construction of the floor beneath this level (Wi-Fi attenuation between floors)
// Walls also carry `material`, rooms carry `priority` and `uses` — all consumed by the Wi-Fi survey.

export const GRID = 6
export const WALL_DEFAULTS = {
  exterior: { exterior: true, thickness: 6, material: 'exterior_frame' },
  interior: { exterior: false, thickness: 4.5, material: 'drywall' },
}

// Keys must match wifi_survey/config/materials.yaml.
export const WALL_MATERIALS = {
  drywall: { label: 'Drywall on studs', color: '#94a3b8' },
  exterior_frame: { label: 'Wood-frame exterior', color: '#e2e8f0' },
  plaster_lath: { label: 'Plaster & lath', color: '#f472b6' },
  brick: { label: 'Brick', color: '#f97316' },
  concrete: { label: 'Concrete / block', color: '#a78bfa' },
  wood: { label: 'Solid wood', color: '#ca8a04' },
  glass: { label: 'Glass', color: '#38bdf8' },
  metal: { label: 'Metal', color: '#ef4444' },
}
export const wallMaterial = (w) => w.material ?? (w.exterior ? 'exterior_frame' : 'drywall')

export const FLOOR_STRUCTURES = {
  wood_joist: 'Wood joists + subfloor',
  concrete_slab: 'Concrete slab',
}

export const DEVICE_TYPES = {
  ethernet: { label: 'Ethernet drop', prefix: 'E' },
  candidate: { label: 'Candidate AP site', prefix: 'C' },
  ap: { label: 'Existing router / AP', prefix: 'AP' },
}
export const MOUNTS = { ceiling: 'Ceiling', wall: 'Wall', desk: 'Desk / shelf', floor: 'Floor' }

export const ROOM_PRIORITIES = { high: 'High', normal: 'Normal', low: 'Low' }
export const ROOM_USES = {
  video_calls: 'Video calls',
  office: 'Work / office',
  streaming: 'Streaming',
  gaming: 'Gaming',
  smart_home: 'Smart home',
  general: 'General browsing',
}

// Next free label like "C3" for a device type.
export function nextDeviceLabel(plan, type) {
  const prefix = DEVICE_TYPES[type].prefix
  const used = new Set((plan.devices ?? []).map((d) => d.label))
  let i = 1
  while (used.has(`${prefix}${i}`)) i++
  return `${prefix}${i}`
}

export function newDevice(plan, type, x, y) {
  const d = { id: uid(), type, x, y, label: nextDeviceLabel(plan, type), mount: type === 'ethernet' ? 'wall' : 'ceiling' }
  if (type === 'ethernet') d.existing = true
  if (type === 'candidate') d.cableFeasible = true
  if (type === 'ap') { d.model = ''; d.mount = 'desk' }
  return d
}
export const OPENING_DEFAULTS = {
  door: { width: 36, height: 80 },
  window: { width: 36, height: 48 },
  passage: { width: 36, height: 80 },
}
export const OPENING_LABELS = { door: 'Door', window: 'Window', passage: 'Open passage' }

// crypto.randomUUID is unavailable over plain http on a LAN, so roll our own.
export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

export const emptyPlan = () => ({ nodes: [], walls: [], rooms: [], openings: [], devices: [], floorStructure: 'wood_joist' })
export const normalizePlan = (d) => ({
  nodes: d?.nodes ?? [],
  walls: d?.walls ?? [],
  rooms: d?.rooms ?? [],
  openings: d?.openings ?? [],
  devices: d?.devices ?? [],
  floorStructure: d?.floorStructure ?? 'wood_joist',
})
export const clonePlan = (p) => JSON.parse(JSON.stringify(p))

const clean = (v) => Math.round(v * 100) / 100
export const roundTo = (v, step) => Math.round(v / step) * step
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
export const nodeMap = (plan) => Object.fromEntries(plan.nodes.map((n) => [n.id, n]))

export function projectOnSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return { x: a.x, y: a.y, t: 0, d: dist(p, a) }
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  const x = a.x + t * dx, y = a.y + t * dy
  return { x, y, t, d: Math.hypot(p.x - x, p.y - y) }
}

// ── Measurements ────────────────────────────────────────────────────────────

export function wallLength(wall, nm) {
  const a = nm[wall.a], b = nm[wall.b]
  return a && b ? dist(a, b) : 0
}

export const roomPoints = (room, nm) => room.nodeIds.map((id) => nm[id]).filter(Boolean)

export function polygonArea(pts) {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length]
    s += p.x * q.y - q.x * p.y
  }
  return Math.abs(s) / 2
}

export function polygonPerimeter(pts) {
  let s = 0
  for (let i = 0; i < pts.length; i++) s += dist(pts[i], pts[(i + 1) % pts.length])
  return s
}

export function polygonCentroid(pts) {
  let a = 0, cx = 0, cy = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length]
    const f = p.x * q.y - q.x * p.y
    a += f
    cx += (p.x + q.x) * f
    cy += (p.y + q.y) * f
  }
  if (Math.abs(a) < 1e-6) {
    return { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length }
  }
  return { x: cx / (3 * a), y: cy / (3 * a) }
}

export const sqft = (sqIn) => sqIn / 144

export function planStats(plan, ceilingHtFt) {
  const nm = nodeMap(plan)
  const roomArea = plan.rooms.reduce((s, r) => s + sqft(polygonArea(roomPoints(r, nm))), 0)
  const extLen = plan.walls.filter((w) => w.exterior).reduce((s, w) => s + wallLength(w, nm), 0)
  const intLen = plan.walls.filter((w) => !w.exterior).reduce((s, w) => s + wallLength(w, nm), 0)
  return {
    roomArea,
    extLen,
    intLen,
    extWallArea: sqft(extLen * ceilingHtFt * 12),
  }
}

export function planBounds(plans) {
  const pts = plans.flatMap((p) => [...(p?.nodes ?? []), ...(p?.devices ?? [])])
  if (!pts.length) return null
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) }
}

// ── Snapping ────────────────────────────────────────────────────────────────

// Returns { x, y, nodeId? , wallId? }. Priority: existing node → point on a wall
// → 45° angle + grid length from `from` → plain grid.
export function snapPoint(plan, p, { from = null, tol, grid = GRID, free = false, nodesOnly = false }) {
  if (free) return { x: clean(p.x), y: clean(p.y) }

  let best = null
  for (const n of plan.nodes) {
    const d = dist(p, n)
    if (d <= tol && (!best || d < best.d)) best = { d, x: n.x, y: n.y, nodeId: n.id }
  }
  if (best || nodesOnly) return best

  const nm = nodeMap(plan)
  for (const w of plan.walls) {
    const a = nm[w.a], b = nm[w.b]
    if (!a || !b) continue
    const pr = projectOnSegment(p, a, b)
    if (pr.d <= tol && pr.t > 0 && pr.t < 1 && (!best || pr.d < best.d)) {
      best = { d: pr.d, x: clean(pr.x), y: clean(pr.y), wallId: w.id }
    }
  }
  if (best) return best

  if (from) {
    const len = roundTo(dist(p, from), grid)
    const ang = roundTo(Math.atan2(p.y - from.y, p.x - from.x), Math.PI / 4)
    return { x: clean(from.x + len * Math.cos(ang)), y: clean(from.y + len * Math.sin(ang)) }
  }
  return { x: roundTo(p.x, grid), y: roundTo(p.y, grid) }
}

// ── Room detection ──────────────────────────────────────────────────────────

function pointInPolygon(p, pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

// Remove dead-end spurs (… a, b, a …) from a traced face.
function stripSpurs(ids) {
  let out = ids.slice(), changed = true
  while (changed && out.length >= 3) {
    changed = false
    for (let i = 0; i < out.length; i++) {
      const prev = out[(i - 1 + out.length) % out.length], next = out[(i + 1) % out.length]
      if (prev === next) {
        out.splice(i, 1)
        out.splice(i % out.length, 1)
        changed = true
        break
      }
    }
  }
  return out
}

// Trace every face of the wall graph (half-edge walk, turning consistently at
// each node). Each bounded region appears once, and each connected component's
// outer boundary appears once more — so the sum of all face areas is exactly
// twice the enclosed footprint. Returns [{ ids, pts, area }].
function traceFaces(plan) {
  const nm = nodeMap(plan)
  const adj = {}
  for (const w of plan.walls) {
    const a = nm[w.a], b = nm[w.b]
    if (!a || !b || w.a === w.b) continue
    ;(adj[w.a] ||= []).push({ to: w.b, ang: Math.atan2(b.y - a.y, b.x - a.x) })
    ;(adj[w.b] ||= []).push({ to: w.a, ang: Math.atan2(a.y - b.y, a.x - b.x) })
  }
  for (const k in adj) adj[k].sort((p, q) => p.ang - q.ang)

  const visited = new Set()
  const faces = []
  for (const start in adj) {
    for (const edge of adj[start]) {
      if (visited.has(`${start}>${edge.to}`)) continue
      const face = []
      let a = start, b = edge.to, guard = 0
      while (!visited.has(`${a}>${b}`) && guard++ < 10000) {
        visited.add(`${a}>${b}`)
        face.push(a)
        const list = adj[b]
        const i = list.findIndex((x) => x.to === a)
        const next = list[(i - 1 + list.length) % list.length]
        a = b
        b = next.to
      }
      const ids = stripSpurs(face)
      if (ids.length < 3) continue
      const pts = ids.map((id) => nm[id])
      const area = polygonArea(pts)
      if (area > 0) faces.push({ ids, pts, area })
    }
  }
  return faces
}

// Find the smallest closed area of the wall graph that contains `pt`.
// Returns an array of node ids, or null if the point isn't enclosed.
export function findEnclosedArea(plan, pt, faces = traceFaces(plan)) {
  let best = null
  for (const f of faces) {
    if ((!best || f.area < best.area) && pointInPolygon(pt, f.pts)) best = f
  }
  return best?.ids ?? null
}

// Total area enclosed by walls (sq in), measured to wall centrelines.
export const enclosedFootprint = (plan) => traceFaces(plan).reduce((s, f) => s + f.area, 0) / 2

// ── Openings ────────────────────────────────────────────────────────────────

// Resolve an opening to concrete geometry on its wall, clamped to fit.
export function openingSpan(opening, nm, wallsById) {
  const wall = wallsById[opening.wallId]
  const a = nm[wall?.a], b = nm[wall?.b]
  if (!a || !b) return null
  const len = dist(a, b)
  if (len < 1) return null
  const width = Math.min(opening.width, len)
  const offset = Math.max(width / 2, Math.min(len - width / 2, opening.offset))
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
  const n = { x: -u.y, y: u.x }
  const c = { x: a.x + u.x * offset, y: a.y + u.y * offset }
  return {
    wall, len, width, offset, u, n, c,
    p1: { x: c.x - (u.x * width) / 2, y: c.y - (u.y * width) / 2 },
    p2: { x: c.x + (u.x * width) / 2, y: c.y + (u.y * width) / 2 },
  }
}

// Does an opening of `width` centred at `offset` fit on the wall without overlapping others?
export function openingFits(plan, wallId, offset, width, ignoreId = null) {
  const nm = nodeMap(plan)
  const wall = plan.walls.find((w) => w.id === wallId)
  if (!wall) return false
  const len = wallLength(wall, nm)
  if (width > len || offset < width / 2 - 0.01 || offset > len - width / 2 + 0.01) return false
  return !plan.openings.some(
    (o) => o.wallId === wallId && o.id !== ignoreId && Math.abs(o.offset - offset) < (o.width + width) / 2 - 0.01,
  )
}

// Unit normal pointing from a wall towards the outside of the building.
// Probes just off each face: the side that lands inside an enclosed area is
// the inside. Falls back to "away from the plan's centre" when ambiguous.
export function outwardNormal(plan, wall, nm, faces = traceFaces(plan)) {
  const a = nm[wall.a], b = nm[wall.b]
  const len = dist(a, b)
  const n = { x: -(b.y - a.y) / len, y: (b.x - a.x) / len }
  const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
  const off = (wall.thickness || 6) / 2 + 6
  const inPos = !!findEnclosedArea(plan, { x: m.x + n.x * off, y: m.y + n.y * off }, faces)
  const inNeg = !!findEnclosedArea(plan, { x: m.x - n.x * off, y: m.y - n.y * off }, faces)
  if (inPos !== inNeg) return inPos ? { x: -n.x, y: -n.y } : n
  const cx = plan.nodes.reduce((s, p) => s + p.x, 0) / plan.nodes.length
  const cy = plan.nodes.reduce((s, p) => s + p.y, 0) / plan.nodes.length
  return (m.x - cx) * n.x + (m.y - cy) * n.y >= 0 ? n : { x: -n.x, y: -n.y }
}

// Compass direction a normal faces. northDeg = where true north points on the
// plan, measured clockwise from the top of the screen.
export function compassFacing(n, northDeg = 0) {
  const bearing = (Math.atan2(n.x, -n.y) * 180) / Math.PI
  const rel = (((bearing - northDeg) % 360) + 360) % 360
  return ['N', 'E', 'S', 'W'][Math.round(rel / 90) % 4]
}

export const FACING_NAMES = { N: 'North', E: 'East', S: 'South', W: 'West' }

// Envelope takeoff for one floor, in square feet — the numbers Manual J needs.
// Only openings in exterior walls count toward window/door/wall areas.
export function envelopeTakeoff(plan, ceilingHtFt, northDeg = 0) {
  const nm = nodeMap(plan)
  const wallsById = Object.fromEntries(plan.walls.map((w) => [w.id, w]))
  const faces = traceFaces(plan)
  const footprint = faces.reduce((s, f) => s + f.area, 0) / 2
  const extLen = plan.walls.filter((w) => w.exterior).reduce((s, w) => s + wallLength(w, nm), 0)
  const windows = { N: 0, E: 0, S: 0, W: 0 }
  let doorArea = 0, openingArea = 0, windowCount = 0, doorCount = 0
  const facingByWall = {}
  for (const o of plan.openings) {
    const wall = wallsById[o.wallId]
    if (!wall?.exterior) continue
    const span = openingSpan(o, nm, wallsById)
    if (!span) continue
    const area = sqft(span.width * (o.height || 0))
    openingArea += area
    if (o.type === 'window') {
      facingByWall[wall.id] ??= compassFacing(outwardNormal(plan, wall, nm, faces), northDeg)
      windows[facingByWall[wall.id]] += area
      windowCount++
    } else if (o.type === 'door') {
      doorArea += area
      doorCount++
    }
  }
  const grossWall = sqft(extLen * ceilingHtFt * 12)
  return {
    floorArea: sqft(footprint),
    extLen,
    grossWall,
    netWall: Math.max(0, grossWall - openingArea),
    windows,
    doorArea,
    windowCount,
    doorCount,
  }
}

const sameNodeSet = (a, b) => a.length === b.length && a.every((id) => b.includes(id))
export const findRoomByNodes = (plan, ids) => plan.rooms.find((r) => sameNodeSet(r.nodeIds, ids))

// ── Mutations (operate in place on a cloned plan) ───────────────────────────

// Insert a node on a wall, splitting it in two. The first half keeps the wall id;
// openings past the split point move to the second half.
export function splitWall(plan, wallId, pt) {
  const nm = nodeMap(plan)
  let wall = plan.walls.find((w) => w.id === wallId)
  // The wall may already have been split earlier in the same edit — find whichever half holds the point.
  if (!wall) wall = plan.walls.find((w) => nm[w.a] && nm[w.b] && projectOnSegment(pt, nm[w.a], nm[w.b]).d < 0.5)
  const node = { id: uid(), x: clean(pt.x), y: clean(pt.y) }
  plan.nodes.push(node)
  if (wall) {
    const splitAt = dist(nm[wall.a], node)
    const oldB = wall.b
    wall.b = node.id
    const second = { ...wall, id: uid(), a: node.id, b: oldB }
    plan.walls.push(second)
    for (const o of plan.openings ?? []) {
      if (o.wallId === wall.id && o.offset > splitAt) {
        o.wallId = second.id
        o.offset = clean(o.offset - splitAt)
      }
    }
  }
  return node.id
}

// Turn a snap result into a node id, creating/splitting as needed.
export function resolveAnchor(plan, s) {
  if (s.nodeId && plan.nodes.some((n) => n.id === s.nodeId)) return s.nodeId
  if (s.wallId) return splitWall(plan, s.wallId, s)
  const existing = plan.nodes.find((n) => dist(n, s) < 0.01)
  if (existing) return existing.id
  const node = { id: uid(), x: clean(s.x), y: clean(s.y) }
  plan.nodes.push(node)
  return node.id
}

export function addWall(plan, a, b, props) {
  if (a === b) return null
  if (plan.walls.some((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a))) return null
  const wall = { id: uid(), a, b, ...props }
  plan.walls.push(wall)
  return wall
}

function pruneOrphans(plan) {
  const used = new Set()
  plan.walls.forEach((w) => { used.add(w.a); used.add(w.b) })
  plan.rooms.forEach((r) => r.nodeIds.forEach((id) => used.add(id)))
  plan.nodes = plan.nodes.filter((n) => used.has(n.id))
}

export function deleteSelection(plan, sel) {
  if (!sel) return
  if (sel.type === 'wall') {
    plan.walls = plan.walls.filter((w) => w.id !== sel.id)
  } else if (sel.type === 'node') {
    plan.walls = plan.walls.filter((w) => w.a !== sel.id && w.b !== sel.id)
    plan.rooms = plan.rooms.filter((r) => !r.nodeIds.includes(sel.id))
    plan.nodes = plan.nodes.filter((n) => n.id !== sel.id)
  } else if (sel.type === 'room') {
    plan.rooms = plan.rooms.filter((r) => r.id !== sel.id)
  } else if (sel.type === 'opening') {
    plan.openings = plan.openings.filter((o) => o.id !== sel.id)
  } else if (sel.type === 'device') {
    plan.devices = plan.devices.filter((d) => d.id !== sel.id)
  }
  const wallIds = new Set(plan.walls.map((w) => w.id))
  plan.openings = (plan.openings ?? []).filter((o) => wallIds.has(o.wallId))
  pruneOrphans(plan)
}

// Keep the wall's `a` end fixed and move `b` along the wall direction.
export function setWallLength(plan, wallId, len) {
  const wall = plan.walls.find((w) => w.id === wallId)
  const nm = nodeMap(plan)
  const a = nm[wall?.a], b = nm[wall?.b]
  if (!a || !b || len <= 0) return
  const cur = dist(a, b)
  if (cur === 0) return
  b.x = clean(a.x + ((b.x - a.x) / cur) * len)
  b.y = clean(a.y + ((b.y - a.y) / cur) * len)
}

// ── Formatting ──────────────────────────────────────────────────────────────

export function fmtLen(inches) {
  const r = Math.round(inches)
  const ft = Math.floor(r / 12), inch = r % 12
  return inch ? `${ft}' ${inch}"` : `${ft}'`
}

// Accepts 12'6", 12' 6, 12', 6", 150in, or a bare number meaning feet (12.5).
export function parseLen(str) {
  const s = String(str).trim().toLowerCase()
  if (!s) return NaN
  if (s.includes("'")) {
    const [ftPart, inPart] = s.split("'")
    const ft = Number(ftPart.trim() || 0)
    const inStr = inPart.replace(/("|in)$/, '').trim()
    const inch = inStr ? Number(inStr) : 0
    return ft * 12 + inch
  }
  const inMatch = s.match(/^([\d.]+)\s*("|in)$/)
  if (inMatch) return Number(inMatch[1])
  return Number(s) * 12
}
