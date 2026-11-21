// SVG drawing primitives shared by the interactive editor and the static export.
// Everything is drawn in world units (inches); `px` is the size of one screen
// pixel in world units so strokes and text stay a constant on-screen size.

export const DARK_THEME = {
  bg: '#0a0f1a',
  exterior: '#cbd5e1',
  interior: '#94a3b8',
  window: '#7dd3fc',
  door: '#e2e8f0',
  label: '#e2e8f0',
  subLabel: '#94a3b8',
  halo: '#0a0f1a',
  selected: '#5cb35c',
  roomFill: '#5cb35c',
  font: 'ui-monospace, SFMono-Regular, Menlo, monospace',
}

export const LIGHT_THEME = {
  bg: '#ffffff',
  exterior: '#1e293b',
  interior: '#475569',
  window: '#0284c7',
  door: '#1e293b',
  label: '#0f172a',
  subLabel: '#475569',
  halo: '#ffffff',
  selected: '#2a7a2a',
  roomFill: '#e2e8f0',
  font: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
}

export function DimLabel({ a, b, offset, text, px, color, theme = DARK_THEME, minScreenLen = 30 }) {
  const dx = b.x - a.x, dy = b.y - a.y
  const len = Math.hypot(dx, dy)
  if (len / px < minScreenLen) return null // too short on screen to label
  let deg = (Math.atan2(dy, dx) * 180) / Math.PI
  if (deg > 90) deg -= 180
  if (deg < -90) deg += 180
  const nx = -dy / len, ny = dx / len
  const x = (a.x + b.x) / 2 + nx * offset
  const y = (a.y + b.y) / 2 + ny * offset
  return (
    <text
      x={x} y={y} transform={`rotate(${deg} ${x} ${y})`}
      textAnchor="middle" dominantBaseline="middle"
      fontSize={11 * px} fill={color ?? theme.label} stroke={theme.halo} strokeWidth={3 * px} paintOrder="stroke"
      fontFamily={theme.font} style={{ userSelect: 'none' }} pointerEvents="none"
    >
      {text}
    </text>
  )
}

// Door: gap + leaf + swing arc. Window: gap + wall faces + glazing line.
// Passage: gap with jambs.
export function OpeningShape({ span, opening, px, theme = DARK_THEME, selected = false, ghost = false, invalid = false }) {
  const { p1, p2, n, u, width } = span
  const t = span.wall.thickness || 4.5
  const half = t / 2
  const wallColor = span.wall.exterior ? theme.exterior : theme.interior
  const accent = invalid ? '#ef4444' : selected || ghost ? theme.selected : null
  const off = (p, k) => ({ x: p.x + n.x * k, y: p.y + n.y * k })
  const line = (a, b, props) => <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} {...props} />

  // Paint the gap with the background (square caps are extended to cover the wall's own caps slightly).
  const cover = line(
    { x: p1.x + u.x * 0.5, y: p1.y + u.y * 0.5 },
    { x: p2.x - u.x * 0.5, y: p2.y - u.y * 0.5 },
    { stroke: theme.bg, strokeWidth: t + 2 * px, strokeLinecap: 'butt' },
  )
  const jambs = (color) => (
    <>
      {line(off(p1, half), off(p1, -half), { stroke: color, strokeWidth: 1.5 * px })}
      {line(off(p2, half), off(p2, -half), { stroke: color, strokeWidth: 1.5 * px })}
    </>
  )

  if (opening.type === 'window') {
    const glass = accent ?? theme.window
    return (
      <g pointerEvents="none" opacity={ghost ? 0.8 : 1}>
        {cover}
        {line(off(p1, half), off(p2, half), { stroke: accent ?? wallColor, strokeWidth: 1.5 * px })}
        {line(off(p1, -half), off(p2, -half), { stroke: accent ?? wallColor, strokeWidth: 1.5 * px })}
        {line(p1, p2, { stroke: glass, strokeWidth: 2 * px })}
        {jambs(accent ?? wallColor)}
      </g>
    )
  }

  if (opening.type === 'door') {
    const side = opening.side === -1 ? -1 : 1
    const atA = opening.hinge !== 'b'
    const H = atA ? p1 : p2
    const E = atA ? p2 : p1
    const faceH = off(H, side * half)
    const T = { x: faceH.x + n.x * side * width, y: faceH.y + n.y * side * width }
    const faceE = off(E, side * half)
    const ux = faceE.x - faceH.x, uy = faceE.y - faceH.y
    const vx = T.x - faceH.x, vy = T.y - faceH.y
    const sweep = ux * vy - uy * vx > 0 ? 1 : 0
    const color = accent ?? theme.door
    return (
      <g pointerEvents="none" opacity={ghost ? 0.8 : 1}>
        {cover}
        {jambs(accent ?? wallColor)}
        <path d={`M ${faceE.x} ${faceE.y} A ${width} ${width} 0 0 ${sweep} ${T.x} ${T.y}`}
          fill="none" stroke={color} strokeWidth={1 * px} strokeDasharray={`${4 * px} ${3 * px}`} />
        {line(faceH, T, { stroke: color, strokeWidth: 2.5 * px, strokeLinecap: 'round' })}
      </g>
    )
  }

  // passage
  return (
    <g pointerEvents="none" opacity={ghost ? 0.8 : 1}>
      {cover}
      {jambs(accent ?? wallColor)}
      {accent && line(p1, p2, { stroke: accent, strokeWidth: 1 * px, strokeDasharray: `${4 * px} ${3 * px}` })}
    </g>
  )
}

export const DEVICE_COLORS = { ethernet: '#f59e0b', candidate: '#2dd4bf', ap: '#60a5fa' }

// Ethernet drop = square port, candidate AP site = dashed ring with "+",
// existing AP = filled disc with Wi-Fi arcs. Sized in screen pixels.
export function DeviceGlyph({ device, px, theme = DARK_THEME, selected = false, showLabel = true }) {
  const { x, y, type } = device
  const color = selected ? theme.selected : DEVICE_COLORS[type]
  const r = 9 * px
  let glyph
  if (type === 'ethernet') {
    glyph = (
      <>
        <rect x={x - r} y={y - r} width={2 * r} height={2 * r} rx={2 * px} fill={theme.bg} stroke={color} strokeWidth={2 * px} />
        <path d={`M ${x - 4 * px} ${y + 4 * px} V ${y - 2 * px} H ${x - 2 * px} V ${y - 4 * px} H ${x + 2 * px} V ${y - 2 * px} H ${x + 4 * px} V ${y + 4 * px} Z`}
          fill={color} />
      </>
    )
  } else if (type === 'candidate') {
    glyph = (
      <>
        <circle cx={x} cy={y} r={r} fill={theme.bg} fillOpacity={0.8} stroke={color} strokeWidth={2 * px}
          strokeDasharray={`${3 * px} ${2 * px}`} />
        <path d={`M ${x - 4.5 * px} ${y} H ${x + 4.5 * px} M ${x} ${y - 4.5 * px} V ${y + 4.5 * px}`}
          stroke={color} strokeWidth={2 * px} strokeLinecap="round" />
      </>
    )
  } else {
    const arc = (k) => `M ${x - k * px} ${y + 1 * px - k * 0.2 * px} A ${k * px} ${k * px} 0 0 1 ${x + k * px} ${y + 1 * px - k * 0.2 * px}`
    glyph = (
      <>
        <circle cx={x} cy={y} r={r + px} fill={color} />
        <circle cx={x} cy={y + 3 * px} r={1.5 * px} fill={theme.bg} />
        <path d={`${arc(3.5)} ${arc(6.5)}`} fill="none" stroke={theme.bg} strokeWidth={1.6 * px} strokeLinecap="round" />
      </>
    )
  }
  return (
    <g pointerEvents="none">
      {glyph}
      {showLabel && device.label && (
        <text x={x} y={y + r + 11 * px} textAnchor="middle" fontSize={10 * px} fontWeight={600} fill={color}
          stroke={theme.halo} strokeWidth={3 * px} paintOrder="stroke" fontFamily={theme.font} style={{ userSelect: 'none' }}>
          {device.label}
        </text>
      )}
    </g>
  )
}

// North arrow drawn in screen-pixel units (wrap in a transform to place it).
export function NorthArrowGlyph({ north = 0, size = 44, color = '#e2e8f0', accent = '#5cb35c', bg = 'transparent' }) {
  const r = size / 2
  return (
    <g>
      <circle cx={0} cy={0} r={r} fill={bg} stroke={color} strokeOpacity={0.4} strokeWidth={1} />
      <g transform={`rotate(${north})`}>
        <path d={`M 0 ${-r + 5} L ${r * 0.28} ${r * 0.35} L 0 ${r * 0.15} L ${-r * 0.28} ${r * 0.35} Z`} fill={accent} />
        <text x={0} y={-r - 5} textAnchor="middle" fontSize={11} fontWeight={700} fill={color}
          fontFamily="ui-sans-serif, system-ui, sans-serif">N</text>
      </g>
    </g>
  )
}
