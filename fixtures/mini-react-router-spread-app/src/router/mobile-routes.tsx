import { Route } from 'react-router-dom'
import { MobileLoginPage, MobileHomePage } from '@/pages/pages'

export const MobileLoginRoute = (
  <Route path="/mobile/login" element={<MobileLoginPage />} />
)

export const MobileRoutes = (
  <Route path="/mobile" element={<MobileHomePage />}>
    <Route path="home" element={<MobileHomePage />} />
  </Route>
)
