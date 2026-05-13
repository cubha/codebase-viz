import { Routes, Route } from 'react-router-dom'

export default function NotificationRoutes() {
  return (
    <Routes>
      <Route path="list" />
      <Route path="create" />
      <Route path=":id" />
      <Route path=":id/edit" />
      <Route path=":id/detail" />
      <Route path=":id/delete" />
      <Route path="search" />
      <Route path="export" />
      <Route path="import" />
      <Route path="bulk" />
      <Route path="preview/:id" />
      <Route path="history/:id" />
    </Routes>
  )
}
