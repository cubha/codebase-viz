import { createBrowserRouter } from 'react-router-dom'
import OrdSpecPrintPage from './pages/partner/ordProdPlanMgmt/prodOrdSpec/OrdSpecPrintPage'
import DecoSheetPage from './pages/partner/matMgmt/decoSheet/DecoSheetPage'
import UserMgmtPage from './pages/agency/userMgmt/UserMgmtPage'
import ProcCodeMgmtPage from './pages/headoffice/partnerBaseInfo/procCodeMgmt/ProcCodeMgmtPage'
import { ORD_PROD_PLAN, MAT_MGMT, AGENCY_BASE, HEAD_OFFICE } from './routes/paths'
import { extraRoutes } from './routes/extraRoutes'

// path가 모두 template literal(import 상수 치환) — 현 파서는 StringLiteral만 허용해 전부 누락.
export const router = createBrowserRouter([
  { path: `${ORD_PROD_PLAN}/spec`, element: <OrdSpecPrintPage /> },
  { path: `${MAT_MGMT}/deco`, element: <DecoSheetPage /> },
  { path: `${AGENCY_BASE}/users`, element: <UserMgmtPage /> },
  { path: `${HEAD_OFFICE}/proc-code`, element: <ProcCodeMgmtPage /> },
  ...extraRoutes,
])
