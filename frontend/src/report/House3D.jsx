import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { heatmapCanvas } from '../floorplan/heatmap'
import { classOf, mountHeight } from './data'

// 3-D house: floors stacked at their real elevations (metres; plan x → X,
// plan y → Z, height → Y), rooms textured with the selected heatmap, walls
// extruded to the ceiling with door/window openings, AP and survey markers.

const WALL_EXT = new THREE.MeshStandardMaterial({ color: 0x64748b, transparent: true, opacity: 0.55, depthWrite: false })
const WALL_INT = new THREE.MeshStandardMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.28, depthWrite: false })
const FLOOR_PLAIN = new THREE.MeshStandardMaterial({ color: 0x334155, side: THREE.DoubleSide })
const SILL_M = 0.9
const DOOR_M = 2.03

function label(text, color = '#e2e8f0', scale = 1) {
  const c = document.createElement('canvas')
  const ctx = c.getContext('2d')
  ctx.font = '600 40px system-ui, sans-serif'
  c.width = Math.ceil(ctx.measureText(text).width) + 24
  c.height = 60
  ctx.font = '600 40px system-ui, sans-serif'
  ctx.fillStyle = 'rgba(15,23,42,0.75)'
  ctx.fillRect(0, 0, c.width, c.height)
  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.fillText(text, 12, 31)
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }))
  s.scale.set((c.width / c.height) * 0.8 * scale, 0.8 * scale, 1)
  s.renderOrder = 10
  return s
}

function wallSegments(floor, wall) {
  const [ax, ay] = wall.a
  const [bx, by] = wall.b
  const len = Math.hypot(bx - ax, by - ay)
  const h = floor.ceiling_height_m
  const ops = floor.openings.filter((o) => o.wall_id === wall.id).sort((p, q) => p.offset_m - q.offset_m)
  const segs = [] // [t0, t1, y0, y1] along the wall / height
  let cur = 0
  for (const o of ops) {
    const t0 = Math.max(cur, o.offset_m)
    const t1 = Math.min(len, o.offset_m + o.width_m)
    if (t0 > cur) segs.push([cur, t0, 0, h])
    if (o.type === 'window') {
      const top = Math.min(h, SILL_M + (o.height_m || 1.2))
      segs.push([t0, t1, 0, SILL_M], [t0, t1, top, h])
    } else {
      const top = Math.min(h, o.height_m || DOOR_M)
      segs.push([t0, t1, top, h])
    }
    cur = Math.max(cur, t1)
  }
  if (cur < len) segs.push([cur, len, 0, h])
  return { len, ux: (bx - ax) / len, uy: (by - ay) / len, segs }
}

function dispose(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose?.()
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : []
    for (const m of mats) {
      if (m === WALL_EXT || m === WALL_INT || m === FLOOR_PLAIN) continue
      m.map?.dispose?.()
      m.dispose?.()
    }
  })
}

export default function House3D({ floors, gridFor, band, existingAps, plannedAps, points, explode, showWalls, showPoints, height = 520 }) {
  const mountRef = useRef(null)
  const three = useRef(null)

  // Renderer, camera, controls: once.
  useEffect(() => {
    const el = mountRef.current
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setClearColor(0x0b1220)
    el.appendChild(renderer.domElement)
    const scene = new THREE.Scene()
    scene.add(new THREE.AmbientLight(0xffffff, 0.9))
    const sun = new THREE.DirectionalLight(0xffffff, 1.2)
    sun.position.set(10, 20, 8)
    scene.add(sun)
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    const content = new THREE.Group()
    scene.add(content)
    const resize = () => {
      const w = el.clientWidth
      renderer.setSize(w, height)
      camera.aspect = w / height
      camera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(el)
    resize()
    let raf
    const loop = () => {
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(loop)
    }
    loop()
    three.current = { renderer, scene, camera, controls, content, framed: false }
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      controls.dispose()
      dispose(content)
      renderer.dispose()
      el.removeChild(renderer.domElement)
    }
  }, [height])

  // House contents: whenever inputs change.
  useEffect(() => {
    const t = three.current
    if (!t) return
    dispose(t.content)
    t.content.clear()

    const all = floors.flatMap((f) => [...f.walls.flatMap((w) => [w.a, w.b]), ...f.rooms.flatMap((r) => r.polygon)])
    if (!all.length) return
    const minX = Math.min(...all.map((p) => p[0])), maxX = Math.max(...all.map((p) => p[0]))
    const minY = Math.min(...all.map((p) => p[1])), maxY = Math.max(...all.map((p) => p[1]))
    const cx = (minX + maxX) / 2, cz = (minY + maxY) / 2
    const base = Math.min(...floors.map((f) => f.elevation_m))

    floors.forEach((f, idx) => {
      const g = new THREE.Group()
      g.position.y = f.elevation_m - base + idx * explode
      t.content.add(g)

      // Rooms, textured with the heatmap.
      const grid = gridFor(f.id)
      const canvas = grid ? heatmapCanvas(grid, band, 230) : null
      let mat = FLOOR_PLAIN
      if (canvas) {
        const tex = new THREE.CanvasTexture(canvas)
        tex.colorSpace = THREE.SRGBColorSpace
        tex.magFilter = THREE.NearestFilter
        mat = new THREE.MeshBasicMaterial({ map: tex, side: THREE.DoubleSide })
      }
      for (const room of f.rooms) {
        if (room.polygon.length < 3) continue
        const shape = new THREE.Shape(room.polygon.map(([x, y]) => new THREE.Vector2(x - cx, y - cz)))
        const geo = new THREE.ShapeGeometry(shape)
        if (grid) {
          const pos = geo.attributes.position
          const uv = geo.attributes.uv
          const W = grid.nx * grid.step, H = grid.ny * grid.step
          for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i) + cx, y = pos.getY(i) + cz
            uv.setXY(i, (x - grid.x0) / W, 1 - (y - grid.y0) / H)
          }
          uv.needsUpdate = true
        }
        const mesh = new THREE.Mesh(geo, canvas ? mat : FLOOR_PLAIN.clone())
        mesh.rotation.x = Math.PI / 2
        mesh.position.y = 0.01
        g.add(mesh)
      }

      // Walls with openings.
      if (showWalls) {
        for (const w of f.walls) {
          const { ux, uy, segs } = wallSegments(f, w)
          const th = Math.max(w.thickness_m || 0.12, 0.08)
          for (const [t0, t1, y0, y1] of segs) {
            if (t1 - t0 < 0.02 || y1 - y0 < 0.02) continue
            const box = new THREE.Mesh(new THREE.BoxGeometry(t1 - t0, y1 - y0, th), w.exterior ? WALL_EXT : WALL_INT)
            const mid = (t0 + t1) / 2
            box.position.set(w.a[0] + ux * mid - cx, (y0 + y1) / 2, w.a[1] + uy * mid - cz)
            box.rotation.y = -Math.atan2(uy, ux)
            g.add(box)
          }
        }
      }

      const flabel = label(f.name, '#cbd5e1', 1.2)
      flabel.position.set(minX - cx - 0.5, 0.3, minY - cz - 0.5)
      g.add(flabel)

      // Existing APs (white) and planned APs (magenta).
      for (const ap of existingAps.filter((a) => a.floorId === f.id)) {
        const y = mountHeight(f, ap.mount)
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.16, 24),
          new THREE.MeshBasicMaterial({ color: ap.faded ? 0x64748b : 0xf8fafc, transparent: true, opacity: ap.faded ? 0.6 : 1, depthTest: false }))
        m.renderOrder = 8 // always visible, even under the floor above
        m.position.set(ap.x - cx, y, ap.y - cz)
        g.add(m)
        const l = label(ap.label, ap.faded ? '#94a3b8' : '#f8fafc', 0.8)
        l.position.set(ap.x - cx, y + 0.45, ap.y - cz)
        g.add(l)
      }
      for (const ap of plannedAps.filter((a) => a.floorId === f.id)) {
        const y = mountHeight(f, 'ceiling')
        const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.38), new THREE.MeshBasicMaterial({ color: 0xe879f9, depthTest: false, transparent: true }))
        m.renderOrder = 9 // always visible, even under the floor above
        m.position.set(ap.x - cx, y, ap.y - cz)
        g.add(m)
        const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, y, 8), new THREE.MeshBasicMaterial({ color: 0xe879f9, depthTest: false, transparent: true, opacity: 0.7 }))
        beam.renderOrder = 9
        beam.position.set(ap.x - cx, y / 2, ap.y - cz)
        g.add(beam)
        const l = label(ap.text, '#f0abfc', 0.9)
        l.position.set(ap.x - cx, y + 0.55, ap.y - cz)
        g.add(l)
      }

      // Survey spots, coloured by the signal measured there.
      if (showPoints) {
        for (const p of points.filter((q) => q.floorId === f.id)) {
          const cls = classOf(p.signal)
          const m = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12),
            new THREE.MeshStandardMaterial({ color: cls ? cls.color : '#ef4444' }))
          m.position.set(p.x - cx, 1.0, p.y - cz)
          g.add(m)
        }
      }
    })

    if (!t.framed) {
      const size = Math.max(maxX - minX, maxY - minY, 8)
      const top = Math.max(...floors.map((f) => f.elevation_m + f.ceiling_height_m)) - base
      t.camera.position.set(size * 0.85, top + size * 0.75, size * 1.05)
      t.controls.target.set(0, top / 2.5, 0)
      t.framed = true
    }
  }, [floors, gridFor, band, existingAps, plannedAps, points, explode, showWalls, showPoints])

  return <div ref={mountRef} className="w-full rounded-xl overflow-hidden" style={{ height }} />
}
