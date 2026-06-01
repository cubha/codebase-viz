import { OrdSpecPrintPage, DecoSheetPage } from '@/pages/pages'
import type { AppRoute } from './app-routes'

export const partnerRoutes: AppRoute[] = [
  { path: 'partner/ordProdPlanMgmt/prodOrdSpec', component: OrdSpecPrintPage },
  { path: 'partner/matMgmt/decoSheet', component: DecoSheetPage },
]
