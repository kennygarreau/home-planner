// "Export report": the standalone report template with this survey's data
// embedded, downloaded as one self-contained HTML file.
import { api } from '../api'

const TEMPLATE_URL = '/report/report.html'
const MARKER = '<script id="report-data" type="application/json">null</script>'

const slug = (s) => (s || 'survey').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export async function exportReport(surveyId) {
  const [template, floors, wifiFloorplan, state, analysis, plan] = await Promise.all([
    fetch(TEMPLATE_URL, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : Promise.reject(new Error(`Report template missing (HTTP ${r.status}) — rebuild the frontend`)))),
    api.getFloorPlans(),
    fetch('/api/floorplans/export/wifi').then((r) => r.json()),
    api.getSurveyState(surveyId),
    api.getSurveyAnalysis(surveyId).catch(() => null),
    api.getSurveyPlan(surveyId).catch(() => null),
  ])
  if (!template.includes(MARKER)) throw new Error('Report template has no data slot — rebuild the frontend')
  const data = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    floors,
    wifiFloorplan,
    survey: state.survey,
    points: state.points.filter((p) => p.record),
    analysis,
    plan,
  }
  // Escape "<" so nothing in the data can close the <script> tag.
  const json = JSON.stringify(data).replace(/</g, '\\u003c')
  const html = template.replace(MARKER, () => `<script id="report-data" type="application/json">${json}</script>`)
  const blob = new Blob([html], { type: 'text/html' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `wifi-report-${slug(state.survey.name)}-${new Date().toISOString().slice(0, 10)}.html`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return { bytes: blob.size, hasAnalysis: !!analysis, hasPlan: !!plan }
}
