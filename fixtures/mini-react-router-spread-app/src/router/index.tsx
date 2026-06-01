import React from 'react'
import { Routes, Route } from 'react-router-dom'
import { RootRedirect, PlainMainLayout, LoginPage } from '@/pages/pages'
import { appRoutes } from '@/router/app-routes'
import { MobileLoginRoute, MobileRoutes } from './mobile-routes'

function ProtectedSessionRoute() { return null }
function MainLayoutWithNoticePopups() { return null }
function NotFound() { return null }

// 실제 repo 케이스: same-file const로 appRoutes.map() 결과를 보관 후 JSX에서 {appRouteElements}로 펼침.
const appRouteElements = appRoutes.map((route) => (
  <Route
    key={route.path}
    path={'/' + route.path}
    element={
      <React.Suspense fallback={null}>
        <route.component />
      </React.Suspense>
    }
  />
))

export default function Router() {
  return (
    <Routes>
      <Route path="/" element={<RootRedirect />} />
      <Route path="/login" element={<PlainMainLayout />}>
        <Route index element={<LoginPage />} />
      </Route>
      {MobileLoginRoute}
      <Route element={<ProtectedSessionRoute />}>
        <Route element={<MainLayoutWithNoticePopups />}>
          {appRouteElements}
        </Route>
        {MobileRoutes}
      </Route>
      <Route path="/not-found" element={<NotFound />} />
    </Routes>
  )
}
