import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import AppShell from './layouts/AppShell'
import OverviewPage from './pages/OverviewPage'
import MachinesPage from './pages/MachinesPage'
import AlertsPage from './pages/AlertsPage'
import PackagesPage from './pages/PackagesPage'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<OverviewPage />} />
          <Route path="/machines" element={<MachinesPage />} />
          <Route path="/alerts" element={<AlertsPage />} />
          <Route path="/packages" element={<PackagesPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
