import TrnStmtSchPage from '../pages/partner/perfMgmt/transStmt/TrnStmtSchPage'
import { PERF } from './paths'

// 외부 배열 → router에서 `...extraRoutes` spread inline (2-hop). path는 template literal.
export const extraRoutes = [
  { path: `${PERF}/trans`, element: <TrnStmtSchPage /> },
]
