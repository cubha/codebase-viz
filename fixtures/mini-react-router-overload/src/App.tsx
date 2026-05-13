import { Routes, Route } from 'react-router-dom'
import UserRoutes from './routes/UserRoutes'
import AdminRoutes from './routes/AdminRoutes'
import ApiRoutes from './routes/ApiRoutes'
import SettingsRoutes from './routes/SettingsRoutes'
import ReportRoutes from './routes/ReportRoutes'
import NotificationRoutes from './routes/NotificationRoutes'
import DashboardRoutes from './routes/DashboardRoutes'
import AuthRoutes from './routes/AuthRoutes'
import BillingRoutes from './routes/BillingRoutes'
import SupportRoutes from './routes/SupportRoutes'

export default function App() {
  return (
    <Routes>
      <Route path="/users" element={<UserRoutes />} />
      <Route path="/admin" element={<AdminRoutes />} />
      <Route path="/api" element={<ApiRoutes />} />
      <Route path="/settings" element={<SettingsRoutes />} />
      <Route path="/reports" element={<ReportRoutes />} />
      <Route path="/notifications" element={<NotificationRoutes />} />
      <Route path="/dashboard" element={<DashboardRoutes />} />
      <Route path="/auth" element={<AuthRoutes />} />
      <Route path="/billing" element={<BillingRoutes />} />
      <Route path="/support" element={<SupportRoutes />} />
    </Routes>
  )
}
