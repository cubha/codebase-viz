import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { MobileRoutes } from './mobile/MobileRoutes'
import { MobileLoginRoute } from './mobile/MobileLoginRoute'

const appRoutes = [
  { path: '/dashboard', element: 'DashboardPage' },
  { path: '/settings', element: 'SettingsPage' },
  { path: '/profile', element: 'ProfilePage' },
]
const appRouteElements = appRoutes.map(r => <Route path={r.path} element={null} />)

export default function Router() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<LayoutWrapper />}>
          <Route path="/inside" element={<InsidePage />} />
        </Route>
        {appRouteElements}
        {MobileRoutes}
        {MobileLoginRoute}
        {Unknown}
      </Routes>
    </BrowserRouter>
  )
}

function LoginPage() { return null }
function LayoutWrapper() { return null }
function InsidePage() { return null }
