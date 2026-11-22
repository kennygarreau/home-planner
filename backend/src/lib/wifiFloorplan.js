// Adapter: FloorPlan rows (inches, node/wall graph) → wifi_survey floorplan.json
// (schema_version 1, metres). See docs/wifi-survey-plan.md §2.1.
//
// Coordinate frame: same as the editor — x to the right, y DOWN (screen), origin
// at the editor's origin. `coordinate_frame.north_deg` gives where true north
// points, clockwise from the top of the plan (−y).
//
// Additions beyond the spec's example schema (all optional for consumers):
//   floors[].level, rooms[].area_m2, walls[].exterior, openings[].id/height_m/material,
//   devices' label, floors[].existing_aps, top-level warnings[],
//   floors[].ap_placement ("anywhere" | "candidates" | "none") and rooms[].ap_allowed:
//   with "anywhere" the planner generates its own ceiling grid over rooms where
//   ap_allowed is true; candidate_ap_sites then only add preferred spots.
// openings[].offset_m is the distance from wall.a to the opening's NEAR edge.

const SCHEMA_VERSION = 1
const M_PER_IN = 0.0254
const FLOOR_ASSEMBLY_M = 0.3 // assumed thickness of the floor structure between levels
const OPENING_MATERIAL = { door: 'wood_door', window: 'glass', passage: null }
const DEFAULT_FLOOR_STRUCTURE = 'wood_joist'

const m = (inches) => Math.round(inches * M_PER_IN * 1000) / 1000
const pt = (p) => [m(p.x), m(p.y)]
const wallMaterial = (w) => w.material || (w.exterior ? 'exterior_frame' : 'drywall')
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)

function polygonArea(pts) {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length]
    s += x1 * y2 - x2 * y1
  }
  return Math.abs(s) / 2
}

// Elevation of each level's floor surface, with level 0 (or the lowest
// above-ground level) at 0 m. Floors sharing a level share an elevation.
function levelElevations(floors) {
  const levels = [...new Set(floors.map((f) => f.level))].sort((a, b) => a - b)
  const height = (lvl) => Math.max(...floors.filter((f) => f.level === lvl).map((f) => f.ceilingHt)) * 12 * M_PER_IN
  const base = levels.includes(0) ? 0 : levels.find((l) => l >= 0) ?? levels[levels.length - 1]
  const elev = { [base]: 0 }
  const bi = levels.indexOf(base)
  for (let i = bi + 1; i < levels.length; i++) elev[levels[i]] = elev[levels[i - 1]] + height(levels[i - 1]) + FLOOR_ASSEMBLY_M
  for (let i = bi - 1; i >= 0; i--) elev[levels[i]] = elev[levels[i + 1]] - height(levels[i]) - FLOOR_ASSEMBLY_M
  for (const k in elev) elev[k] = Math.round(elev[k] * 1000) / 1000
  return elev
}

function convertFloor(floor, ctx) {
  const d = floor.data || {}
  const nodes = Object.fromEntries((d.nodes || []).map((n) => [n.id, n]))
  const walls = (d.walls || []).filter((w) => nodes[w.a] && nodes[w.b])
  const wallsById = Object.fromEntries(walls.map((w) => [w.id, w]))
  const where = `floor "${floor.name}"`

  const rooms = []
  for (const r of d.rooms || []) {
    const poly = (r.nodeIds || []).map((id) => nodes[id]).filter(Boolean).map(pt)
    if (poly.length < 3) {
      ctx.warnings.push(`${where}: room "${r.name}" has fewer than 3 valid corners — skipped`)
      continue
    }
    rooms.push({
      id: r.id,
      name: r.name,
      polygon: poly,
      area_m2: Math.round(polygonArea(poly) * 100) / 100,
      priority: r.priority || 'normal',
      use: r.uses || [],
      ap_allowed: !r.noAp,
    })
  }
  if (!rooms.length) ctx.warnings.push(`${where}: no rooms defined — per-room grading needs rooms`)

  const openings = []
  for (const o of d.openings || []) {
    const w = wallsById[o.wallId]
    if (!w) {
      ctx.warnings.push(`${where}: ${o.type} ${o.id} is on a missing wall — skipped`)
      continue
    }
    const len = dist(nodes[w.a], nodes[w.b])
    const width = Math.min(o.width, len)
    const centre = Math.max(width / 2, Math.min(len - width / 2, o.offset))
    openings.push({
      id: o.id,
      wall_id: o.wallId,
      type: o.type,
      offset_m: m(centre - width / 2),
      width_m: m(width),
      height_m: m(o.height || 0),
      material: OPENING_MATERIAL[o.type] ?? null,
    })
  }

  const devices = d.devices || []
  const of = (type) => devices.filter((x) => x.type === type)

  return {
    id: floor.id,
    name: floor.name,
    level: floor.level,
    elevation_m: ctx.elevations[floor.level],
    ceiling_height_m: m(floor.ceilingHt * 12),
    slab_material: ctx.slabAbove(floor.level),
    ap_placement: ['anywhere', 'candidates', 'none'].includes(d.apPlacement) ? d.apPlacement : 'anywhere',
    rooms,
    walls: walls.map((w) => ({
      id: w.id,
      a: pt(nodes[w.a]),
      b: pt(nodes[w.b]),
      material: wallMaterial(w),
      thickness_m: m(w.thickness || 4.5),
      exterior: !!w.exterior,
    })),
    openings,
    ethernet_drops: of('ethernet').map((x) => ({
      id: x.id, label: x.label, pos: pt(x), mount: x.mount || 'wall', existing: x.existing !== false,
    })),
    candidate_ap_sites: of('candidate').map((x) => ({
      id: x.id, label: x.label, pos: pt(x), mount: x.mount || 'ceiling', cable_feasible: x.cableFeasible !== false,
    })),
    existing_aps: of('ap').map((x) => ({
      id: x.id, label: x.label, model: x.model || '', pos: pt(x), mount: x.mount || 'desk',
    })),
    obstacles: [],
  }
}

function toWifiFloorplan(floorRows) {
  const floors = [...floorRows].sort((a, b) => a.level - b.level)
  const levels = [...new Set(floors.map((f) => f.level))].sort((a, b) => a - b)
  const ctx = {
    warnings: [],
    elevations: floors.length ? levelElevations(floors) : {},
    // Spec: slab_material = attenuation to the floor ABOVE, i.e. the structure
    // beneath the next level up. The editor stores it on the upper floor.
    slabAbove(level) {
      const above = levels.find((l) => l > level)
      if (above === undefined) return null
      const upper = floors.find((f) => f.level === above)
      return upper?.data?.floorStructure || DEFAULT_FLOOR_STRUCTURE
    },
  }
  if (!floors.length) ctx.warnings.push('No floors drawn yet')
  const converted = floors.map((f) => convertFloor(f, ctx))
  const north = floors[0]?.north ?? 0
  const placeable = converted.some((f) =>
    (f.ap_placement === 'anywhere' && f.rooms.some((r) => r.ap_allowed)) ||
    (f.ap_placement === 'candidates' && f.candidate_ap_sites.length))
  if (converted.length && !placeable) {
    ctx.warnings.push('No floor allows new APs: set a floor to "Anywhere" or mark candidate AP sites')
  }
  for (const f of converted) {
    if (f.ap_placement === 'candidates' && !f.candidate_ap_sites.length) {
      ctx.warnings.push(`floor "${f.name}": AP placement is "candidate sites only" but none are marked`)
    }
  }
  return {
    schema_version: SCHEMA_VERSION,
    units: 'm',
    source: 'home-planner',
    generated_at: new Date().toISOString(),
    coordinate_frame: { x: 'right', y: 'down', north_deg: north },
    floors: converted,
    warnings: ctx.warnings,
  }
}

module.exports = { toWifiFloorplan, SCHEMA_VERSION }
