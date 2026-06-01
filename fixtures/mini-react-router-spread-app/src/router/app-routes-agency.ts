import { CustomerMgmtPage } from '@/pages/pages'
import type { AppRoute } from './app-routes'

const BASE = 'agency'

interface AgencyRouteDef {
  component: AppRoute['component']
}

const agencyRouteDefs: Record<string, AgencyRouteDef> = {
  [`${BASE}/masterMgmt/customerMgmt`]: { component: CustomerMgmtPage },
}

export const agencyRoutes: AppRoute[] = Object.entries(agencyRouteDefs).map(([path, def]) => ({
  path,
  component: def.component,
}))
