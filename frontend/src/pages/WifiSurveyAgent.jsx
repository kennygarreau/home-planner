import { useState, useEffect } from 'react'
import { Download, Copy, Check, AlertTriangle, Terminal, ShieldCheck } from 'lucide-react'

const MANIFEST_URL = '/downloads/wifi-survey.json'

const fmtSize = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

// navigator.clipboard only exists on secure origins; the planner is usually
// plain http on the LAN, so fall back to a hidden textarea + execCommand.
async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
    return
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.opacity = '0'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  ta.remove()
}

function CommandBlock({ lines }) {
  const [copied, setCopied] = useState(false)
  const text = lines.join('\n')
  const copy = async () => {
    try {
      await copyText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* user can still select the text */ }
  }
  return (
    <div className="relative group">
      <pre className="bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 pr-12 text-xs font-mono text-slate-300 overflow-x-auto">
        {lines.map((l, i) => <div key={i}><span className="text-slate-600 select-none">$ </span>{l}</div>)}
      </pre>
      <button onClick={copy} title="Copy"
        className="absolute top-2 right-2 p-1.5 rounded-md text-slate-500 hover:text-slate-200 hover:bg-slate-800">
        {copied ? <Check size={14} className="text-brand-400" /> : <Copy size={14} />}
      </button>
    </div>
  )
}

function Step({ n, title, children }) {
  return (
    <div className="flex gap-4">
      <div className="w-7 h-7 rounded-full bg-slate-800 border border-slate-700 text-slate-300 text-xs font-mono flex items-center justify-center shrink-0">
        {n}
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        <h4 className="text-sm font-medium text-slate-200">{title}</h4>
        {children}
      </div>
    </div>
  )
}

export default function WifiSurveyAgent() {
  const [manifest, setManifest] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch(MANIFEST_URL, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setManifest)
      .catch((e) => setError(e.message))
  }, [])

  const origin = window.location.origin
  const file = manifest?.filename ?? 'wifi-survey-x86_64.AppImage'

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="card space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-slate-100">Survey agent for Linux laptops</h3>
            <p className="text-sm text-slate-500 mt-1">
              A single file that runs on the laptop you carry around the house. It reads the Wi-Fi radio and runs speed
              and latency tests; you mark where you're standing on the floor plan.
            </p>
          </div>
          {manifest && (
            <a href={manifest.url} download={file} className="btn-primary shrink-0">
              <Download size={16} /> Download
            </a>
          )}
        </div>

        {manifest && (
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {[
              ['Version', manifest.version],
              ['Size', fmtSize(manifest.size)],
              ['Platform', `Linux ${manifest.arch}`],
              ['Built', new Date(manifest.built_at).toLocaleDateString()],
            ].map(([k, v]) => (
              <div key={k} className="bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2">
                <dt className="text-slate-500 uppercase tracking-wider">{k}</dt>
                <dd className="text-slate-200 font-mono mt-0.5">{v}</dd>
              </div>
            ))}
          </dl>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-800/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-300">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>The agent hasn't been built into this server yet ({error}). Rebuild the frontend container to include it.</span>
          </div>
        )}
      </div>

      <div className="card space-y-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-200">
          <Terminal size={16} className="text-slate-400" /> Set up the laptop
        </h3>

        <Step n={1} title="Install the speed-test client">
          <p className="text-xs text-slate-500">The agent uses your system's <code className="text-slate-400">iw</code> and{' '}
            <code className="text-slate-400">nmcli</code>, plus <code className="text-slate-400">iperf3</code> for throughput.</p>
          <CommandBlock lines={['sudo pacman -S iperf3']} />
        </Step>

        <Step n={2} title="Make it executable and put it on your PATH">
          <CommandBlock lines={[
            'mkdir -p ~/.local/bin',
            `mv ~/Downloads/${file} ~/.local/bin/wifi-survey`,
            'chmod +x ~/.local/bin/wifi-survey',
          ]} />
        </Step>

        <Step n={3} title="Point it at this home planner">
          <p className="text-xs text-slate-500">Saves the address and uses this server for iperf3 tests.</p>
          <CommandBlock lines={[`wifi-survey setup ${origin}`]} />
        </Step>

        <Step n={4} title="Check the laptop is ready">
          <p className="text-xs text-slate-500">
            Connect to your Wi-Fi first. Doctor checks scanning without root, 6 GHz and Wi-Fi 7 support, and that it can
            reach this server.
          </p>
          <CommandBlock lines={['wifi-survey doctor']} />
          <p className="text-xs text-slate-500">
            If <span className="text-slate-400">Rescan permission</span> fails (common over SSH), doctor prints a one-line
            polkit rule that lets your account request Wi-Fi scans. A terminal in your desktop session normally works as is.
          </p>
        </Step>

        <Step n={5} title="Start the agent and survey">
          <p className="text-xs text-slate-500">
            Leave this running, then open <span className="text-slate-300">Floor Plans → Survey</span> (on the laptop or your
            phone), walk to each suggested spot and click it. Each measurement takes about 30 seconds.
          </p>
          <CommandBlock lines={['wifi-survey agent']} />
        </Step>
      </div>

      <div className="card text-xs text-slate-500 space-y-2">
        <p className="flex items-start gap-2">
          <ShieldCheck size={14} className="text-slate-400 mt-0.5 shrink-0" />
          <span>
            The agent only reads; it never changes your network settings. Network names and readings stay on your local
            network.
          </span>
        </p>
        {manifest && (
          <p className="break-all">
            SHA-256: <span className="font-mono text-slate-400">{manifest.sha256}</span>
            {' '}— check with <code className="text-slate-400">sha256sum ~/.local/bin/wifi-survey</code>
          </p>
        )}
        <p>
          If it fails to start with a FUSE error, run it as <code className="text-slate-400">wifi-survey --appimage-extract-and-run doctor</code>{' '}
          or install <code className="text-slate-400">fuse2</code>.
        </p>
      </div>
    </div>
  )
}
