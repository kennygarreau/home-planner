import { createRoot } from 'react-dom/client'
import './report.css'
import ReportApp from './ReportApp'

// Data is embedded by the home planner's "Export report" button, replacing
// the null below in report.html.
const raw = document.getElementById('report-data')?.textContent?.trim()
let data = null
try {
  data = raw ? JSON.parse(raw) : null
} catch {
  data = null
}

const root = createRoot(document.getElementById('report-root'))
root.render(
  data ? <ReportApp data={data} /> : (
    <div style={{ fontFamily: 'system-ui', padding: 40 }}>
      <h1>Wi-Fi survey report template</h1>
      <p>This file is the empty template. Export a report from Floor Plans → Survey in the home planner.</p>
    </div>
  ),
)
