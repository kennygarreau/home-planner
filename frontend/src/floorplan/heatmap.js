// Render an analysis grid (metres, row-major ny × nx) to a PNG data URL,
// coloured with the survey's signal classes.
import { signalClass } from './survey'

export const IN_PER_M = 1 / 0.0254

const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))

export function heatmapImage(grid, band, alpha = 150) {
  const values = grid?.bands?.[band]
  if (!values) return null
  const { nx, ny } = grid
  const canvas = document.createElement('canvas')
  canvas.width = nx
  canvas.height = ny
  const ctx = canvas.getContext('2d')
  const img = ctx.createImageData(nx, ny)
  const cache = {}
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (v == null) continue
    const cls = signalClass(v)
    const rgb = (cache[cls.key] ??= hexToRgb(cls.color))
    img.data.set([rgb[0], rgb[1], rgb[2], alpha], i * 4)
  }
  ctx.putImageData(img, 0, 0)
  return {
    href: canvas.toDataURL('image/png'),
    x: grid.x0 * IN_PER_M,
    y: grid.y0 * IN_PER_M,
    width: nx * grid.step * IN_PER_M,
    height: ny * grid.step * IN_PER_M,
  }
}

// Signal at a world point (inches) from a grid, or null.
export function heatmapValueAt(grid, band, pt) {
  const values = grid?.bands?.[band]
  if (!values) return null
  const col = Math.floor((pt.x / IN_PER_M - grid.x0) / grid.step)
  const row = Math.floor((pt.y / IN_PER_M - grid.y0) / grid.step)
  if (col < 0 || row < 0 || col >= grid.nx || row >= grid.ny) return null
  return values[row * grid.nx + col]
}
