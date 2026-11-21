import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Projects from './pages/Projects'
import CalendarPage from './pages/CalendarPage'
import Settings from './pages/Settings'
import Tools from './pages/Tools'
import Electrical from './pages/Electrical'
import ManualJ from './pages/ManualJ'
import Contractors from './pages/Contractors'
import Detectors from './pages/Detectors'
import FloorPlans from './pages/FloorPlans'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="projects" element={<Projects />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="settings" element={<Settings />} />
          <Route path="tools" element={<Tools />} />
          <Route path="electrical" element={<Electrical />} />
          <Route path="manual-j" element={<ManualJ />} />
          <Route path="contractors" element={<Contractors />} />
          <Route path="detectors" element={<Detectors />} />
          <Route path="floor-plans" element={<FloorPlans />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
