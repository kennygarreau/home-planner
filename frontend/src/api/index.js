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

  // Backlog
  getBacklog: () => req('GET', '/backlog'),
  createBacklogItem: (data) => req('POST', '/backlog', data),
  updateBacklogItem: (id, data) => req('PUT', `/backlog/${id}`, data),
  deleteBacklogItem: (id) => req('DELETE', `/backlog/${id}`),
  promoteBacklogItem: (id) => req('POST', `/backlog/${id}/promote`),

  // Benchmarks
  getBenchmarks: () => req('GET', '/benchmarks'),

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
}
