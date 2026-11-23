import { useMemo } from 'react'
import FloorPlanCanvas from '../components/FloorPlanCanvas'
import { normalizePlan } from '../floorplan/geometry'
import { heatmapImage, heatmapValueAt } from '../floorplan/heatmap'

const noop = () => {}

// Read-only floor view: the editor's own canvas in survey mode.
export default function Floor2D({ floor, grid, band, points, plannedAps, selectedId, onPick, title, height = 420 }) {
  const plan = useMemo(() => normalizePlan(floor.data), [floor])
  const heatmap = useMemo(() => {
    const image = grid ? heatmapImage(grid, band) : null
    return image ? { image, valueAt: (pt) => heatmapValueAt(grid, band, pt) } : null
  }, [grid, band])
  return (
    <div className="rounded-xl overflow-hidden border border-slate-700 bg-slate-950">
      <div className="px-3 py-1.5 text-xs font-medium text-slate-300 bg-slate-900 border-b border-slate-800">{title}</div>
      <div style={{ height }}>
        <FloorPlanCanvas
          plan={plan} ghost={null} tool="survey" wallType="interior" deviceType="ethernet" wifiLayer={false}
          selection={null} onSelect={noop} showDims={false} fitKey={`${floor.id}-${title}`} north={floor.north ?? 0}
          survey={{ suggestions: [], points, selectedId, onPick: (t) => t.kind === 'point' && onPick?.(t.point) }}
          heatmap={heatmap} plannedAps={plannedAps}
          hintText={grid ? 'Hover for signal · click a survey spot for its readings · scroll to zoom, drag to pan' : 'No heatmap for this band'}
          onCommit={noop} onBeginTransient={noop} onTransient={noop} onTransientEnd={noop}
        />
      </div>
    </div>
  )
}
