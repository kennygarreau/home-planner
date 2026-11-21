import { renderToStaticMarkup } from 'react-dom/server'
import {
  nodeMap, roomPoints, polygonArea, polygonCentroid, sqft, planBounds, fmtLen, dist, openingSpan, enclosedFootprint,
} from './geometry'
import { LIGHT_THEME as T, DimLabel, OpeningShape, NorthArrowGlyph, DeviceGlyph } from './shapes'

const MARGIN_PX = 56
const HEADER_PX = 64
const FOOTER_PX = 48

// Pick a scale (px per inch) so the drawing comes out roughly `targetPx` on its long side.
function exportScale(bounds, targetPx) {
  const long = Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY, 120)
  return Math.max(1, Math.min(12, targetPx / long))
}

// Largest "nice" length (in feet) whose bar fits in ~160px.
function scaleBarFeet(scale) {
  const maxFt = 160 / (scale * 12)
  return [1, 2, 5, 10, 20, 25, 50, 100].filter((f) => f <= maxFt).pop() ?? 1
}

// Walls are painted interior-first so exterior walls cleanly cover the joints.
const paintOrder = (walls) => [...walls].sort((a, b) => Number(!!a.exterior) - Number(!!b.exterior))

// Plan bounds widened to include door swings, which can extend outside the walls.
function exportBounds(plan, nm, wallsById) {
  const b = planBounds([plan])
  for (const o of plan.openings) {
    if (o.type !== 'door') continue
    const s = openingSpan(o, nm, wallsById)
    if (!s) continue
    const reach = s.width + (s.wall.thickness || 0) / 2
    const side = o.side === -1 ? -1 : 1
    for (const p of [s.p1, s.p2]) {
      const x = p.x + s.n.x * side * reach, y = p.y + s.n.y * side * reach
      b.minX = Math.min(b.minX, x); b.maxX = Math.max(b.maxX, x)
      b.minY = Math.min(b.minY, y); b.maxY = Math.max(b.maxY, y)
    }
  }
  return b
}

function PlanExportSvg({ plan, floorName, north, showDims, showNetwork, scale }) {
  const nm = nodeMap(plan)
  const wallsById = Object.fromEntries(plan.walls.map((w) => [w.id, w]))
  const b = exportBounds(plan, nm, wallsById)
  const px = 1 / scale
  // World-space viewport including room for labels, header and footer.
  const pad = MARGIN_PX * px
  const x0 = b.minX - pad
  const y0 = b.minY - pad - HEADER_PX * px
  const wWorld = Math.max(b.maxX - b.minX + pad * 2, 480 * px)
  const hWorld = b.maxY - b.minY + pad * 2 + (HEADER_PX + FOOTER_PX) * px
  const widthPx = Math.ceil(wWorld * scale)
  const heightPx = Math.ceil(hWorld * scale)

  const footprint = Math.round(sqft(enclosedFootprint(plan)))
  const barFt = scaleBarFeet(scale)
  const barLen = barFt * 12
  const barX = x0 + 24 * px
  const barY = y0 + hWorld - 24 * px

  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={widthPx} height={heightPx} viewBox={`${x0} ${y0} ${wWorld} ${hWorld}`}>
      <rect x={x0} y={y0} width={wWorld} height={hWorld} fill={T.bg} />

      {/* Title block */}
      <text x={x0 + 24 * px} y={y0 + 34 * px} fontSize={20 * px} fontWeight={700} fill={T.label} fontFamily={T.font}>
        {floorName}
      </text>
      <text x={x0 + 24 * px} y={y0 + 54 * px} fontSize={12 * px} fill={T.subLabel} fontFamily={T.font}>
        {`${footprint.toLocaleString()} sq ft enclosed · exported ${new Date().toLocaleDateString()}`}
      </text>

      {plan.rooms.map((r) => {
        const pts = roomPoints(r, nm)
        if (pts.length < 3) return null
        return <polygon key={r.id} points={pts.map((p) => `${p.x},${p.y}`).join(' ')} fill={T.roomFill} fillOpacity={0.35} />
      })}

      {paintOrder(plan.walls).map((w) => {
        const a = nm[w.a], c = nm[w.b]
        if (!a || !c) return null
        return (
          <line key={w.id} x1={a.x} y1={a.y} x2={c.x} y2={c.y}
            stroke={w.exterior ? T.exterior : T.interior} strokeWidth={w.thickness} strokeLinecap="square" />
        )
      })}

      {plan.openings.map((o) => {
        const span = openingSpan(o, nm, wallsById)
        return span ? <OpeningShape key={o.id} span={span} opening={o} px={px} theme={T} /> : null
      })}

      {plan.rooms.map((r) => {
        const pts = roomPoints(r, nm)
        if (pts.length < 3) return null
        const c = polygonCentroid(pts)
        return (
          <g key={r.id}>
            <text x={c.x} y={c.y - 7 * px} textAnchor="middle" fontSize={13 * px} fontWeight={600} fill={T.label}
              fontFamily={T.font} stroke={T.halo} strokeWidth={3 * px} paintOrder="stroke">{r.name}</text>
            <text x={c.x} y={c.y + 9 * px} textAnchor="middle" fontSize={11 * px} fill={T.subLabel}
              fontFamily={T.font} stroke={T.halo} strokeWidth={3 * px} paintOrder="stroke">
              {`${Math.round(sqft(polygonArea(pts)))} sq ft`}
            </text>
          </g>
        )
      })}

      {showDims && plan.walls.map((w) => {
        const a = nm[w.a], c = nm[w.b]
        if (!a || !c) return null
        return <DimLabel key={w.id} a={a} b={c} px={px} theme={T} offset={w.thickness / 2 + 9 * px} text={fmtLen(dist(a, c))} />
      })}

      {showNetwork && plan.devices.map((d) => <DeviceGlyph key={d.id} device={d} px={px} theme={T} />)}

      {/* Scale bar */}
      <g>
        <line x1={barX} y1={barY} x2={barX + barLen} y2={barY} stroke={T.label} strokeWidth={2 * px} />
        <line x1={barX} y1={barY - 5 * px} x2={barX} y2={barY + 5 * px} stroke={T.label} strokeWidth={2 * px} />
        <line x1={barX + barLen} y1={barY - 5 * px} x2={barX + barLen} y2={barY + 5 * px} stroke={T.label} strokeWidth={2 * px} />
        <text x={barX + barLen + 8 * px} y={barY} dominantBaseline="middle" fontSize={11 * px} fill={T.label} fontFamily={T.font}>
          {`${barFt} ft`}
        </text>
      </g>

      {/* North arrow (glyph is drawn in px units, so scale it into world units) */}
      <g transform={`translate(${x0 + wWorld - 40 * px} ${y0 + 44 * px}) scale(${px})`}>
        <NorthArrowGlyph north={north} size={40} color={T.label} accent={T.label} bg={T.bg} />
      </g>
    </svg>
  )
}

export function planToSvg(plan, opts, targetPx = 2000) {
  if (!plan.nodes.length) return null
  const nm = nodeMap(plan)
  const bounds = exportBounds(plan, nm, Object.fromEntries(plan.walls.map((w) => [w.id, w])))
  const scale = exportScale(bounds, targetPx)
  return '<?xml version="1.0" encoding="UTF-8"?>\n' + renderToStaticMarkup(<PlanExportSvg plan={plan} scale={scale} {...opts} />)
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'floor-plan'

export function downloadSvg(plan, opts) {
  const svg = planToSvg(plan, opts)
  if (!svg) return false
  download(new Blob([svg], { type: 'image/svg+xml' }), `${slug(opts.floorName)}.svg`)
  return true
}

export async function downloadPng(plan, opts) {
  const svg = planToSvg(plan, opts, 2400)
  if (!svg) return false
  const img = new Image()
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await img.decode()
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth
  canvas.height = img.naturalHeight
  canvas.getContext('2d').drawImage(img, 0, 0)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
  download(blob, `${slug(opts.floorName)}.png`)
  return true
}
