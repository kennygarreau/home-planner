// Wi-Fi survey helpers: suggested measurement spots and signal colours.
import { nodeMap, roomPoints, polygonArea, polygonCentroid, openingSpan, dist } from './geometry'

const SQIN_PER_M2 = 1550.0031

// Spec thresholds, colour-blind-safe diverging palette (blue → red).
export const SIGNAL_CLASSES = [
  { key: 'excellent', label: 'Excellent', min: -60, color: '#2c7bb6', text: '#ffffff', note: '≥ −60 dBm' },
  { key: 'good', label: 'Good', min: -67, color: '#abd9e9', text: '#0f172a', note: '−60 to −67 · calls & video' },
  { key: 'fair', label: 'Fair', min: -75, color: '#fdae61', text: '#0f172a', note: '−67 to −75' },
  { key: 'poor', label: 'Poor', min: -Infinity, color: '#d7191c', text: '#ffffff', note: '< −75 dBm' },
]

export function signalClass(dbm) {
  if (dbm == null || !Number.isFinite(dbm)) return null
  return SIGNAL_CLASSES.find((c) => dbm >= c.min)
}

// Signal to judge a point by: the connected AP's, else the strongest seen.
export function pointSignal(record) {
  if (!record) return null
  if (record.connected?.signal_dbm != null) return record.connected.signal_dbm
  return record.scan?.[0]?.signal_dbm ?? null
}

export const slug = (s) => (s || 'spot').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'spot'

function pointInPolygon(p, pts) {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

function distToEdges(p, pts) {
  let best = Infinity
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length]
    const dx = b.x - a.x, dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)))
  }
  return best
}

// Smallest room containing the point (rooms can nest when drawn oddly).
export function roomAt(plan, pt) {
  const nm = nodeMap(plan)
  let best = null
  for (const r of plan.rooms) {
    const pts = roomPoints(r, nm)
    if (pts.length < 3 || !pointInPolygon(pt, pts)) continue
    const a = polygonArea(pts)
    if (!best || a < best.area) best = { room: r, area: a }
  }
  return best?.room ?? null
}

// How many spots a room gets: 1 for small rooms (closets, baths, laundry —
// under ~8 m² / 86 sq ft), otherwise 2–4, keeping spots roughly 2–3 m apart.
export function spotsForArea(areaM2) {
  if (areaM2 < 8) return 1
  return Math.min(4, Math.max(2, Math.round(areaM2 / 9) + 1))
}

// Spread n spots evenly over the room, keeping clear of the walls: grid of
// candidates → farthest-point seeding → a few k-means passes → snap back to
// a candidate so every spot stays inside and off the walls. Deterministic.
function spotsInRoom(pts, n) {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
  let cands = []
  for (const inset of [24, 12, 0]) {
    cands = []
    for (let x = minX + 3; x < maxX; x += 6) {
      for (let y = minY + 3; y < maxY; y += 6) {
        const p = { x, y }
        if (pointInPolygon(p, pts) && distToEdges(p, pts) >= inset) cands.push(p)
      }
    }
    if (cands.length >= n) break
  }
  if (!cands.length) return [polygonCentroid(pts)]
  n = Math.min(n, cands.length)

  const c = polygonCentroid(pts)
  const nearest = (p, list) => list.reduce((b, q) => (dist(p, q) < dist(p, b) ? q : b), list[0])
  const centers = [nearest(c, cands)]
  while (centers.length < n) {
    let far = null, farD = -1
    for (const q of cands) {
      const d = Math.min(...centers.map((k) => dist(q, k)))
      if (d > farD) { farD = d; far = q }
    }
    centers.push(far)
  }
  let cur = centers.map((p) => ({ ...p }))
  for (let iter = 0; iter < 12; iter++) {
    const sums = cur.map(() => ({ x: 0, y: 0, n: 0 }))
    for (const q of cands) {
      let bi = 0
      for (let i = 1; i < cur.length; i++) if (dist(q, cur[i]) < dist(q, cur[bi])) bi = i
      sums[bi].x += q.x; sums[bi].y += q.y; sums[bi].n++
    }
    cur = cur.map((k, i) => (sums[i].n ? { x: sums[i].x / sums[i].n, y: sums[i].y / sums[i].n } : k))
  }
  return cur.map((k) => nearest(k, cands))
}

// Suggested spots for one floor: per room, plus one in each interior doorway.
export function suggestSpots(plan) {
  const nm = nodeMap(plan)
  const out = []
  const slugCount = {}
  for (const r of plan.rooms) slugCount[slug(r.name)] = (slugCount[slug(r.name)] ?? 0) + 1
  const slugSeen = {}

  for (const room of plan.rooms) {
    const pts = roomPoints(room, nm)
    if (pts.length < 3) continue
    let base = slug(room.name)
    if (slugCount[base] > 1) base = `${base}-${(slugSeen[base] = (slugSeen[base] ?? 0) + 1)}`
    const spots = spotsInRoom(pts, spotsForArea(polygonArea(pts) / SQIN_PER_M2))
      .sort((a, b) => a.y - b.y || a.x - b.x)
    spots.forEach((p, i) => out.push({
      key: `${base}-${String(i + 1).padStart(2, '0')}`,
      kind: 'room', roomId: room.id, roomName: room.name, index: i + 1,
      x: Math.round(p.x), y: Math.round(p.y),
    }))
  }

  const wallsById = Object.fromEntries(plan.walls.map((w) => [w.id, w]))
  const doors = plan.openings
    .filter((o) => (o.type === 'door' || o.type === 'passage') && !wallsById[o.wallId]?.exterior)
    .map((o) => openingSpan(o, nm, wallsById))
    .filter(Boolean)
    .sort((a, b) => a.c.y - b.c.y || a.c.x - b.c.x)
  doors.forEach((s, i) => out.push({
    key: `doorway-${String(i + 1).padStart(2, '0')}`,
    kind: 'doorway', roomId: null, roomName: 'Doorways', index: i + 1,
    x: Math.round(s.c.x), y: Math.round(s.c.y),
  }))
  return out
}

// Label for a spot the user clicked themselves: "<room>-c<n>".
export function customLabel(plan, points, floorId, pt) {
  const room = roomAt(plan, pt)
  const base = `${slug(room?.name ?? 'spot')}-c`
  const used = new Set(points.filter((p) => p.floorId === floorId).map((p) => p.label))
  let n = 1
  while (used.has(`${base}${n}`)) n++
  return { label: `${base}${n}`, roomId: room?.id ?? null }
}

export const ACTIVE_STATUSES = ['queued', 'running']
