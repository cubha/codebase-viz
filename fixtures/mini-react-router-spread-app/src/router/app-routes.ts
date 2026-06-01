import React from 'react'
import { HomePage, CodePage, MessagePage, RegionalRankPage, SupplyPolicyPage } from '@/pages/pages'
import { agencyRoutes } from '@/router/app-routes-agency'
import { partnerRoutes } from '@/router/app-routes-partner'

export interface AppRoute {
  path: string
  component: React.ComponentType<any>
}

export const appRoutes: AppRoute[] = [
  { path: 'home', component: HomePage },
  { path: 'system/code', component: CodePage },
  { path: 'system/message', component: MessagePage },
  { path: 'headOffice/alloc/regionalRank/regional-rank', component: RegionalRankPage },
  { path: 'headOffice/alloc/supplyPolicy/supply-policy', component: SupplyPolicyPage },
  ...agencyRoutes,
  ...partnerRoutes,
]
