import { useState, useEffect, useRef } from 'react'
import { Camera, RefreshCw, Check, X, AlertTriangle } from 'lucide-react'
import { api } from '../api'

// Resize + JPEG-compress an image File to a base64 string (no data: prefix)
// Uses FileReader → data URL so it works on iOS/Android without HEIC issues.
function compressImage(file, maxDim = 1024, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read image file'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Could not decode image — try a JPEG or PNG photo'))
      img.onload = () => {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width  = Math.round(img.width  * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        canvas.toBlob(
          blob => {
            if (!blob) { reject(new Error('Image compression failed')); return }
            const r2 = new FileReader()
            r2.onload  = () => resolve(r2.result.split(',')[1])
            r2.onerror = reject
            r2.readAsDataURL(blob)
          },
          'image/jpeg',
          quality,
        )
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

// ─────────────────────────────────────────────────────────
// NameplateScanner
//
// Props:
//   entityType  — e.g. "manualj_furnace" | "manualj_ac"
//   entityId    — e.g. "manualj-whole" | "manualj-zone-0"
//   label       — display label, e.g. "furnace" | "AC"
//   onApply     — callback({ furnace_cap?, ac_cap? }) — only present non-null values
// ─────────────────────────────────────────────────────────
export default function NameplateScanner({ entityType, entityId, label, onApply }) {
  const [phase, setPhase]           = useState('idle')   // idle | scanning | confirming | error
  const [extracted, setExtracted]   = useState(null)     // raw API response
  const [edits, setEdits]           = useState({})       // user-editable extracted values
  const [savedRecord, setSavedRecord] = useState(null)   // persisted DB record (meta only)
  const [thumbUrl, setThumbUrl]     = useState(null)     // object URL for preview
  const [errorMsg, setErrorMsg]     = useState('')
  const inputRef = useRef(null)

  // Load any existing saved nameplate for this entity on mount / entityId change
  useEffect(() => {
    if (!entityType || !entityId) return
    let cancelled = false
    api.getNameplates(entityType, entityId)
      .then(records => {
        if (cancelled || !records?.length) return
        const rec = records[0]
        setSavedRecord(rec)
        if (rec.imageData) {
          setThumbUrl(`data:${rec.mimeType || 'image/jpeg'};base64,${rec.imageData}`)
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [entityType, entityId])

  async function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setPhase('scanning')
    setErrorMsg('')

    let base64
    try {
      base64 = await compressImage(file)
    } catch (err) {
      setErrorMsg('Could not read image: ' + err.message)
      setPhase('error')
      return
    }

    // Show local preview immediately while the API call runs
    const localUrl = `data:image/jpeg;base64,${base64}`
    setThumbUrl(localUrl)

    try {
      const result = await api.extractNameplate({ entityType, entityId, imageData: base64, mimeType: 'image/jpeg' })
      setExtracted(result)
      setSavedRecord(result.record)
      setEdits({
        furnace_cap: result.extracted?.furnace_cap ?? '',
        ac_cap:      result.extracted?.ac_cap      ?? '',
      })
      setPhase('confirming')
    } catch (err) {
      const msg = err.message || 'Extraction failed'
      if (msg.includes('AI_NOT_CONFIGURED')) {
        setErrorMsg('AI not configured — set AI_ENABLED=true and AI_BASE_URL in your .env file.')
      } else if (msg.includes('PARSE_FAILED') || msg.includes('unparseable')) {
        setErrorMsg('Vision model could not read the nameplate. Try a sharper, well-lit photo.')
      } else {
        setErrorMsg(msg)
      }
      setPhase('error')
    }
  }

  function handleApply() {
    const values = {}
    const fc = parseInt(edits.furnace_cap)
    const ac = parseInt(edits.ac_cap)
    if (!isNaN(fc) && fc > 0) values.furnace_cap = fc
    if (!isNaN(ac) && ac > 0) values.ac_cap = ac

    // If user corrected values, persist the correction back to the DB
    if (savedRecord?.id && Object.keys(values).length) {
      const updated = { ...(extracted?.extracted || {}), ...values }
      api.updateNameplate(savedRecord.id, updated).catch(() => {})
    }

    onApply(values)
    setPhase('idle')
  }

  async function handleDelete() {
    if (savedRecord?.id) {
      await api.deleteNameplate(savedRecord.id).catch(() => {})
    }
    setSavedRecord(null)
    setThumbUrl(null)
    setExtracted(null)
    setPhase('idle')
  }

  const ext = extracted?.extracted

  return (
    <div>
      {/* ── Idle: scan button + thumbnail ── */}
      {phase === 'idle' && (
        <div className="flex items-center gap-2 mt-1.5">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-dashed border-slate-600 text-slate-400 hover:text-amber-400 hover:border-amber-600/50 text-xs transition-all"
          >
            <Camera size={12} />
            {thumbUrl ? `Re-scan ${label}` : `Scan ${label} nameplate`}
          </button>
          {thumbUrl && (
            <div className="relative group shrink-0">
              <img
                src={thumbUrl}
                alt={`${label} nameplate`}
                className="h-9 w-16 object-cover rounded border border-slate-700 cursor-pointer"
                onClick={() => setPhase('confirming')}
                title="Click to review"
              />
              <button
                type="button"
                onClick={handleDelete}
                className="absolute -top-1.5 -right-1.5 hidden group-hover:flex w-4 h-4 rounded-full bg-red-600 text-white items-center justify-center text-[10px] leading-none"
                title="Remove"
              >✕</button>
            </div>
          )}
        </div>
      )}

      {/* ── Scanning: spinner ── */}
      {phase === 'scanning' && (
        <div className="flex items-center gap-2 mt-1.5 text-xs text-amber-400">
          <RefreshCw size={12} className="animate-spin shrink-0" />
          Reading {label} nameplate…
        </div>
      )}

      {/* ── Error ── */}
      {phase === 'error' && (
        <div className="mt-2 flex items-start gap-2 bg-red-950/30 border border-red-800/40 rounded-lg px-3 py-2 text-xs text-red-400">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" />
          <span className="flex-1">{errorMsg}</span>
          <button type="button" onClick={() => setPhase('idle')} className="shrink-0 text-red-600 hover:text-red-400 ml-1">
            <X size={12} />
          </button>
        </div>
      )}

      {/* ── Confirming: review card ── */}
      {(phase === 'confirming' || (phase === 'idle' && false)) && ext !== undefined && (
        <div className="mt-2 bg-slate-800/60 border border-amber-700/30 rounded-xl p-3 space-y-3">
          {/* Header row: thumbnail + identifiers */}
          <div className="flex items-start gap-3">
            {thumbUrl && (
              <img
                src={thumbUrl}
                alt="nameplate"
                className="w-20 h-14 object-cover rounded border border-slate-700 shrink-0"
              />
            )}
            <div className="min-w-0 space-y-0.5">
              {ext?.manufacturer && (
                <div className="text-xs font-medium text-slate-200">{ext.manufacturer}</div>
              )}
              {ext?.model_number && (
                <div className="text-xs font-mono text-slate-400">Model: {ext.model_number}</div>
              )}
              {ext?.serial_number && (
                <div className="text-xs font-mono text-slate-500">S/N: {ext.serial_number}</div>
              )}
              {ext?.efficiency && (
                <div className="text-xs text-slate-500">{ext.efficiency}</div>
              )}
              {ext?.voltage && (
                <div className="text-xs text-slate-500">{ext.voltage}</div>
              )}
            </div>
          </div>

          {/* Editable capacity fields */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                Furnace Input BTU/hr
              </label>
              <input
                className="input mt-0.5 text-xs font-mono"
                type="number"
                min="0"
                step="1000"
                value={edits.furnace_cap}
                onChange={e => setEdits(d => ({ ...d, furnace_cap: e.target.value }))}
                placeholder="—"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono uppercase tracking-wider text-slate-500">
                AC Capacity BTU/hr
              </label>
              <input
                className="input mt-0.5 text-xs font-mono"
                type="number"
                min="0"
                step="6000"
                value={edits.ac_cap}
                onChange={e => setEdits(d => ({ ...d, ac_cap: e.target.value }))}
                placeholder="—"
              />
            </div>
          </div>

          {/* Notes / warnings from model */}
          {ext?.notes && (
            <div className="flex items-start gap-1.5 text-xs text-amber-400/80 bg-amber-950/20 rounded-lg px-2.5 py-2">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              <span>{ext.notes}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleApply}
              className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5"
            >
              <Check size={12} /> Apply to form
            </button>
            <button
              type="button"
              onClick={() => setPhase('idle')}
              className="btn-ghost text-xs py-1.5 px-3 flex items-center gap-1.5"
            >
              <X size={12} /> Discard
            </button>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="btn-ghost text-xs py-1.5 px-3 ml-auto"
            >
              Re-scan
            </button>
          </div>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  )
}
