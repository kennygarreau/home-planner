import { useCallback, useMemo, useState } from 'react'
import House3D from './House3D'
import Floor2D from './Floor2D'
import { omadaChecklist } from './checklist'
import { BAND_LABEL, pct, dbm, mbps, neighbours, classOf } from './data'
import { pointSignal, SIGNAL_CLASSES } from '../floorplan/survey'
import { WALL_MATERIALS, FLOOR_STRUCTURES } from '../floorplan/geometry'

const IN_TO_M = 0.0254
const GRADE_BG = { A: 'bg-emerald-100 text-emerald-800', B: 'bg-lime-100 text-lime-800', C: 'bg-amber-100 text-amber-800', D: 'bg-orange-100 text-orange-800', F: 'bg-red-100 text-red-800' }
const MATERIAL_LABEL = (key) => {
  const [kind, name] = key.split(':')
  if (kind === 'wall') return WALL_MATERIALS[name]?.label ?? name
  if (kind === 'slab') return `Floor: ${FLOOR_STRUCTURES[name] ?? name}`
  return { wood_door: 'Doors', glass: 'Windows' }[name] ?? name
}

function Grade({ g }) {
  if (!g) return <span className="text-slate-400">—</span>
  return <span className={`inline-flex w-6 justify-center rounded font-bold ${GRADE_BG[g]}`}>{g}</span>
}

function Section({ id, title, intro, children }) {
  return (
    <section id={id} className="space-y-4 scroll-mt-28">
      <div>
        <h2 className="text-xl font-semibold text-slate-900">{title}</h2>
        {intro && <p className="text-sm text-slate-600 mt-1 max-w-3xl">{intro}</p>}
      </div>
      {children}
    </section>
  )
}

function Table({ head, rows, dense, align = [] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table className={`w-full ${dense ? 'text-xs' : 'text-sm'}`}>
        <thead className="bg-slate-100 text-slate-600">
          <tr>{head.map((h, i) => <th key={i} className={`px-3 py-2 font-medium whitespace-nowrap ${align[i] === 'r' ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r, i) => (
            <tr key={i} className="align-top">
              {r.map((c, j) => <td key={j} className={`px-3 py-1.5 ${align[j] === 'r' ? 'text-right tabular-nums' : ''}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Kpi({ label, before, after, note }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        {before != null && <span className="text-lg text-slate-400 line-through decoration-1">{before}</span>}
        <span className="text-2xl font-semibold text-slate-900">{after}</span>
      </div>
      {note && <div className="text-xs text-slate-500 mt-1">{note}</div>}
    </div>
  )
}

function Seg({ value, options, onChange }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5">
      {options.map(([v, l, disabled]) => (
        <button key={v} disabled={disabled} onClick={() => onChange(v)}
          className={`px-3 py-1 text-sm rounded-md disabled:opacity-30 ${value === v ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>
          {l}
        </button>
      ))}
    </div>
  )
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-slate-600">
      {SIGNAL_CLASSES.map((c) => (
        <span key={c.key} className="inline-flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm" style={{ background: c.color }} />{c.label} <span className="text-slate-400">{c.note}</span>
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rotate-45" style={{ background: '#e879f9' }} />New AP</span>
      <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-white border border-slate-400" />Existing AP</span>
    </div>
  )
}

export default function ReportApp({ data }) {
  const { floors: floorRows, wifiFloorplan, survey, points, analysis, plan } = data
  const floors = useMemo(() => [...floorRows].sort((a, b) => a.level - b.level), [floorRows])
  const wifiFloors = useMemo(() => [...wifiFloorplan.floors].sort((a, b) => a.level - b.level), [wifiFloorplan])
  const roomName = useMemo(() => {
    const m = Object.fromEntries(wifiFloors.flatMap((f) => f.rooms.map((r) => [r.id, `${f.name} · ${r.name}`])))
    return (p) => m[p.roomId] ?? p.label
  }, [wifiFloors])
  const floorName = Object.fromEntries(floors.map((f) => [f.id, f.name]))

  const options = plan?.options ?? []
  const [optIdx, setOptIdx] = useState(plan?.recommended ?? 0)
  const option = options[optIdx]
  const recommended = options[plan?.recommended ?? 0]
  const [view, setView] = useState(option ? 'after' : 'before')
  const [band, setBand] = useState('5')
  const [explode, setExplode] = useState(1.5)
  const [showWalls, setShowWalls] = useState(true)
  const [showPoints, setShowPoints] = useState(true)
  const [floorId, setFloorId] = useState(floors.find((f) => f.level === 0)?.id ?? floors[0]?.id)
  const [selPoint, setSelPoint] = useState(null)

  const baselineBands = Object.keys(analysis?.bands ?? {})
  const bandAvailable = (b) => (view === 'before' ? baselineBands.includes(b) : !!option?.grids && Object.values(option.grids)[0]?.bands?.[b])
  const gridFor = useCallback((fid) => (view === 'before' ? analysis?.grids?.[fid] : option?.grids?.[fid]) ?? null, [view, analysis, option])

  const existingAps = useMemo(() => wifiFloors.flatMap((f) => f.existing_aps.map((a) => ({
    floorId: f.id, x: a.pos[0], y: a.pos[1], label: a.label, mount: a.mount, faded: view === 'after',
  }))), [wifiFloors, view])
  const plannedAps3D = useMemo(() => (view === 'after' && option ? option.aps.map((ap, i) => ({
    floorId: ap.floor_id, x: ap.pos[0], y: ap.pos[1],
    text: `New AP ${i + 1} · 5G ${ap.channels['5'].block} · 6G ch${ap.channels['6'].channel}`,
  })) : []), [view, option])
  const points3D = useMemo(() => points.map((p) => ({
    floorId: p.floorId, x: p.x * IN_TO_M, y: p.y * IN_TO_M, signal: pointSignal(p.record),
  })), [points])

  const plannedAps2D = (fid) => (option?.aps ?? []).map((ap, i) => ({ ...ap, n: i + 1 }))
    .filter((ap) => ap.floor_id === fid).map((ap) => ({ ...ap, x: ap.pos[0] / IN_TO_M, y: ap.pos[1] / IN_TO_M }))
  const floor2D = floors.find((f) => f.id === floorId)
  const floorPoints = points.filter((p) => p.floorId === floorId)

  const baseRooms = analysis?.rooms ?? []
  const passingBefore = baseRooms.filter((r) => r.pass).length
  const passingAfter = recommended ? recommended.rooms.filter((r) => ['A', 'B'].includes(r.grade)).length : null
  const excellentBefore = baseRooms.length
    ? baseRooms.reduce((s, r) => s + (r.model?.excellent ?? 0), 0) / baseRooms.length : null
  const nb = useMemo(() => neighbours(points, roomName), [points, roomName])
  const fit5 = analysis?.bands?.['5']

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="bg-slate-900 text-slate-100">
        <div className="max-w-6xl mx-auto px-6 py-8 space-y-2">
          <div className="text-xs uppercase tracking-widest text-emerald-400">Wi-Fi survey report</div>
          <h1 className="text-3xl font-semibold">{survey.name}</h1>
          <p className="text-slate-400 text-sm">
            {points.length} measurements across {floors.length} floors · surveyed {new Date(survey.createdAt).toLocaleDateString()} ·
            report generated {new Date(data.generated_at).toLocaleString()}
          </p>
          <nav className="flex flex-wrap gap-x-4 gap-y-1 pt-2 text-sm text-slate-300">
            {[['summary', 'Summary'], ['house', '3D house'], ['floors', 'Floor by floor'], ['options', 'AP options'], ['today', 'Today in detail'], ['setup', 'Omada setup'], ['appendix', 'Appendix']]
              .map(([id, l]) => <a key={id} href={`#${id}`} className="hover:text-white underline-offset-4 hover:underline">{l}</a>)}
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-12">
        <Section id="summary" title="Summary">
          {recommended ? (
            <>
              <p className="text-base max-w-3xl">
                <strong>Recommendation: {recommended.n_aps} × {plan.ap_model.name}</strong>, ceiling-mounted at{' '}
                {recommended.aps.map((a, i) => `${a.floor} · ${a.room}`).join(' and ')}. Predicted to cover
                {' '}{pct(recommended.coverage_at_target['5'])} of the house at each room's target on 5 GHz and{' '}
                {pct(recommended.coverage_at_target['6'])} on 6 GHz, with {pct(recommended.excellent['5'])} at
                “excellent” (≥ −60 dBm) on 5 GHz.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Kpi label="Rooms meeting target" before={`${passingBefore}/${baseRooms.length}`} after={`${passingAfter}/${recommended.rooms.length}`} note="Today: measured · after: predicted (5 GHz)" />
                <Kpi label="Area at excellent (5 GHz)" before={pct(excellentBefore)} after={pct(recommended.excellent['5'])} />
                <Kpi label="6 GHz coverage" before="none" after={pct(recommended.coverage_at_target['6'])} note="Predicted from the 5 GHz fit" />
                <Kpi label="Model error (5 GHz)" after={fit5 ? `${fit5.rmse_db} dB` : '—'} note={`${fit5?.n_obs ?? 0} readings · target ≤ 6 dB`} />
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-600">No AP plan in this report yet — run “New AP placement” in Survey mode before exporting.</p>
          )}
          {analysis?.warnings?.length > 0 && (
            <ul className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 list-disc pl-8">
              {[...new Set([...analysis.warnings, ...(plan?.warnings ?? [])])].map((w) => <li key={w}>{w}</li>)}
            </ul>
          )}
        </Section>

        {/* Shared controls for the 3D and 2D views */}
        <div className="sticky top-0 z-10 -mx-6 px-6 py-3 bg-slate-50/95 backdrop-blur border-b border-slate-200 flex flex-wrap items-center gap-3">
          <Seg value={view} onChange={setView} options={[['before', 'Today (measured)'], ['after', 'With new APs', !option]]} />
          {options.length > 0 && (
            <Seg value={optIdx} onChange={setOptIdx}
              options={options.map((o, i) => [i, `${o.n_aps} AP${o.n_aps > 1 ? 's' : ''}${i === plan.recommended ? ' ★' : ''}`])} />
          )}
          <Seg value={band} onChange={setBand} options={['2.4', '5', '6'].map((b) => [b, BAND_LABEL[b], !bandAvailable(b)])} />
          <Legend />
        </div>

        <Section id="house" title="3D house"
          intro="Drag to rotate, scroll to zoom, right-drag to pan. Floors are stacked at their real heights; the colour on each floor is the best signal available there.">
          <div className="flex flex-wrap items-center gap-4 text-sm">
            <label className="flex items-center gap-2">Floors apart
              <input type="range" min="0" max="5" step="0.25" value={explode} onChange={(e) => setExplode(+e.target.value)} />
            </label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={showWalls} onChange={(e) => setShowWalls(e.target.checked)} /> Walls</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={showPoints} onChange={(e) => setShowPoints(e.target.checked)} /> Survey spots</label>
            {!bandAvailable(band) && <span className="text-amber-700">No {BAND_LABEL[band]} data for this view.</span>}
          </div>
          <House3D floors={wifiFloors} gridFor={gridFor} band={band} existingAps={existingAps} plannedAps={plannedAps3D}
            points={points3D} explode={explode} showWalls={showWalls} showPoints={showPoints} />
        </Section>

        <Section id="floors" title="Floor by floor" intro="Today on the left, the selected layout on the right. Hover for the signal at any spot; click a survey spot for its readings.">
          <Seg value={floorId} onChange={(v) => { setFloorId(v); setSelPoint(null) }} options={floors.map((f) => [f.id, f.name])} />
          <div className="grid lg:grid-cols-2 gap-4">
            <Floor2D floor={floor2D} grid={analysis?.grids?.[floorId]} band={band} points={floorPoints} plannedAps={[]}
              selectedId={selPoint?.id} onPick={setSelPoint} title={`Today — ${BAND_LABEL[band]}${baselineBands.includes(band) ? '' : ' (not measured)'}`} />
            {option && (
              <Floor2D floor={floor2D} grid={option.grids?.[floorId]} band={band} points={floorPoints} plannedAps={plannedAps2D(floorId)}
                selectedId={selPoint?.id} onPick={setSelPoint} title={`${option.n_aps} new AP${option.n_aps > 1 ? 's' : ''} — ${BAND_LABEL[band]} (predicted)`} />
            )}
          </div>
          {selPoint && <PointCard p={selPoint} where={roomName(selPoint)} onClose={() => setSelPoint(null)} />}
        </Section>

        {options.length > 0 && (
          <Section id="options" title="AP options"
            intro={`Recommended = the fewest APs that cover at least 95% of the house (5 and 6 GHz weighted) at each room's target plus a safety margin for model error. Each layout is optimised separately with the calibrated model, planning at ${plan.ap_model.planning_eirp_dbm['5']} dBm EIRP (client-matched power) and a ${plan.design_margin_db} dB margin for model error. Throughput estimates assume a 2-stream Wi-Fi 6/7 client and are capped near 940 Mbps by the 1 GbE test server.`}>
            <Table align={['', 'r', 'r', 'r', 'r', 'r', 'r', 'r', '']}
              head={['Layout', '5 GHz at target', '6 GHz at target', `With ${plan.design_margin_db} dB margin (5 / 6)`, 'Excellent 5 GHz', 'Excellent 6 GHz', '2.4 GHz at target', 'Roaming overlap', 'Where']}
              rows={options.map((o, i) => [
                <button className={`font-medium text-left ${i === optIdx ? 'text-emerald-700' : 'text-slate-700 underline'}`} onClick={() => setOptIdx(i)}>
                  {o.n_aps} AP{o.n_aps > 1 ? 's' : ''}
                  {i === plan.recommended && <span className="block text-xs font-normal whitespace-nowrap text-emerald-700">★ recommended</span>}
                </button>,
                pct(o.coverage_at_target['5']), pct(o.coverage_at_target['6']),
                `${pct(o.coverage['5'])} / ${pct(o.coverage['6'])}`, pct(o.excellent['5']), pct(o.excellent['6']),
                pct(o.coverage_at_target['2.4']), o.n_aps > 1 ? pct(o.overlap_5) : '—',
                o.aps.map((a) => a.floor).join(', '),
              ])} />
            {option && (
              <>
                <h3 className="font-semibold text-slate-900">{option.n_aps} AP{option.n_aps > 1 ? 's' : ''}: where and which channels</h3>
                <Table head={['AP', 'Floor', 'Room', 'Position (from plan origin)', '2.4 GHz', '5 GHz', '6 GHz']}
                  rows={option.aps.map((ap, i) => [
                    `New AP ${i + 1}`, ap.floor, ap.room,
                    `${(ap.pos[0] / 0.3048).toFixed(1)}′ across, ${(ap.pos[1] / 0.3048).toFixed(1)}′ down`,
                    `ch ${ap.channels['2.4'].channel}`, `${ap.channels['5'].block}${ap.channels['5'].dfs ? ' (DFS)' : ''}`,
                    `ch ${ap.channels['6'].channel} / 160 MHz`,
                  ])} />
                <h3 className="font-semibold text-slate-900">Room by room: today → with {option.n_aps} AP{option.n_aps > 1 ? 's' : ''}</h3>
                <Table dense align={['', '', '', '', 'r', 'r', 'r', 'r', 'r']}
                  head={['Floor', 'Room', 'Today', 'After', 'Today 5 GHz', 'After 5 GHz', 'After 6 GHz', 'Est. 5 GHz', 'Est. 6 GHz']}
                  rows={option.rooms.map((r) => {
                    const b = baseRooms.find((x) => x.room_id === r.room_id)
                    return [r.floor, r.name, <Grade g={r.baseline_grade} />, <Grade g={r.grade} />,
                      dbm(b?.model?.median_dbm), dbm(r.median_dbm['5']), dbm(r.median_dbm['6']),
                      mbps(r.throughput_mbps['5']), mbps(r.throughput_mbps['6'])]
                  })} />
              </>
            )}
          </Section>
        )}

        <Section id="today" title="Today in detail" intro="Grades combine coverage at each room's target (from the heatmap), measured download and latency.">
          <Table dense align={['', '', '', 'r', 'r', 'r', 'r', 'r', '']}
            head={['Floor', 'Room', 'Grade', 'Target', 'Coverage', 'Median signal', 'Download (median)', 'Latency p95', 'Notes']}
            rows={baseRooms.map((r) => [r.floor, r.name, <Grade g={r.grade} />,
              `${r.target.signal_dbm} dBm · ${r.target.down_mbps} Mbps`, pct(r.components.coverage),
              dbm(r.measured.signal_median_dbm), mbps(r.measured.down_median_mbps),
              r.measured.latency_p95_median_ms != null ? `${r.measured.latency_p95_median_ms} ms` : '—',
              r.issues.join('; ') || 'Meets target'])} />

          <h3 className="font-semibold text-slate-900">Current access points</h3>
          <Table dense head={['AP', 'Radios (band / channel / strongest reading)', 'Matched from']}
            rows={(analysis?.aps ?? []).map((a) => [a.label,
              <div className="space-y-0.5">{a.radios.map((r) => <div key={r.bssid}>{r.band} GHz ch {r.channel} · {Math.round(r.max_dbm)} dBm <span className="text-slate-400 font-mono">{r.bssid}</span></div>)}</div>,
              `${a.distance_m} m from its loudest reading`])} />

          <h3 className="font-semibold text-slate-900">Other networks heard</h3>
          <Table dense align={['', '', '', '', 'r', 'r', '']}
            head={['Network', 'BSSID', 'Band', 'Channel', 'Strongest', 'Seen at', 'Strongest at']}
            rows={nb.map((e) => [e.ssid ?? '(hidden)', e.bssid, `${e.band} GHz`, e.channel, dbm(e.max), `${e.seen} spots`, e.where])} />

          {analysis && (
            <>
              <h3 className="font-semibold text-slate-900">Propagation model fit</h3>
              <Table dense align={['', 'r', 'r', 'r', 'r', '']}
                head={['Band', 'Readings', 'RMSE', 'Bias', 'Falloff (n)', 'Loss per crossing: starting → fitted']}
                rows={Object.entries(analysis.bands).map(([b, f]) => [BAND_LABEL[b], f.n_obs, `${f.rmse_db} dB`, `${f.bias_db} dB`, f.path_loss_exponent,
                  Object.entries(f.material_factors).map(([k, fac]) => `${MATERIAL_LABEL(k)} ${(f.material_loss_db[k] / (fac || 1)).toFixed(0)}→${f.material_loss_db[k].toFixed(1)} dB`).join(' · ')])} />
            </>
          )}
        </Section>

        {option && (
          <Section id="setup" title={`Omada setup checklist (${option.n_aps} AP${option.n_aps > 1 ? 's' : ''})`}>
            {omadaChecklist(option, plan.ap_model, existingAps).map((g) => (
              <div key={g.title} className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
                <h3 className="font-semibold text-slate-900">{g.title}</h3>
                {g.table && <Table dense head={g.table.head} rows={g.table.rows} />}
                <ul className="list-disc pl-5 space-y-1 text-sm">{g.items.map((it) => <li key={it}>{it}</li>)}</ul>
              </div>
            ))}
          </Section>
        )}

        <Section id="appendix" title="Appendix">
          <h3 className="font-semibold text-slate-900">Every measurement</h3>
          <Table dense align={['', '', 'r', '', 'r', 'r', 'r', '']}
            head={['Spot', 'Where', 'Signal', 'Connected to', 'Down', 'Up', 'Latency', 'Warnings']}
            rows={[...points].sort((a, b) => (floorName[a.floorId] ?? '').localeCompare(floorName[b.floorId] ?? '') || a.label.localeCompare(b.label)).map((p) => {
              const r = p.record, c = r.connected
              return [p.label, roomName(p), dbm(pointSignal(r)),
                c ? `${c.ssid} · ${c.band} GHz ch ${c.channel}/${c.width_mhz} · ${c.bssid}` : 'not connected',
                mbps(r.throughput?.down_mbps), mbps(r.throughput?.up_mbps),
                r.latency?.avg_ms != null ? `${r.latency.avg_ms.toFixed(1)} / ${r.latency.p95_ms?.toFixed(1)} ms` : '—',
                (r.warnings ?? []).join('; ')]
            })} />
          <h3 className="font-semibold text-slate-900">Method & assumptions</h3>
          <ul className="list-disc pl-5 space-y-1 text-sm max-w-3xl">
            <li>Survey: laptop {survey.meta?.agent?.hostname ?? ''} ({survey.meta?.agent?.driver ?? 'unknown driver'}, kernel {survey.meta?.agent?.kernel ?? '?'}), held at about 1 m; three fresh scans per spot (median per radio), iperf3 download/upload to a wired server, then ping.</li>
            <li>Model: multi-wall propagation fitted per band to the survey (distance falloff, per-material and per-floor losses, each radio's power). The heatmap is the model's prediction nudged towards the readings near each spot.</li>
            <li>6 GHz has nothing to measure today; it is predicted from the 5 GHz fit using the material table's 6 GHz losses. Verify with an AP-on-a-stick test.</li>
            <li>Laptop antennas differ from phones; phones typically see a few dB less. Neighbouring networks change over time.</li>
            <li>Throughput figures are estimates from signal strength, not measurements, and the test server's 1 GbE link caps them near 940 Mbps.</li>
          </ul>
        </Section>
      </main>
      <footer className="max-w-6xl mx-auto px-6 pb-10 text-xs text-slate-400">Generated by home-planner · wifi_survey {analysis?.tool_version ?? ''}</footer>
    </div>
  )
}

function PointCard({ p, where, onClose }) {
  const r = p.record, c = r.connected
  const bands = ['2.4', '5', '6'].map((b) => [b, (r.scan ?? []).filter((e) => e.band === b).slice(0, 4)]).filter(([, l]) => l.length)
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm grid md:grid-cols-3 gap-4">
      <div>
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">{p.label}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </div>
        <div className="text-slate-500">{where}</div>
        <div className="mt-2">Signal <strong>{dbm(pointSignal(r))}</strong> <span className="text-slate-500">({classOf(pointSignal(r))?.label ?? '—'})</span></div>
        <div>{c ? `${c.ssid} · ${c.band} GHz ch ${c.channel} · ${c.width_mhz} MHz · ${c.phy_mode ?? ''}` : 'Not connected'}</div>
        {c && <div className="text-slate-500">Link {c.rx_bitrate_mbps} / {c.tx_bitrate_mbps} Mbps</div>}
      </div>
      <div>
        <div>Download <strong>{mbps(r.throughput?.down_mbps)}</strong> · Upload <strong>{mbps(r.throughput?.up_mbps)}</strong></div>
        <div>Latency {r.latency?.avg_ms?.toFixed(1) ?? '—'} ms (p95 {r.latency?.p95_ms?.toFixed(1) ?? '—'}) to {r.latency?.target}</div>
        {(r.warnings ?? []).length > 0 && <ul className="list-disc pl-5 text-amber-700 mt-1">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      </div>
      <div className="text-xs">
        {bands.map(([b, list]) => (
          <div key={b} className="mb-1"><span className="text-slate-500">{b} GHz</span>
            {list.map((e) => <div key={e.bssid} className="flex justify-between font-mono"><span className="truncate">{e.ssid ?? '(hidden)'} ch {e.channel}</span><span>{Math.round(e.signal_dbm)}</span></div>)}
          </div>
        ))}
      </div>
    </div>
  )
}
