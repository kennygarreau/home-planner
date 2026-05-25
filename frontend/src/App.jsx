import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Projects from './pages/Projects'
import Backlog from './pages/Backlog'
import CalendarPage from './pages/CalendarPage'
import Settings from './pages/Settings'
import Tools from './pages/Tools'
import Electrical from './pages/Electrical'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="projects" element={<Projects />} />
          <Route path="backlog" element={<Backlog />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="settings" element={<Settings />} />
          <Route path="tools" element={<Tools />} />
          <Route path="electrical" element={<Electrical />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
