const BASE = '/api'

async function req(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  }
  if (body) opts.body = JSON.stringify(body)
  const res = await fetch(`${BASE}${path}`, opts)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'Request failed')
  }
  return res.json()
}

export const api = {
  // Settings
  getSettings: () => req('GET', '/settings'),
  saveSettings: (data) => req('PUT', '/settings', data),

  // Projects
  getProjects: () => req('GET', '/projects'),
  createProject: (data) => req('POST', '/projects', data),
  updateProject: (id, data) => req('PUT', `/projects/${id}`, data),
  deleteProject: (id) => req('DELETE', `/projects/${id}`),

  // Benchmarks
  getBenchmarks: () => req('GET', '/benchmarks'),

  // Contractors
  getContractors: () => req('GET', '/contractors'),
  createContractor: (data) => req('POST', '/contractors', data),
  updateContractor: (id, data) => req('PUT', `/contractors/${id}`, data),
  deleteContractor: (id) => req('DELETE', `/contractors/${id}`),

  // Detectors
  getDetectors: () => req('GET', '/detectors'),
  createDetector: (data) => req('POST', '/detectors', data),
  updateDetector: (id, data) => req('PUT', `/detectors/${id}`, data),
  deleteDetector: (id) => req('DELETE', `/detectors/${id}`),

  // Floor plans
  getFloorPlans: () => req('GET', '/floorplans'),
  createFloorPlan: (data) => req('POST', '/floorplans', data),
  updateFloorPlan: (id, data) => req('PUT', `/floorplans/${id}`, data),
  deleteFloorPlan: (id) => req('DELETE', `/floorplans/${id}`),

  // Wi-Fi surveys
  getSurveys: () => req('GET', '/surveys'),
  createSurvey: (data) => req('POST', '/surveys', data),
  updateSurvey: (id, data) => req('PUT', `/surveys/${id}`, data),
  deleteSurvey: (id) => req('DELETE', `/surveys/${id}`),
  getSurveyState: (id) => req('GET', `/surveys/${id}`),
  queueSurveyPoint: (id, data) => req('POST', `/surveys/${id}/points`, data),
  remeasureSurveyPoint: (pid) => req('POST', `/surveys/points/${pid}/measure`),
  cancelSurveyPoint: (pid) => req('POST', `/surveys/points/${pid}/cancel`),
  deleteSurveyPoint: (pid) => req('DELETE', `/surveys/points/${pid}`),
  analyzeSurvey: (id) => req('POST', `/surveys/${id}/analyze`),
  getSurveyAnalysis: (id) => req('GET', `/surveys/${id}/analysis`),
  planSurveyAps: (id, data) => req('POST', `/surveys/${id}/plan`, data),
  getSurveyPlan: (id) => req('GET', `/surveys/${id}/plan`),

  // Export
  exportJSON: () => window.open('/api/export/json', '_blank'),
  exportCSV: () => window.open('/api/export/csv', '_blank'),

  // Tasks
  getAllTasks: () => req('GET', '/tasks'),
  getTasksForProject: (projectId) => req('GET', `/tasks/project/${projectId}`),
  createTask: (data) => req('POST', '/tasks', data),
  updateTask: (id, data) => req('PUT', `/tasks/${id}`, data),
  deleteTask: (id) => req('DELETE', `/tasks/${id}`),

    // Home Value History
  getHomeValueHistory: () => req('GET', '/homevalue'),
  addHomeValueSnapshot: (data) => req('POST', '/homevalue', data),
  deleteHomeValueSnapshot: (id) => req('DELETE', `/homevalue/${id}`),

  // Electrical load calculator
  getElec: () => req('GET', '/elec'),
  saveElec: (data) => req('PUT', '/elec', data),

  // Manual J load calculator
  getManualJ: () => req('GET', '/manualj'),
  saveManualJ: (data) => req('PUT', '/manualj', data),

  // AI features
  aiStatus: () => req('GET', '/ai/status'),
  aiModels: () => req('GET', '/ai/models'),
  saveAiConfig: (data) => req('PUT', '/ai/config', data),
  extractNameplate: (data) => req('POST', '/ai/nameplate', data),

  // Nameplate image CRUD
  getNameplates: (entityType, entityId) =>
    req('GET', `/nameplates?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`),
  updateNameplate: (id, extractedData) => req('PUT', `/nameplates/${id}`, { extractedData }),
  deleteNameplate: (id) => req('DELETE', `/nameplates/${id}`),
}
