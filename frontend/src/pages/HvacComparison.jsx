import { useState, useMemo, useEffect } from 'react'
import { ChevronDown, Printer } from 'lucide-react'
import {
  BarChart, Bar, LineChart, Line, ComposedChart, Area,
  XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, ReferenceLine, ReferenceDot,
} from 'recharts'

// ─── Constants ────────────────────────────────────────────────────────────────
const MONTHS   = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const AVG_TEMP = [28,23,30,42,51,60,71,73,68,63,49,36]
// Whole-home monthly heating shape (degree-day driven) — used only for its
// seasonal distribution. Actual annual total is a user input (oldTherms) since
// a single furnace/zone's share of whole-home usage isn't necessarily 1/N of it.
const HEAT_TH_SHAPE       = [198,212,183,82.5,38.5,9.5,0,0,0,2,48,132]
const HEAT_TH_SHAPE_TOTAL = HEAT_TH_SHAPE.reduce((a,b) => a+b, 0)
// Whole-home monthly cooling shape (all AC units/zones combined) — used only for
// its seasonal distribution. Actual annual total is a user input (oldCoolKwh)
// since a single AC unit/zone's share of whole-home usage isn't necessarily 1/N of it.
const COOL_SHAPE       = [0,0,0,0,0,-8,751,752,260,44,0,0]
const COOL_SHAPE_TOTAL = COOL_SHAPE.reduce((a,b) => a+Math.max(0,b), 0)
const SOLAR_KW = [55,70,95,115,130,135,135,125,105,80,55,45]
const BL_KWH   = 1083
const TH_KWH   = 29.3
const BINS = [[62,32],[57,54],[52,96],[47,160],[42,209],[37,251],[32,280],
              [27,254],[22,210],[17,175],[12,131],[7,92],[2,58],[-3,35],[-8,19]]

// ─── Pure calculations ────────────────────────────────────────────────────────
function copCurve(hspf2) {
  const tgt = hspf2 / 3.412
  const tw  = BINS.reduce((s,[t,h]) => s + h * Math.max(0, 65-t), 0)
  const wt  = BINS.map(([t,h]) => [t, h * Math.max(0, 65-t) / tw])
  const r   = 1.81
  const f   = wt.reduce((s,[t,w]) => s + w * (t-17) / (47-17), 0)
  const c17 = tgt / (1 + (r-1)*f), c47 = c17 * r
  return T => Math.max(1, Math.min(6, c17 + (c47-c17) * (T-17) / (47-17)))
}

function solarDisposition(monthlyProd, monthlyUse, nmRate, sweepRate, monthlyRates) {
  const rate = i => Array.isArray(monthlyRates) ? monthlyRates[i] : monthlyRates
  const monthly = monthlyProd.map((p, i) => ({
    prod: p, use: monthlyUse[i], rate: rate(i),
    selfCons: Math.min(p, monthlyUse[i]),
    export:   Math.max(0, p - monthlyUse[i]),
    gridBuy:  Math.max(0, monthlyUse[i] - p),
  }))
  const totalProd    = monthly.reduce((s,m) => s+m.prod, 0)
  const totalSelf    = monthly.reduce((s,m) => s+m.selfCons, 0)
  const totalExport  = monthly.reduce((s,m) => s+m.export, 0)
  const gridCost     = monthly.reduce((s,m) => s+m.gridBuy*m.rate, 0)
  const creditsEarned = monthly.reduce((s,m) => s+m.export*nmRate*m.rate, 0)
  const creditsUsed   = Math.min(creditsEarned, gridCost)
  const excessCredits = Math.max(0, creditsEarned - gridCost)
  const avgRate       = totalExport > 0 ? creditsEarned/totalExport/nmRate : rate(6)
  const strandedValue = excessCredits * (1 - sweepRate / nmRate)
  const strandedKwh   = nmRate > 0 && avgRate > 0 ? excessCredits/avgRate/nmRate : 0
  const netElecBill   = gridCost - creditsUsed - excessCredits*sweepRate/nmRate
  // Unfloored economic value — credits every exported kWh at full nm rate even
  // beyond what the real bill (floored at $0) can ever cash in. Used to compare
  // systems' true energy economics; equal to netElecBill - strandedValue.
  const trueCost      = gridCost - creditsEarned
  return { monthly, totalProd, totalSelf, totalExport, gridCost,
           creditsEarned, creditsUsed, excessCredits,
           strandedKwh, strandedValue, netElecBill, trueCost }
}

function calcHybrid(inp) {
  const FLAT           = 0.01862
  const rate_summer    = inp.supply + 0.09443 + 0.04673 + FLAT
  const rate_winter_hp = inp.supply + 0.04892 + 0.01492 + FLAT
  const disc_vs_std    = rate_summer - rate_winter_hp
  const HP_MONTHS      = new Set([0,1,2,3,10,11])

  const cop   = copCurve(inp.hspf2)
  const nafue = inp.nafue / 100
  const oafue = inp.oafue / 100
  const cr    = (inp.seer / 0.95) / inp.oseer
  const nm    = inp.nm / 100
  const HEAT_TH = HEAT_TH_SHAPE.map(h => h / HEAT_TH_SHAPE_TOTAL * inp.oldTherms)
  const COOL_OLD = COOL_SHAPE.map(c => Math.max(0,c) / COOL_SHAPE_TOTAL * inp.oldCoolKwh)
  const sw    = inp.sweep / 100

  const mProd=[], mUse=[], mHp=[], mGas=[], mCool=[], mCoolRaw=[], mGasTh=[]
  let totHp=0, totGasTh=0, totCool=0, hpHeat=0
  const totGasOld = HEAT_TH.reduce((a,b) => a+b, 0)

  for (let i = 0; i < 12; i++) {
    const t = AVG_TEMP[i], c = cop(t)
    const heatKwh = HEAT_TH[i] * TH_KWH * oafue
    let hf
    if (t >= inp.sp+5) hf = 1
    else if (t <= inp.sp-5) hf = 0
    else hf = (t - (inp.sp-5)) / 10
    const hpH   = heatKwh * hf, gasH = heatKwh * (1-hf)
    const hpE   = hpH / c, gasNew = (gasH/nafue)/TH_KWH, blower = gasNew*0.5
    const cNew  = COOL_OLD[i] / cr
    mProd.push(SOLAR_KW[i] * inp.solar)
    mUse.push(BL_KWH + hpE + cNew + blower)
    mHp.push(Math.round(hpE))
    mGas.push(Math.round(gasH/nafue))
    mCool.push(Math.round(cNew))
    mCoolRaw.push(cNew)
    mGasTh.push(gasNew)
    totHp += hpE; totGasTh += gasNew; totCool += cNew; hpHeat += hpH
  }

  const mRatesHP  = Array.from({length:12}, (_,i) => HP_MONTHS.has(i) ? rate_winter_hp : rate_summer)
  const mRatesStd = Array.from({length:12}, () => rate_summer)
  const mUseOld   = mProd.map((_,i) => BL_KWH + COOL_OLD[i])

  // Isolate cooling's contribution: heat pump handles cooling only (at its SEER2),
  // heating stays 100% gas as it was — no HP winter draw, no HP rate eligibility.
  const totGasNewFull = totGasOld * oafue / nafue
  const blowerFullMo  = totGasNewFull / 12 * 0.5
  const mUseCoolOnly  = mCoolRaw.map(c => BL_KWH + c + blowerFullMo)

  const disp        = solarDisposition(mProd, mUse,        nm, sw, mRatesHP)
  const dispOld     = solarDisposition(mProd, mUseOld,     nm, sw, mRatesStd)
  const dispNewStd  = solarDisposition(mProd, mUse,        nm, sw, mRatesStd)
  const dispCoolOnly= solarDisposition(mProd, mUseCoolOnly,nm, sw, mRatesStd)

  const gasSav        = (totGasOld - totGasTh) * inp.gas
  const elecDelta     = disp.trueCost - dispOld.trueCost
  const coolingDelta  = dispCoolOnly.trueCost - dispOld.trueCost
  const heatingDelta  = disp.trueCost - dispCoolOnly.trueCost
  const hpRateBenefit = dispNewStd.trueCost - disp.trueCost
  const totalSav      = gasSav - elecDelta
  const effCop        = hpHeat > 0 ? hpHeat/totHp : 0
  const sf            = disp.strandedKwh > 0 ? disp.strandedKwh/disp.totalExport : 0

  const monthData = MONTHS.map((month, i) => {
    const t = AVG_TEMP[i]
    let hf
    if (t >= inp.sp+5) hf = 1
    else if (t <= inp.sp-5) hf = 0
    else hf = (t - (inp.sp-5)) / 10
    const modeTag = hf >= .95 ? 'hp' : hf <= .05 ? 'gas' : 'mix'
    const modeLabel = hf >= .95 ? 'HP' : hf <= .05 ? 'Gas' : 'Mix'
    const exportKwh = disp.monthly[i].export
    const r = mRatesHP[i]
    return {
      month, temp: t, modeTag, mode: modeLabel,
      cop: cop(t).toFixed(2),
      solar: Math.round(mProd[i]),
      use:   Math.round(mUse[i]),
      export: Math.round(exportKwh),
      surplus: disp.monthly[i].gridBuy <= 0,
      gridVal: disp.monthly[i].gridBuy > 0
        ? `-$${Math.round(disp.monthly[i].gridBuy*r)}`
        : `+$${Math.round(exportKwh*nm*r)}`,
      stranded: exportKwh > 0 && sf > 0 ? Math.round(exportKwh*sf).toLocaleString() : '—',
    }
  })

  // Monthly $ breakdown — same trueCost basis as the annual deltas above, but
  // per month so the components sum exactly to gasSav/elecDelta/totalSav (trueCost
  // has no annual floor applied, so it's a plain linear sum across months).
  const mTrueCost = (d, i) => d.monthly[i].gridBuy*d.monthly[i].rate - d.monthly[i].export*nm*d.monthly[i].rate
  let cumulative = 0
  const benefitData = MONTHS.map((month, i) => {
    const gasBenefit     = (HEAT_TH[i] - mGasTh[i]) * inp.gas
    const coolingBenefit = -(mTrueCost(dispCoolOnly, i) - mTrueCost(dispOld, i))
    const heatingBenefit = -(mTrueCost(disp, i) - mTrueCost(dispCoolOnly, i))
    cumulative += gasBenefit + coolingBenefit + heatingBenefit
    return {
      month,
      gasBenefit:     Math.round(gasBenefit),
      coolingBenefit: Math.round(coolingBenefit),
      heatingBenefit: Math.round(heatingBenefit),
      cumulative:     Math.round(cumulative),
    }
  })

  // 10-year outlook — same monthly pattern repeated each year (weather/usage
  // held constant). Tracks two separate things: cumulative *real* $ benefit
  // (cash saved), and the solar net-metering credit balance (banked $ from
  // exported kWh, drawn down by grid purchases). Credits never expire or get
  // swept — they roll forward indefinitely across billing cycles — so the
  // balance only ever floors at $0 (a month you owe cash) and otherwise just
  // keeps accumulating. If it trends upward across the 10 years rather than
  // oscillating in place, that's the "stockpile" scenario: production is
  // consistently outrunning usage and the excess is never actually redeemed.
  // trueUpMonth just shifts which calendar month starts each year's data /
  // anniversary marker on the chart — it has no effect on the balance itself.
  const trueUpMonth = inp.trueUpMonth ?? 11 // 0=Jan..11=Dec
  let creditBal = 0, cumBenefit = 0
  const creditData = []
  for (let y = 0; y < 10; y++) {
    for (let k = 0; k < 12; k++) {
      const i = (trueUpMonth + 1 + k) % 12
      const gasBenefit     = (HEAT_TH[i] - mGasTh[i]) * inp.gas
      const coolingBenefit = -(mTrueCost(dispCoolOnly, i) - mTrueCost(dispOld, i))
      const heatingBenefit = -(mTrueCost(disp, i) - mTrueCost(dispCoolOnly, i))
      cumBenefit += gasBenefit + coolingBenefit + heatingBenefit
      const m = disp.monthly[i]
      creditBal = Math.max(0, creditBal + m.export*nm*m.rate - m.gridBuy*m.rate)
      creditData.push({
        idx: y*12 + k, year: y+1, month: MONTHS[i],
        creditBalance:     Math.round(creditBal),
        cumulativeBenefit: Math.round(cumBenefit),
      })
    }
  }

  return {
    gasSav, elecDelta, coolingDelta, heatingDelta, totalSav, payback: inp.cost/totalSav, proj: inp.cost,
    totHp, totGasTh, totGasOld, totCool, coolOldTotal: COOL_OLD.reduce((a,b)=>a+b,0), effCop, hpRateBenefit,
    oseer: inp.oseer,
    newGasCost: totGasTh*inp.gas, oldGasCost: totGasOld*inp.gas,
    netElecBill: disp.netElecBill, totalElec: mUse.reduce((a,b)=>a+b, 0),
    rate_summer, rate_winter_hp, disc_vs_std, elec: rate_summer,
    copTable: [52,42,32,22,12,2].map(t => ({temp: t, cop: cop(t).toFixed(2)})),
    disp, mProd, mUse, monthData, benefitData, creditData,
    chartData: MONTHS.map((month,i) => ({
      month, solar: Math.round(mProd[i]), baseline: BL_KWH,
      hpHeat: mHp[i], gasEq: mGas[i], cooling: mCool[i],
    })),
  }
}

function calcAC(inp) {
  const FLAT           = 0.01862
  const rate           = inp.supply + 0.09443 + 0.04673 + FLAT  // standard R1 rate (same as rate_summer in hybrid)
  const nafue  = inp.nafue / 100, oafue = inp.oafue / 100
  const seerEq = inp.seer / 0.95, cr = seerEq / inp.oseer
  const nm     = inp.nm / 100, sw = inp.sweep / 100
  const HEAT_TH = HEAT_TH_SHAPE.map(h => h / HEAT_TH_SHAPE_TOTAL * inp.oldTherms)
  const COOL_OLD = COOL_SHAPE.map(c => Math.max(0,c) / COOL_SHAPE_TOTAL * inp.oldCoolKwh)
  const totGasOld = HEAT_TH.reduce((a,b) => a+b, 0)
  const totGasNew = totGasOld * oafue / nafue
  const blowerMo  = totGasNew / 12 * 0.5

  const mProd=[], mUse=[], mCool=[]
  let totCool = 0
  for (let i = 0; i < 12; i++) {
    const cNew = COOL_OLD[i] / cr
    mProd.push(SOLAR_KW[i] * inp.solar)
    mUse.push(BL_KWH + cNew + blowerMo)
    mCool.push(Math.round(cNew))
    totCool += cNew
  }

  const mUseOld = mProd.map((_,i) => BL_KWH + COOL_OLD[i])
  const disp    = solarDisposition(mProd, mUse,    nm, sw, rate)
  const dispOld = solarDisposition(mProd, mUseOld, nm, sw, rate)
  const gasSav    = (totGasOld - totGasNew) * inp.gas
  const elecDelta = disp.trueCost - dispOld.trueCost
  const totalSav  = gasSav - elecDelta
  const sf        = disp.strandedKwh > 0 ? disp.strandedKwh/disp.totalExport : 0

  const monthData = MONTHS.map((month, i) => {
    const isAC      = COOL_SHAPE[i] > 20
    const exportKwh = disp.monthly[i].export
    return {
      month, temp: AVG_TEMP[i],
      modeTag: isAC ? 'ac' : 'gas', mode: isAC ? 'AC' : 'Gas',
      solar:  Math.round(mProd[i]),
      use:    Math.round(mUse[i]),
      export: Math.round(exportKwh),
      surplus: disp.monthly[i].gridBuy <= 0,
      gridVal: disp.monthly[i].gridBuy > 0
        ? `-$${Math.round(disp.monthly[i].gridBuy*rate)}`
        : `+$${Math.round(exportKwh*nm*rate)}`,
      stranded: exportKwh > 0 && sf > 0 ? Math.round(exportKwh*sf).toLocaleString() : '—',
    }
  })

  return {
    gasSav, elecDelta, totalSav, payback: inp.cost/totalSav, proj: inp.cost,
    totGasNew, totGasOld, totCool, coolOldTotal: COOL_OLD.reduce((a,b)=>a+b,0),
    newGasCost: totGasNew*inp.gas, oldGasCost: totGasOld*inp.gas,
    netElecBill: disp.netElecBill, totalElec: mUse.reduce((a,b)=>a+b, 0),
    elec: rate, seerEq, cr, disp, mProd, mUse, monthData,
    chartData: MONTHS.map((month,i) => ({
      month, solar: Math.round(mProd[i]), baseline: BL_KWH, cooling: mCool[i],
    })),
  }
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function Slider({ label, value, min, max, step, fmt, onChange }) {
  return (
    <div className="mb-3">
      <div className="flex justify-between mb-1">
        <span className="text-xs text-slate-400">{label}</span>
        <span className="text-xs text-blue-400 font-semibold">{fmt(value)}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="w-full accent-blue-500 cursor-pointer" />
    </div>
  )
}

function IR({ label, value, cls }) {
  return (
    <div className="flex justify-between text-sm py-1.5 border-b border-slate-800/40 last:border-0">
      <span className="text-slate-500">{label}</span>
      <span className={`font-semibold ${cls || 'text-slate-200'}`}>{value}</span>
    </div>
  )
}

function StatBox({ label, value, warn, bad }) {
  const cls = bad ? 'text-red-400' : warn ? 'text-amber-400' : 'text-emerald-400'
  return (
    <div className="bg-slate-950 rounded-lg p-3 text-center">
      <div className={`text-xl font-bold leading-tight ${cls}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-1 leading-tight">{label}</div>
    </div>
  )
}

function SolarPanel({ disp, nm, title }) {
  const fk = n => `${Math.round(n).toLocaleString()} kWh`
  const fd = n => `$${Math.abs(Math.round(n)).toLocaleString()}`
  const rows = [
    ['Total solar production',            fk(disp.totalProd),   'text-yellow-400'],
    ['Self-consumed',                     fk(disp.totalSelf),   'text-emerald-400'],
    ['Exported to grid',                  fk(disp.totalExport), 'text-blue-400'],
    ['Export credit value',               fd(disp.creditsEarned),'text-blue-400'],
    ['Annual grid purchases',             fd(disp.gridCost),    'text-red-400'],
    ['Net electric bill',
      (disp.netElecBill < 0 ? '-' : '') + fd(disp.netElecBill) + '/yr',
      disp.netElecBill < 0 ? 'text-emerald-400' : 'text-slate-200'],
  ]
  return (
    <div className="card space-y-3">
      <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">☀️ {title}</h3>
      <div className="bg-slate-950 border border-blue-950 rounded-lg p-3 space-y-1.5">
        <div className="text-[10px] font-bold uppercase tracking-wider text-blue-900 mb-2">Annual Solar Disposition</div>
        {rows.map(([l, v, c]) => (
          <div key={l} className="flex justify-between text-xs py-0.5 border-b border-slate-800/20 last:border-0">
            <span className="text-slate-500">{l}</span>
            <span className={`font-semibold ${c}`}>{v}</span>
          </div>
        ))}
      </div>
      {disp.strandedValue > 10 ? (
        <div className="bg-red-950/30 border border-red-900/40 rounded-lg p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-red-900 mb-1">⚠️ Stranded Export Value</div>
          <div className="text-xl font-bold text-red-400">{fd(disp.strandedValue)}/yr</div>
          <div className="text-xs text-red-900 mt-1">
            {Math.round(disp.strandedKwh).toLocaleString()} kWh exported beyond what credits can offset —
            value lost at annual true-up if utility sweeps excess at below-retail rate.
          </div>
        </div>
      ) : (
        <div className="text-xs text-emerald-400 font-medium">$0 stranded — all solar value utilized</div>
      )}
    </div>
  )
}

const MODE_CLS = {
  hp:  'bg-blue-900/50 text-blue-300',
  gas: 'bg-orange-900/40 text-orange-300',
  mix: 'bg-indigo-900/40 text-indigo-300',
  ac:  'bg-cyan-900/40 text-cyan-300',
}

function MonthlyTable({ monthData, showCop }) {
  return (
    <div className="card space-y-3">
      <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Monthly Balance</h3>
      <div className="overflow-x-auto rounded-lg border border-slate-800">
        <table className="w-full text-xs whitespace-nowrap">
          <thead>
            <tr className="border-b border-slate-800 bg-slate-900/50 text-slate-500 uppercase tracking-wider">
              <th className="text-left px-3 py-2">Mo</th>
              <th className="text-right px-2 py-2">°F</th>
              <th className="text-center px-2 py-2">Mode</th>
              {showCop && <th className="text-right px-2 py-2">COP</th>}
              <th className="text-right px-2 py-2">Solar</th>
              <th className="text-right px-2 py-2">Use</th>
              <th className="text-right px-2 py-2">Export</th>
              <th className="text-right px-2 py-2">Grid $</th>
              <th className="text-right px-2 py-2">Stranded</th>
            </tr>
          </thead>
          <tbody>
            {monthData.map(m => (
              <tr key={m.month}
                className={`border-b border-slate-800/30 ${m.surplus ? 'text-emerald-400' : 'text-red-400'}`}>
                <td className="px-3 py-1.5 text-slate-300">{m.month}</td>
                <td className="px-2 py-1.5 text-right">{m.temp}°</td>
                <td className="px-2 py-1.5 text-center">
                  <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded font-bold ${MODE_CLS[m.modeTag]}`}>
                    {m.mode}
                  </span>
                </td>
                {showCop && <td className="px-2 py-1.5 text-right font-mono text-slate-300">{m.cop}</td>}
                <td className="px-2 py-1.5 text-right font-mono">{m.solar.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right font-mono">{m.use.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right font-mono">{m.export.toLocaleString()}</td>
                <td className="px-2 py-1.5 text-right font-mono">{m.gridVal}</td>
                <td className={`px-2 py-1.5 text-right font-mono ${m.stranded !== '—' ? 'text-red-400 font-bold' : 'text-slate-700'}`}>
                  {m.stranded}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-600 leading-relaxed">
        Green = net solar surplus month. Red = grid draw month. Stranded = exported kWh that exceed annual credit absorption capacity.
      </p>
    </div>
  )
}

const CHART_OPTS = {
  margin: { top: 4, right: 8, left: 0, bottom: 0 },
  tooltip: { contentStyle: { background:'#0d1117', border:'1px solid #2d3348', borderRadius:8, fontSize:11 } },
  xAxis:   { tick: { fill:'#475569', fontSize:9 }, axisLine:false, tickLine:false },
  yAxis:   { tick: { fill:'#475569', fontSize:9 }, axisLine:false, tickLine:false, width:55 },
  legend:  { wrapperStyle: { fontSize:10, color:'#64748b' }, iconSize:8 },
}

// ─── Shared settings panel ────────────────────────────────────────────────────
function SharedSettings({ shared, setShared }) {
  const [open, setOpen] = useState(false)
  const set = (k, v) => setShared(p => ({...p, [k]: v}))
  const rate = (shared.supply + 0.09443 + 0.04673 + 0.01862).toFixed(3)

  return (
    <div className="card">
      <button onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-4 text-left">
        <span className="text-xs font-bold uppercase tracking-widest text-slate-500 shrink-0">Shared Parameters</span>
        <span className="text-xs text-slate-600 truncate hidden sm:block">
          Gas ${shared.gas.toFixed(2)}/therm · Elec ${rate}/kWh · Solar {parseFloat(shared.solar).toFixed(1)} kW ·
          Furnace ${shared.furnaceCost.toLocaleString()} · Old {shared.oafue}% AFUE / SEER-{shared.oseer} ·
          {shared.oldTherms.toLocaleString()} therms/yr · {shared.oldCoolKwh.toLocaleString()} kWh/yr cooling
        </span>
        <ChevronDown size={14} className={`text-slate-500 shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-2 border-t border-slate-800 pt-5">
          {/* Old system */}
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-3">Old System</p>
            <Slider label="Old furnace AFUE" value={shared.oafue} min={50} max={80} step={1}
              fmt={v=>`${v}%`} onChange={v=>set('oafue',v)} />
            <Slider label="Old AC SEER" value={shared.oseer} min={6} max={16} step={1}
              fmt={v=>v} onChange={v=>set('oseer',v)} />
            <div className="mb-3">
              <label className="label">Old system gas usage (this furnace/zone only)</label>
              <div className="relative">
                <input type="number" className="input pr-16" value={shared.oldTherms} min={0} step={10}
                  onChange={e => set('oldTherms', Number(e.target.value))} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs pointer-events-none">therms/yr</span>
              </div>
              <p className="text-[10px] text-slate-600 mt-1 leading-snug">
                If this replaces one of several furnaces/zones, enter just this unit's share —
                not the whole home's total. Heating load usually isn't split evenly across zones.
              </p>
            </div>
            <div className="mb-3">
              <label className="label">Old AC usage (this unit/zone only)</label>
              <div className="relative">
                <input type="number" className="input pr-16" value={shared.oldCoolKwh} min={0} step={50}
                  onChange={e => set('oldCoolKwh', Number(e.target.value))} />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-xs pointer-events-none">kWh/yr</span>
              </div>
              <p className="text-[10px] text-slate-600 mt-1 leading-snug">
                If this replaces one of several AC units/zones, enter just this unit's share —
                not the whole home's total. Cooling load usually isn't split evenly across zones.
              </p>
            </div>
          </div>

          {/* New furnace */}
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-3">New Furnace (shared)</p>
            <Slider label="Furnace AFUE" value={shared.nafue} min={80} max={99} step={0.5}
              fmt={v=>`${v}%`} onChange={v=>set('nafue',v)} />
            <div className="mb-3">
              <label className="label">Furnace cost</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm pointer-events-none">$</span>
                <input type="number" className="input pl-6" value={shared.furnaceCost} min={0} step={100}
                  onChange={e => set('furnaceCost', Number(e.target.value))} />
              </div>
            </div>
          </div>

          {/* Utility & solar */}
          <div className="space-y-1">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-3">Utility & Solar</p>
            <Slider label="Gas ($/therm)" value={shared.gas} min={1} max={5} step={0.01}
              fmt={v=>`$${parseFloat(v).toFixed(2)}`} onChange={v=>set('gas',v)} />
            <Slider label="Electric supply ($/kWh)" value={shared.supply} min={0.05} max={0.30} step={0.001}
              fmt={v=>`$${parseFloat(v).toFixed(3)}`} onChange={v=>set('supply',v)} />
            <Slider label="Solar array (kW DC)" value={shared.solar} min={0} max={30} step={0.46}
              fmt={v=>`${parseFloat(v).toFixed(2)} kW`} onChange={v=>set('solar',v)} />
            <Slider label="Net metering (% retail)" value={shared.nm} min={50} max={100} step={1}
              fmt={v=>`${v}%`} onChange={v=>set('nm',v)} />
            <Slider label="Excess credit sweep rate" value={shared.sweep} min={0} max={100} step={5}
              fmt={v=>`${v}%`} onChange={v=>set('sweep',v)} />
            <div className="mb-3">
              <label className="label">Billing anniversary month</label>
              <select className="input" value={shared.trueUpMonth}
                onChange={e => set('trueUpMonth', Number(e.target.value))}>
                {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
              </select>
              <p className="text-[10px] text-slate-600 mt-1 leading-snug">
                Just marks year boundaries on the 10-year credit chart below (usually your solar
                interconnection date) — banked credits aren't reset or lost at this point, they carry forward.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Hybrid tab ───────────────────────────────────────────────────────────────
function HybridTab({ inp, setInp, res, furnaceCost, spSweep }) {
  const set = (k, v) => setInp(p => ({...p, [k]: v}))
  const f  = n => `$${Math.abs(Math.round(n)).toLocaleString()}`
  const fk = n => `${Math.round(n).toLocaleString()} kWh`
  const peakSp = spSweep.reduce((best, cur) => cur.totalSav > best.totalSav ? cur : best, spSweep[0])

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
      {/* Settings — hybrid-specific only */}
      <div className="card space-y-1 self-start">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-3">Hybrid Control</p>
        <Slider label="Balance point (HP↔Gas)" value={inp.sp} min={10} max={50} step={1}
          fmt={v=>`${v}°F`} onChange={v=>set('sp',v)} />
        <Slider label="HSPF2" value={inp.hspf2} min={6} max={14} step={0.5}
          fmt={v=>parseFloat(v).toFixed(1)} onChange={v=>set('hspf2',v)} />
        <Slider label="HP SEER2" value={inp.seer} min={14} max={30} step={1}
          fmt={v=>v} onChange={v=>set('seer',v)} />
        <div className="bg-slate-950 rounded-lg p-3 mt-2 space-y-1 text-xs">
          <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-900 mb-1">Eversource R1HP (Nov–Apr)</p>
          <div className="flex justify-between"><span className="text-slate-600">Standard R1</span><span className="text-yellow-400 font-semibold">${res.rate_summer.toFixed(4)}/kWh</span></div>
          <div className="flex justify-between"><span className="text-slate-600">HP winter rate</span><span className="text-emerald-400 font-semibold">${res.rate_winter_hp.toFixed(4)}/kWh</span></div>
          <div className="flex justify-between"><span className="text-slate-600">HP discount</span><span className="text-emerald-400 font-semibold">{(res.disc_vs_std*100).toFixed(2)}¢/kWh</span></div>
        </div>
        <hr className="border-slate-800 my-2" />
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-2">Project Cost</p>
        <CostBreakdown inp={inp} setInp={setInp} unitLabel="Heat Pump" furnaceCost={furnaceCost} />
        <div className="bg-slate-950 rounded-lg p-3 mt-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-2">COP by Temperature</p>
          <div className="grid grid-cols-6 gap-1 text-center">
            {res.copTable.map(({temp, cop}) => (
              <div key={temp}>
                <div className="text-[10px] text-slate-600">{temp}°</div>
                <div className="text-xs font-bold text-blue-400">{cop}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Results */}
      <div className="space-y-4">
        <div className="bg-blue-950/20 border border-blue-900/30 rounded-xl px-4 py-3 text-xs text-blue-300">
          High-efficiency furnace (98.5% AFUE) + heat pump (HSPF2 10.5 / SEER2 23). Heat pump runs above balance point; gas furnace below.
          Heat pump <strong>consumes</strong> solar that would otherwise be exported.
        </div>

        <div className="card space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Annual Results — Hybrid</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatBox label="Gas Savings/yr" value={f(res.gasSav)} />
            <StatBox label="Electric Δ/yr" value={(res.elecDelta>=0?'+':'-')+f(res.elecDelta)} warn={res.elecDelta>500} />
            <StatBox label="Net Annual Benefit" value={f(res.totalSav)} warn={res.totalSav<1500} bad={res.totalSav<0} />
            <StatBox label="Simple Payback" value={res.totalSav>0?`${res.payback.toFixed(1)} yrs`:'N/A'} warn={res.payback>15} bad={res.payback>20} />
          </div>
          <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-emerald-400 to-blue-400 rounded-full transition-all"
              style={{width:`${Math.min(100,Math.max(0,(20-Math.max(0,res.payback))/20*100))}%`}} />
          </div>
          <div>
            <IR label="HP electricity (heating)"      value={fk(res.totHp)} />
            <IR label="Gas therms (new furnace)"      value={`${Math.round(res.totGasTh).toLocaleString()} therms/yr`} />
            <IR label="Gas therms (old system)"       value={`${Math.round(res.totGasOld).toLocaleString()} therms/yr`} />
            <IR label="Cooling kWh (new)"             value={fk(res.totCool)} />
            <IR label="Cooling kWh (old system)"      value={fk(res.coolOldTotal)} />
            <IR label="Effective seasonal COP"        value={res.effCop>0?res.effCop.toFixed(2):'—'} />
            <IR label="HP rate discount (Nov–Apr)"    value={res.hpRateBenefit>0?`-${f(res.hpRateBenefit)}/yr`:'$0'} cls="text-emerald-400" />
          </div>
        </div>

        <div className="card space-y-1">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Electric Δ Breakdown — Cooling vs Heating</h3>
          <p className="text-xs text-slate-600 mb-2">
            "Electric Δ/yr" above nets two opposite effects together. Split out: how much the HP's SEER2 {inp.seer} cooling
            saves vs your old SEER-{res.oseer} unit, and how much its winter heating draw costs — these two sum exactly to the total.
          </p>
          <IR label="Cooling electric Δ (HP cooling vs old AC)"
              value={(res.coolingDelta>=0?'+':'-')+f(res.coolingDelta)+'/yr'}
              cls={res.coolingDelta<0?'text-emerald-400':'text-red-400'} />
          <IR label="Heating electric Δ (HP heating vs old furnace)"
              value={(res.heatingDelta>=0?'+':'-')+f(res.heatingDelta)+'/yr'}
              cls={res.heatingDelta>0?'text-amber-400':'text-emerald-400'} />
          <IR label="= Net Electric Δ/yr" value={(res.elecDelta>=0?'+':'-')+f(res.elecDelta)+'/yr'} />
        </div>

        <div className="card space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Annual Benefit Buildup</h3>
          <p className="text-xs text-slate-600 mb-2">
            Where the {f(res.totalSav)}/yr net benefit comes from, month by month. Bars are each month's
            contribution; the line is the running total across the year.
          </p>
          <ResponsiveContainer width="100%" height={220}>
            <ComposedChart data={res.benefitData} {...CHART_OPTS}>
              <XAxis dataKey="month" {...CHART_OPTS.xAxis} />
              <YAxis yAxisId="l" {...CHART_OPTS.yAxis} tickFormatter={v=>`$${v}`} />
              <YAxis yAxisId="r" orientation="right" {...CHART_OPTS.yAxis} tickFormatter={v=>`$${(v/1000).toFixed(1)}k`} />
              <Tooltip {...CHART_OPTS.tooltip} formatter={v=>`$${v.toLocaleString()}`} />
              <Legend {...CHART_OPTS.legend} />
              <Bar yAxisId="l" dataKey="gasBenefit"     name="Gas savings"     stackId="b" fill="#f97316" />
              <Bar yAxisId="l" dataKey="coolingBenefit" name="Cooling savings" stackId="b" fill="#06b6d4" />
              <Bar yAxisId="l" dataKey="heatingBenefit" name="Heating cost"    stackId="b" fill="#8b5cf6" />
              <Line yAxisId="r" type="monotone" dataKey="cumulative" name="Cumulative net" stroke="#34d399" strokeWidth={2} dot={{r:3}} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="card space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">10-Year Outlook — Real Benefit vs. Credit Balance</h3>
          <p className="text-xs text-slate-600 mb-2">
            Green line: cumulative cash benefit — real money saved, keeps growing year over year. Orange area:
            the solar net-metering credit balance — banked credits never expire or get swept here, they roll
            forward across billing cycles (dashed lines just mark each anniversary). If the orange area keeps
            trending upward instead of oscillating in a stable band, production is out-earning usage year after
            year and you're building exactly the un-redeemed stockpile you were worried about.
          </p>
          <ResponsiveContainer width="100%" height={240}>
            <ComposedChart data={res.creditData} {...CHART_OPTS}>
              <XAxis dataKey="idx" type="number" domain={[0, 119]} {...CHART_OPTS.xAxis}
                ticks={[0,12,24,36,48,60,72,84,96,108]} tickFormatter={v=>`Yr ${v/12+1}`} />
              <YAxis yAxisId="l" {...CHART_OPTS.yAxis} tickFormatter={v=>`$${(v/1000).toFixed(1)}k`} />
              <YAxis yAxisId="r" orientation="right" {...CHART_OPTS.yAxis} tickFormatter={v=>`$${(v/1000).toFixed(1)}k`} />
              <Tooltip {...CHART_OPTS.tooltip} formatter={v=>`$${v.toLocaleString()}`}
                labelFormatter={idx => { const d = res.creditData[idx]; return d ? `${d.month} · Year ${d.year}` : idx }} />
              <Legend {...CHART_OPTS.legend} />
              {Array.from({length:9}, (_,y) => (
                <ReferenceLine key={y} yAxisId="l" x={(y+1)*12} stroke="#334155" strokeDasharray="2 4" />
              ))}
              <Area yAxisId="r" type="monotone" dataKey="creditBalance" name="Credit balance" fill="#f97316" stroke="#f97316" fillOpacity={0.25} />
              <Line yAxisId="l" type="monotone" dataKey="cumulativeBenefit" name="Cumulative net benefit" stroke="#34d399" strokeWidth={2} dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="card space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Balance Point Optimization</h3>
          <p className="text-xs text-slate-600 mb-2">
            Net annual benefit if the balance point were set to each temperature, holding HSPF2, SEER2, and every
            other input fixed. Shows where raising it stops paying off.
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={spSweep} {...CHART_OPTS}>
              <XAxis dataKey="sp" {...CHART_OPTS.xAxis} unit="°F" />
              <YAxis {...CHART_OPTS.yAxis} domain={['dataMin - 25', 'dataMax + 25']} tickFormatter={v=>`$${v.toLocaleString()}`} />
              <Tooltip {...CHART_OPTS.tooltip} formatter={v=>`$${v.toLocaleString()}`} labelFormatter={l=>`${l}°F balance point`} />
              <Line type="monotone" dataKey="totalSav" name="Net Annual Benefit" stroke="#60a5fa" strokeWidth={2} dot={false} />
              <ReferenceLine x={inp.sp} stroke="#fbbf24" strokeDasharray="4 4"
                label={{ value: 'Current', position: 'top', fill: '#fbbf24', fontSize: 10 }} />
              <ReferenceDot x={peakSp.sp} y={peakSp.totalSav} r={4} fill="#34d399" stroke="none"
                label={{ value: `Peak ${peakSp.sp}°F`, position: 'top', fill: '#34d399', fontSize: 10 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <SolarPanel disp={res.disp} nm={inp.nm} title="Solar Export Analysis — Hybrid" />

        <div className="card space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Monthly Balance — Hybrid</h3>
          <ResponsiveContainer width="100%" height={185}>
            <BarChart data={res.chartData} {...CHART_OPTS}>
              <XAxis dataKey="month" {...CHART_OPTS.xAxis} />
              <YAxis {...CHART_OPTS.yAxis} unit=" kWh" />
              <Tooltip {...CHART_OPTS.tooltip} />
              <Legend {...CHART_OPTS.legend} />
              <Bar dataKey="solar"    name="Solar"    stackId="p" fill="#fbbf24" />
              <Bar dataKey="baseline" name="Baseline" stackId="u" fill="#3b82f6" />
              <Bar dataKey="hpHeat"   name="HP Heat"  stackId="u" fill="#8b5cf6" />
              <Bar dataKey="gasEq"    name="Gas eq."  stackId="u" fill="#f97316" />
              <Bar dataKey="cooling"  name="Cooling"  stackId="u" fill="#06b6d4" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <MonthlyTable monthData={res.monthData} showCop />
      </div>
    </div>
  )
}

// ─── Furnace + AC tab ─────────────────────────────────────────────────────────
function AcFurnTab({ inp, setInp, res, furnaceCost }) {
  const set = (k, v) => setInp(p => ({...p, [k]: v}))
  const f  = n => `$${Math.abs(Math.round(n)).toLocaleString()}`
  const fk = n => `${Math.round(n).toLocaleString()} kWh`

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[300px_1fr] gap-4">
      {/* Settings — AC-specific only */}
      <div className="card space-y-1 self-start">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-2">Variable-Speed AC</p>
        <Slider label="AC SEER2" value={inp.seer} min={14} max={25} step={1}
          fmt={v=>v} onChange={v=>set('seer',v)} />
        <div className="bg-slate-950 rounded-lg p-3 my-2 text-xs">
          <span className="text-slate-400">SEER2 </span><span className="text-blue-400 font-bold">{inp.seer}</span>
          <span className="text-slate-400"> ≈ SEER </span><span className="text-blue-400 font-bold">{res.seerEq.toFixed(1)}</span>
          <span className="text-slate-400"> · </span><span className="text-emerald-400 font-bold">{res.cr.toFixed(2)}×</span>
          <span className="text-slate-600"> vs old · R-454B ✓ Mass Save</span>
        </div>
        <hr className="border-slate-800 my-2" />
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-600 mb-2">Project Cost</p>
        <CostBreakdown inp={inp} setInp={setInp} unitLabel="AC Unit" furnaceCost={furnaceCost} />
      </div>

      <div className="space-y-4">
        <div className="bg-blue-950/20 border border-blue-900/30 rounded-xl px-4 py-3 text-xs text-blue-300">
          High-efficiency furnace (98.5% AFUE) + variable-speed AC (SEER2 21, R-454B). All heating is gas —{' '}
          <strong>no winter electric draw</strong>. Solar has more room to export, but that export may be stranded.
        </div>

        <div className="card space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Annual Results — Furnace + AC</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <StatBox label="Gas Savings/yr" value={f(res.gasSav)} />
            <StatBox label="Electric Δ/yr" value={(res.elecDelta>=0?'+':'-')+f(res.elecDelta)} warn={res.elecDelta>500} />
            <StatBox label="Net Annual Benefit" value={f(res.totalSav)} warn={res.totalSav<1500} bad={res.totalSav<0} />
            <StatBox label="Simple Payback" value={res.totalSav>0?`${res.payback.toFixed(1)} yrs`:'N/A'} warn={res.payback>15} bad={res.payback>20} />
          </div>
          <div className="h-1 bg-slate-800 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-amber-400 to-red-400 rounded-full transition-all"
              style={{width:`${Math.min(100,Math.max(0,(20-Math.max(0,res.payback))/20*100))}%`}} />
          </div>
          <div>
            <IR label="Gas therms (new furnace)"      value={`${Math.round(res.totGasNew).toLocaleString()} therms/yr`} />
            <IR label="Gas therms (old system)"       value={`${Math.round(res.totGasOld).toLocaleString()} therms/yr`} />
            <IR label="Cooling kWh (new AC)"           value={fk(res.totCool)} />
            <IR label="Cooling kWh (old system)"      value={fk(res.coolOldTotal)} />
            <IR label="No HP heating — all gas"       value="↑ more solar available" cls="text-slate-600" />
          </div>
        </div>

        <SolarPanel disp={res.disp} nm={inp.nm} title="Solar Export Analysis — Furnace + AC" />

        <div className="card space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Monthly Balance — Furnace + AC</h3>
          <ResponsiveContainer width="100%" height={185}>
            <BarChart data={res.chartData} {...CHART_OPTS}>
              <XAxis dataKey="month" {...CHART_OPTS.xAxis} />
              <YAxis {...CHART_OPTS.yAxis} unit=" kWh" />
              <Tooltip {...CHART_OPTS.tooltip} />
              <Legend {...CHART_OPTS.legend} />
              <Bar dataKey="solar"    name="Solar"    stackId="p" fill="#fbbf24" />
              <Bar dataKey="baseline" name="Baseline" stackId="u" fill="#3b82f6" />
              <Bar dataKey="cooling"  name="Cooling"  stackId="u" fill="#06b6d4" />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <MonthlyTable monthData={res.monthData} showCop={false} />
      </div>
    </div>
  )
}

// ─── Compare tab ──────────────────────────────────────────────────────────────
function CompareTab({ hR, aR, hInp, aInp, shared, hCost, aCost }) {
  const f  = n => `$${Math.abs(Math.round(n)).toLocaleString()}`
  const fk = n => `${Math.round(n).toLocaleString()} kWh`
  const fp = n => `${Math.min(100,(n*100)).toFixed(0)}%`
  const fd = (n, prefix='') => `${n>=0?'+':'-'}${prefix}$${Math.abs(Math.round(n)).toLocaleString()}`

  const dSav = hR.totalSav - aR.totalSav
  const dPay = hR.payback  - aR.payback
  const dDm  = aR.disp.strandedValue - hR.disp.strandedValue

  // Incremental ROI: what does the extra spend on the HP over the AC unit buy you?
  const extraCost = hCost - aCost
  const extraSav  = dSav
  const incrPB    = extraSav > 0 ? extraCost / extraSav : null

  const hSf = hR.disp.strandedKwh > 0 ? hR.disp.strandedKwh/hR.disp.totalExport : 0
  const aSf = aR.disp.strandedKwh > 0 ? aR.disp.strandedKwh/aR.disp.totalExport : 0
  const solarData = MONTHS.map((month, i) => ({
    month,
    'H: Self':   Math.round(hR.disp.monthly[i].selfCons),
    'H: Export': Math.round(hR.disp.monthly[i].export * (1-hSf)),
    'H: Strand': Math.round(hR.disp.monthly[i].export * hSf),
    'A: Self':   Math.round(aR.disp.monthly[i].selfCons),
    'A: Export': Math.round(aR.disp.monthly[i].export * (1-aSf)),
    'A: Strand': Math.round(aR.disp.monthly[i].export * aSf),
  }))

  const cumData = Array.from({length:11}, (_,y) => ({
    year: y===0?'Now':`Yr ${y}`,
    Hybrid: Math.round(hR.totalSav * y),
    'Furnace+AC': Math.round(aR.totalSav * y),
  }))

  const hUtil = hR.disp.totalProd > 0
    ? (hR.disp.totalSelf + Math.min(hR.disp.creditsEarned, hR.disp.gridCost) / hR.elec) / hR.disp.totalProd
    : 0
  const aUtil = aR.disp.totalProd > 0
    ? (aR.disp.totalSelf + Math.min(aR.disp.creditsEarned, aR.disp.gridCost) / aR.elec) / aR.disp.totalProd
    : 0

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Head-to-head */}
      <div className="card space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Head-to-Head Summary</h3>
        <div className="grid grid-cols-3 divide-x divide-slate-800">
          {[
            { title: '🔥❄️ Hybrid Heat Pump', sub: 'Furnace + Heat Pump', sav: hR.totalSav, pay: hR.payback, proj: hR.proj, dm: hR.disp.strandedValue, savCls:'text-emerald-400' },
            { title: '❄️ Furnace + AC',        sub: 'Furnace + AC',        sav: aR.totalSav, pay: aR.payback, proj: aR.proj, dm: aR.disp.strandedValue, savCls:'text-amber-400' },
            null,
          ].map((col, idx) => {
            if (!col) return (
              <div key="diff" className="px-4 space-y-3">
                <div className="text-xs font-bold text-slate-500 pb-1 border-b border-slate-800">⚖️ Hybrid Advantage</div>
                <Bstat label="Extra annual savings" value={(dSav>=0?'+':'')+f(dSav)+'/yr'} cls={dSav>=0?'text-emerald-400':'text-red-400'} />
                <Bstat label="Payback difference"   value={(dPay>=0?'+':'')+dPay.toFixed(1)+' yrs'} cls={dPay>0?'text-red-400':dPay<0?'text-emerald-400':'text-slate-400'} />
                <Bstat label="Extra upfront cost"   value={(hR.proj-aR.proj>=0?'+':'')+f(hR.proj-aR.proj)} cls="text-slate-400" />
                <Bstat label="Less stranded solar"  value={(dDm>=0?'+':'')+f(dDm)+'/yr'} cls={dDm>=0?'text-emerald-400':'text-red-400'} />
              </div>
            )
            return (
              <div key={col.title} className="px-4 space-y-3 first:pl-0">
                <div className="text-xs font-bold text-slate-500 pb-1 border-b border-slate-800">
                  {col.title}<br />
                  <span className="text-slate-700 font-normal">{col.sub}</span>
                </div>
                <Bstat label="Annual benefit"       value={f(col.sav)+'/yr'}              cls={col.savCls} />
                <Bstat label="Payback"              value={col.pay>0?`${col.pay.toFixed(1)} yrs`:'N/A'} />
                <Bstat label="Net project cost"     value={f(col.proj)}                   cls="text-slate-400" />
                <Bstat label="Stranded solar value" value={col.dm>10?f(col.dm)+'/yr':'$0 stranded'} cls={col.dm>10?'text-blue-400':'text-emerald-400'} />
              </div>
            )
          })}
        </div>
      </div>

      {/* Incremental ROI */}
      <div className="card space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Incremental ROI — What Does the Heat Pump Upgrade Cost You?</h3>
        <p className="text-xs text-slate-500">
          Both options include the same furnace. The real question is whether the extra cost of the heat pump over a straight AC unit
          is worth the additional annual savings.
        </p>

        {/* Cost breakdown table */}
        <div className="overflow-x-auto rounded-lg border border-slate-800">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-900/50 text-slate-500 uppercase tracking-wider">
                <th className="text-left px-4 py-2.5">Component</th>
                <th className="text-right px-4 py-2.5">🔥❄️ Hybrid</th>
                <th className="text-right px-4 py-2.5">❄️ Furnace+AC</th>
                <th className="text-right px-4 py-2.5">Δ</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Furnace',              shared.furnaceCost, shared.furnaceCost],
                ['Unit (HP / AC)',       hInp.unitCost,      aInp.unitCost],
                ['Installation labor',  hInp.labor,         aInp.labor],
                ['Rebates & credits',   -(hInp.rebates||0), -(aInp.rebates||0)],
              ].map(([label, hv, av]) => {
                const delta = hv - av
                return (
                  <tr key={label} className="border-b border-slate-800/40">
                    <td className="px-4 py-2 text-slate-400">{label}</td>
                    <td className="px-4 py-2 text-right font-mono text-slate-200">
                      {hv < 0 ? `-$${Math.abs(hv).toLocaleString()}` : `$${hv.toLocaleString()}`}
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-slate-200">
                      {av < 0 ? `-$${Math.abs(av).toLocaleString()}` : `$${av.toLocaleString()}`}
                    </td>
                    <td className={`px-4 py-2 text-right font-mono font-medium ${delta > 0 ? 'text-amber-400' : delta < 0 ? 'text-emerald-400' : 'text-slate-600'}`}>
                      {delta === 0 ? '—' : fd(delta)}
                    </td>
                  </tr>
                )
              })}
              <tr className="bg-slate-900/50 border-t border-slate-700">
                <td className="px-4 py-2.5 font-semibold text-slate-300">Net project cost</td>
                <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-100">${hCost.toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right font-mono font-bold text-slate-100">${aCost.toLocaleString()}</td>
                <td className={`px-4 py-2.5 text-right font-mono font-bold ${extraCost > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
                  {fd(extraCost)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Incremental ROI stats */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-slate-950 rounded-lg p-4 text-center">
            <div className={`text-2xl font-bold ${extraCost > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {extraCost >= 0 ? '+' : ''}{f(extraCost)}
            </div>
            <div className="text-xs text-slate-500 mt-1">Extra upfront cost</div>
          </div>
          <div className="bg-slate-950 rounded-lg p-4 text-center">
            <div className={`text-2xl font-bold ${extraSav >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {extraSav >= 0 ? '+' : ''}{f(extraSav)}/yr
            </div>
            <div className="text-xs text-slate-500 mt-1">Extra annual savings</div>
          </div>
          <div className="bg-slate-950 rounded-lg p-4 text-center">
            <div className={`text-2xl font-bold ${!incrPB ? 'text-slate-600' : incrPB > 20 ? 'text-red-400' : incrPB > 12 ? 'text-amber-400' : 'text-emerald-400'}`}>
              {incrPB ? `${incrPB.toFixed(1)} yrs` : extraSav <= 0 ? '∞' : 'N/A'}
            </div>
            <div className="text-xs text-slate-500 mt-1">Incremental payback</div>
          </div>
        </div>

        {incrPB && (
          <div className={`rounded-lg border px-4 py-3 text-xs leading-relaxed ${
            incrPB <= 10 ? 'bg-emerald-950/20 border-emerald-900/40 text-emerald-300'
            : incrPB <= 15 ? 'bg-amber-950/20 border-amber-900/40 text-amber-300'
            : 'bg-red-950/20 border-red-900/40 text-red-300'
          }`}>
            Paying <strong>{f(extraCost)}</strong> more for the heat pump over the AC unit earns back an
            extra <strong>{f(extraSav)}/yr</strong> — that incremental investment pays off in <strong>{incrPB.toFixed(1)} years</strong>,
            independent of what both systems save over the old system.
          </div>
        )}
        {!incrPB && extraSav <= 0 && (
          <div className="bg-slate-900/50 border border-slate-800 rounded-lg px-4 py-3 text-xs text-slate-500">
            The hybrid system doesn't save more annually than the furnace+AC at current settings — the incremental spend doesn't pay off.
            Try adjusting gas rates, solar size, or balance point.
          </div>
        )}
      </div>

      {/* Solar utilization */}
      <div className="card space-y-4">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">☀️ Solar Utilization — Where Does Your Solar Go?</h3>
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: '🔥❄️ Hybrid', util: hUtil, disp: hR.disp, cls: 'border-blue-900/40', titleCls: 'text-blue-900', valCls: 'text-blue-400' },
            { label: '❄️ Furnace+AC', util: aUtil, disp: aR.disp, cls: 'border-red-900/40', titleCls: 'text-red-900', valCls: 'text-red-400' },
          ].map(c => (
            <div key={c.label} className={`bg-slate-950 rounded-xl border p-4 ${c.cls}`}>
              <div className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${c.titleCls}`}>{c.label} — Solar Disposition</div>
              <div className={`text-2xl font-bold ${c.valCls}`}>{fp(hUtil === c.util ? hUtil : aUtil)}</div>
              <div className="text-xs text-slate-600 mb-3">of solar production actually utilized</div>
              {[
                ['Production',           `${Math.round(c.disp.totalProd).toLocaleString()} kWh`],
                ['Self-consumed',        `${Math.round(c.disp.totalSelf).toLocaleString()} kWh`],
                ['Exported (credited)',  `${Math.round(c.disp.totalExport).toLocaleString()} kWh`],
                ['Stranded (dead money)',c.disp.strandedValue>10?f(c.disp.strandedValue)+'/yr':'$0'],
              ].map(([l,v]) => (
                <div key={l} className="flex justify-between text-xs py-1 border-b border-slate-800/30 last:border-0">
                  <span className="text-slate-500">{l}</span>
                  <span className="font-semibold text-slate-300">{v}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={solarData} {...CHART_OPTS}>
            <XAxis dataKey="month" {...CHART_OPTS.xAxis} />
            <YAxis {...CHART_OPTS.yAxis} unit=" kWh" />
            <Tooltip {...CHART_OPTS.tooltip} />
            <Legend {...CHART_OPTS.legend} />
            <Bar dataKey="H: Self"   stackId="h" fill="#1d4ed8" />
            <Bar dataKey="H: Export" stackId="h" fill="#60a5fa" />
            <Bar dataKey="H: Strand" stackId="h" fill="#f97316" />
            <Bar dataKey="A: Self"   stackId="a" fill="#065f46" />
            <Bar dataKey="A: Export" stackId="a" fill="#34d399" />
            <Bar dataKey="A: Strand" stackId="a" fill="#f87171" />
          </BarChart>
        </ResponsiveContainer>
        <p className="text-xs text-slate-600 leading-relaxed">
          Stranded kWh = exported surplus that exceeds annual grid purchase credits. At annual true-up, utilities typically sweep
          these at avoided-cost rates rather than retail. The hybrid heat pump's winter electric draw converts potential dead money
          into real heating value.
        </p>
      </div>

      {/* Cumulative savings */}
      <div className="card space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">10-Year Cumulative Savings vs Keeping Old System</h3>
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={cumData} {...CHART_OPTS}>
            <XAxis dataKey="year" {...CHART_OPTS.xAxis} />
            <YAxis {...CHART_OPTS.yAxis} tickFormatter={v=>`$${(v/1000).toFixed(0)}k`} width={50} />
            <Tooltip {...CHART_OPTS.tooltip} formatter={v=>`$${v.toLocaleString()}`} />
            <Legend {...CHART_OPTS.legend} />
            <Line type="monotone" dataKey="Hybrid"      stroke="#60a5fa" strokeWidth={2} dot={{r:3}} />
            <Line type="monotone" dataKey="Furnace+AC"  stroke="#fbbf24" strokeWidth={2} dot={{r:3}} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Detailed breakdown */}
      <div className="card space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500">Detailed Breakdown</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 text-sm">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-2">Energy Flows</p>
            {[
              ['Gas therms (new)',          `${Math.round(hR.totGasTh)} th vs ${Math.round(aR.totGasNew)} th`],
              ['HP elec draw (heating)',    `${fk(hR.totHp)} vs none`],
              ['Cooling kWh',               `${fk(hR.totCool)} vs ${fk(aR.totCool)}`],
              ['Total electric consumption',`${fk(hR.totalElec)} vs ${fk(aR.totalElec)}`],
              ['Solar self-consumption',    `${fp(hUtil)} vs ${fp(aUtil)}`],
            ].map(([l,v]) => (
              <div key={l} className="flex justify-between py-1.5 border-b border-slate-800/40 last:border-0">
                <span className="text-slate-500">{l}</span>
                <span className="font-semibold text-slate-300 text-xs">{v}</span>
              </div>
            ))}
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-slate-600 mb-2">Costs & Rebates</p>
            {[
              ['Net gas bill',          `${f(hR.newGasCost)}/yr vs ${f(aR.newGasCost)}/yr`],
              ['Net electric bill',     `${f(hR.netElecBill)}/yr vs ${f(aR.netElecBill)}/yr`],
              ['Total energy cost',     `${f(hR.newGasCost+hR.netElecBill)}/yr vs ${f(aR.newGasCost+aR.netElecBill)}/yr`],
              ['HP rate discount',      hR.hpRateBenefit>0?`-${f(hR.hpRateBenefit)}/yr vs N/A`:'$0 vs N/A'],
              ['Mass Save eligible?',   'Check R-410A vs Yes (R-454B)'],
              ['Effective seasonal COP',`${hR.effCop>0?hR.effCop.toFixed(2):'—'} vs N/A`],
            ].map(([l,v]) => (
              <div key={l} className="flex justify-between py-1.5 border-b border-slate-800/40 last:border-0">
                <span className="text-slate-500">{l}</span>
                <span className="font-semibold text-slate-300 text-xs">{v}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Pros/cons */}
      <div className="card">
        <h3 className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-4">Considerations</h3>
        <div className="grid grid-cols-2 gap-6 text-xs text-slate-500 leading-7">
          <div>
            <p className="font-bold text-blue-300 mb-1">🔥❄️ Hybrid Pros</p>
            <p>· Converts stranded solar into heating value</p>
            <p>· Lower gas consumption on mild days</p>
            <p>· SEER2-23 vs 21 for cooling</p>
            <p>· Future-proofs vs gas price increases</p>
            <p className="font-bold text-red-400 mt-2 mb-1">Cons</p>
            <p>· R-410A may miss Mass Save rebates</p>
            <p>· Higher upfront cost</p>
            <p>· Winter grid draw when solar is weak</p>
          </div>
          <div>
            <p className="font-bold text-yellow-300 mb-1">❄️ Furnace + AC Pros</p>
            <p>· R-454B qualifies for Mass Save rebates</p>
            <p>· Lower upfront cost</p>
            <p>· Simpler system</p>
            <p>· No winter grid dependency</p>
            <p className="font-bold text-red-400 mt-2 mb-1">Cons</p>
            <p>· Large solar surplus stranded/wasted</p>
            <p>· All heating stays on gas</p>
            <p>· Lower SEER2 (21 vs 23)</p>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Cost breakdown input panel ───────────────────────────────────────────────
function CostBreakdown({ inp, setInp, unitLabel, furnaceCost }) {
  const set = (k, v) => setInp(p => ({...p, [k]: v}))
  const netCost = (furnaceCost||0) + (inp.unitCost||0) + (inp.labor||0) - (inp.rebates||0)

  return (
    <div className="space-y-2">
      {/* Furnace cost — read-only, lives in Shared Parameters */}
      <div>
        <label className="label">Furnace</label>
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/40 border border-slate-700/50 text-slate-500 text-sm">
          <span>${(furnaceCost||0).toLocaleString()}</span>
          <span className="text-xs text-slate-600 ml-auto">shared ↑</span>
        </div>
      </div>

      {[
        { key: 'unitCost', label: unitLabel },
        { key: 'labor',    label: 'Installation labor' },
      ].map(({ key, label }) => (
        <div key={key}>
          <label className="label">{label}</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm pointer-events-none">$</span>
            <input type="number" className="input pl-6" value={inp[key]} min={0} step={100}
              onChange={e => set(key, Number(e.target.value))} />
          </div>
        </div>
      ))}

      <div>
        <label className="label">Rebates & tax credits</label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm pointer-events-none">-$</span>
          <input type="number" className="input pl-7" value={inp.rebates} min={0} step={100}
            onChange={e => set('rebates', Number(e.target.value))} />
        </div>
      </div>

      <div className="flex justify-between items-center bg-slate-950 rounded-lg px-4 py-3 mt-1">
        <span className="text-xs text-slate-500 uppercase tracking-wider">Net project cost</span>
        <span className="font-display text-xl text-slate-100 tracking-wide">${netCost.toLocaleString()}</span>
      </div>
    </div>
  )
}

function Bstat({ label, value, cls }) {
  return (
    <div>
      <div className={`text-2xl font-bold leading-tight ${cls || 'text-slate-300'}`}>{value}</div>
      <div className="text-[11px] text-slate-600 mt-0.5">{label}</div>
    </div>
  )
}

// ─── localStorage helpers ─────────────────────────────────────────────────────
const load = (key, defaults) => {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(key)) } }
  catch { return defaults }
}
const save = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)) } catch {}
}

// ─── Main component ───────────────────────────────────────────────────────────
const SHARED_DEFAULTS = {
  nafue: 98.5, oafue: 60, oseer: 10, oldTherms: HEAT_TH_SHAPE_TOTAL, oldCoolKwh: COOL_SHAPE_TOTAL,
  supply: 0.177, gas: 2.47,
  solar: 14.72, nm: 100, sweep: 0, trueUpMonth: 11,
  furnaceCost: 4000,
}
// Hybrid-only: HP control + unit-specific cost
const H_DEFAULTS = { sp:30, hspf2:10.5, seer:23, unitCost:8000, labor:25000, rebates:2500 }
// AC-only: unit selection + unit-specific cost
const A_DEFAULTS = { seer:21, unitCost:6000, labor:22000, rebates:2000 }

// ─── Print summary (Hybrid) ───────────────────────────────────────────────────
// Rendered only for @media print, as a plain light-on-dark-free report — the
// live dashboard (dark theme, sliders, chart SVGs, collapsed panels) is hidden
// via print:hidden instead of trying to make it print-safe in place.
function PrintSummary({ inp, shared, res }) {
  const f  = n => `$${Math.abs(Math.round(n)).toLocaleString()}`
  const fk = n => `${Math.round(n).toLocaleString()} kWh`
  const today = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
  const row = (label, value, bold) => (
    <tr className={bold ? 'border-t border-gray-300 font-bold' : ''}>
      <td className={`py-1 pr-4 ${bold ? '' : 'text-gray-600'}`}>{label}</td>
      <td className="py-1 text-right">{value}</td>
    </tr>
  )
  const h2 = label => (
    <h2 className="text-xs font-bold uppercase tracking-wide border-b border-gray-300 pb-1 mb-1 mt-5 first:mt-0">{label}</h2>
  )

  return (
    <div className="hidden print:block text-black text-sm">
      <h1 className="text-xl font-bold mb-0.5">Hybrid Heat Pump Analysis — Summary</h1>
      <p className="text-xs text-gray-500 mb-4">Generated {today}</p>

      {h2('Inputs')}
      <table className="w-full text-xs">
        <tbody>
          {row('Balance point (HP↔Gas)', `${inp.sp}°F`)}
          {row('HSPF2 / HP SEER2', `${inp.hspf2} / ${inp.seer}`)}
          {row('Old furnace AFUE / old AC SEER', `${shared.oafue}% / ${shared.oseer}`)}
          {row('New furnace AFUE', `${shared.nafue}%`)}
          {row('Old system gas usage (this furnace/zone)', `${shared.oldTherms.toLocaleString()} therms/yr`)}
          {row('Gas rate', `$${shared.gas.toFixed(2)}/therm`)}
          {row('Electric rate (standard)', `$${res.elec.toFixed(4)}/kWh`)}
          {row('Solar array', `${parseFloat(shared.solar).toFixed(2)} kW DC`)}
          {row('Net metering / sweep rate', `${shared.nm}% / ${shared.sweep}%`)}
          {row('Net project cost', f(res.proj))}
        </tbody>
      </table>

      {h2('Annual Results')}
      <table className="w-full text-xs">
        <tbody>
          {row('Gas savings/yr', f(res.gasSav))}
          {row('Electric Δ/yr', (res.elecDelta>=0?'+':'-')+f(res.elecDelta))}
          {row('Net annual benefit', f(res.totalSav), true)}
          {row('Simple payback', res.totalSav>0 ? `${res.payback.toFixed(1)} yrs` : 'N/A')}
        </tbody>
      </table>

      {h2('Electric Δ Breakdown — Cooling vs Heating')}
      <table className="w-full text-xs">
        <tbody>
          {row('Cooling electric Δ (HP cooling vs old AC)', (res.coolingDelta>=0?'+':'-')+f(res.coolingDelta))}
          {row('Heating electric Δ (HP heating vs old furnace)', (res.heatingDelta>=0?'+':'-')+f(res.heatingDelta))}
          {row('= Net electric Δ/yr', (res.elecDelta>=0?'+':'-')+f(res.elecDelta), true)}
        </tbody>
      </table>

      {h2('Solar Export Analysis')}
      <table className="w-full text-xs">
        <tbody>
          {row('Total solar production', fk(res.disp.totalProd))}
          {row('Self-consumed', fk(res.disp.totalSelf))}
          {row('Exported to grid', fk(res.disp.totalExport))}
          {row('Annual grid purchases', f(res.disp.gridCost))}
          {row('Net electric bill', `${f(res.disp.netElecBill)}/yr`)}
          {row('Stranded export value', res.disp.strandedValue>10 ? `${f(res.disp.strandedValue)}/yr` : '$0')}
        </tbody>
      </table>

      {h2('Monthly Balance')}
      <table className="w-full text-[10px]">
        <thead>
          <tr className="border-b border-gray-400 text-left">
            <th className="py-1 pr-2">Mo</th>
            <th className="py-1 pr-2 text-right">°F</th>
            <th className="py-1 pr-2 text-center">Mode</th>
            <th className="py-1 pr-2 text-right">COP</th>
            <th className="py-1 pr-2 text-right">Solar</th>
            <th className="py-1 pr-2 text-right">Use</th>
            <th className="py-1 pr-2 text-right">Export</th>
            <th className="py-1 text-right">Grid $</th>
          </tr>
        </thead>
        <tbody>
          {res.monthData.map(m => (
            <tr key={m.month} className="border-b border-gray-200">
              <td className="py-0.5 pr-2">{m.month}</td>
              <td className="py-0.5 pr-2 text-right">{m.temp}°</td>
              <td className="py-0.5 pr-2 text-center">{m.mode}</td>
              <td className="py-0.5 pr-2 text-right">{m.cop}</td>
              <td className="py-0.5 pr-2 text-right">{m.solar.toLocaleString()}</td>
              <td className="py-0.5 pr-2 text-right">{m.use.toLocaleString()}</td>
              <td className="py-0.5 pr-2 text-right">{m.export.toLocaleString()}</td>
              <td className="py-0.5 text-right">{m.gridVal}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function HvacComparison() {
  const [tab,    setTab]    = useState('hybrid')
  const [shared, setShared] = useState(() => load('hvac-shared', SHARED_DEFAULTS))
  const [hInp,   setHInp]   = useState(() => load('hvac-hybrid', H_DEFAULTS))
  const [aInp,   setAInp]   = useState(() => load('hvac-ac',     A_DEFAULTS))

  useEffect(() => { save('hvac-shared', shared) }, [shared])
  useEffect(() => { save('hvac-hybrid', hInp)   }, [hInp])
  useEffect(() => { save('hvac-ac',     aInp)   }, [aInp])

  const hCost = (shared.furnaceCost||0) + (hInp.unitCost||0) + (hInp.labor||0) - (hInp.rebates||0)
  const aCost = (shared.furnaceCost||0) + (aInp.unitCost||0) + (aInp.labor||0) - (aInp.rebates||0)
  const hR = useMemo(() => calcHybrid({...shared, ...hInp, cost: hCost}), [shared, hInp, hCost])
  const aR = useMemo(() => calcAC({...shared, ...aInp, cost: aCost}),     [shared, aInp, aCost])

  // Sweep the balance point from 0-40°F, holding every other input fixed, to
  // see where raising it stops paying off (diminishing returns).
  const spSweep = useMemo(() => {
    const arr = []
    for (let sp = 0; sp <= 40; sp++) {
      const r = calcHybrid({...shared, ...hInp, sp, cost: hCost})
      arr.push({ sp, totalSav: Math.round(r.totalSav) })
    }
    return arr
  }, [shared, hInp, hCost])

  const TABS = [
    { id:'hybrid',  label:'🔥❄️ Hybrid Heat Pump' },
    { id:'acfurn',  label:'❄️ Furnace + AC' },
    { id:'compare', label:'⚖️ Compare' },
  ]

  return (
    <>
      <div className="space-y-4 print:hidden">
        <div className="flex items-center justify-between gap-4 border-b border-slate-800">
          <div className="flex gap-1">
            {TABS.map(t => (
              <button key={t.id} onClick={() => setTab(t.id)}
                className={`px-5 py-2 text-xs font-semibold rounded-t-lg border border-b-0 -mb-px transition-all ${
                  tab===t.id
                    ? 'bg-slate-900 border-slate-800 text-slate-100'
                    : 'border-transparent text-slate-500 hover:text-slate-300 hover:bg-slate-900/40'
                }`}>
                {t.label}
              </button>
            ))}
          </div>
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 mb-2 px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-800 text-slate-400 hover:text-slate-200 hover:bg-slate-900/40 transition-all shrink-0">
            <Printer size={13} /> Print Summary
          </button>
        </div>

        <SharedSettings shared={shared} setShared={setShared} />

        {tab==='hybrid'  && <HybridTab  inp={hInp} setInp={setHInp} res={hR} furnaceCost={shared.furnaceCost} spSweep={spSweep} />}
        {tab==='acfurn'  && <AcFurnTab  inp={aInp} setInp={setAInp} res={aR} furnaceCost={shared.furnaceCost} />}
        {tab==='compare' && <CompareTab hR={hR} aR={aR} hInp={hInp} aInp={aInp} shared={shared} hCost={hCost} aCost={aCost} />}
      </div>

      <PrintSummary inp={hInp} shared={shared} res={hR} />
    </>
  )
}
