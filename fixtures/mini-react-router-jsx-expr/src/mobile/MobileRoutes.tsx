import { Route } from 'react-router-dom'

export const MobileRoutes = (
  <>
    <Route path="/m/home" element={<MobileHome />} />
    <Route path="/m/search" element={<MobileSearch />} />
  </>
)

function MobileHome() { return null }
function MobileSearch() { return null }
