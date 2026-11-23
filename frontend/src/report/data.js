// Helpers for the standalone Wi-Fi report.
import { signalClass } from '../floorplan/survey'

export const BAND_LABEL = { '2.4': '2.4 GHz', 5: '5 GHz', 6: '6 GHz' }
export const pct = (v, digits = 0) => (v == null ? '—' : `${(v * 100).toFixed(digits)}%`)
export const dbm = (v) => (v == null ? '—' : `${Math.round(v)} dBm`)
export const mbps = (v) => (v == null ? '—' : `${Math.round(v)} Mbps`)
export const ftIn = (m) => {
  const inches = Math.round(m / 0.0254)
  return `${Math.floor(inches / 12)}'${inches % 12 ? ` ${inches % 12}"` : ''}`
}
export const classOf = (v) => signalClass(v)

// Same grouping as wifi_survey.model.mapping.device_key: radios of one device
// share the first five octets once the locally-administered bit is cleared.
export function deviceKey(bssid) {
  const o = bssid.toLowerCase().split(':').map((x) => parseInt(x, 16))
  o[0] &= ~0x02
  return o.slice(0, 5).map((x) => x.toString(16).padStart(2, '0')).join(':')
}

export function homeKeys(points) {
  return new Set(points.map((p) => p.record?.connected?.bssid).filter(Boolean).map(deviceKey))
}

// Every non-home network seen, strongest reading and where.
export function neighbours(points, roomName) {
  const home = homeKeys(points)
  const by = new Map()
  for (const p of points) {
    for (const e of p.record?.scan ?? []) {
      if (home.has(deviceKey(e.bssid))) continue
      const cur = by.get(e.bssid) ?? { ...e, seen: 0, max: -999 }
      cur.seen++
      if (e.signal_dbm > cur.max) Object.assign(cur, { max: e.signal_dbm, where: roomName(p) })
      by.set(e.bssid, cur)
    }
  }
  return [...by.values()].sort((a, b) => b.max - a.max)
}

// Mount heights (m) — mirror wifi_survey.model.environment.
export function mountHeight(floor, mount) {
  if (mount === 'ceiling') return Math.max(floor.ceiling_height_m - 0.15, 0.5)
  return { desk: 0.8, floor: 0.15, wall: 2.0 }[mount] ?? 0.8
}
