import { isRouteNode, isTableNode, type IRGraph } from '@codebase-viz/types'
import { groupRoutesByUrl } from '../url-grouper.js'
import { RENDERING_INIT, CLASS_DEFS } from '../helpers/constants.js'
import { sanitizeId } from '../helpers/ids.js'
import { findBranchingGroups } from '../helpers/layout.js'
import { metadataToInfra, type InfraInfo } from './infra.js'
import { buildNestedFolderOverviewLines } from './tab1-tree.js'
import { buildBeRenderingDiagram } from '../be/tab1.js'

interface FwWrapper { id: string; label: string }
interface FwConfig {
  check: (infra: InfraInfo, allCSR: boolean) => boolean
  frontendRefId: string
  wrappers: readonly FwWrapper[]
}

// FE Tab1 wrapper 레이어 config. 외부 edge 발사는 항상 frontendRefId(outermost) — mermaid v11 명세.
// check 우선순위: nextjs-SSR > nextjs-CSR > vite > expo > react-router > vue-spa > angular > bare(fallback).
const FW_CONFIGS: readonly FwConfig[] = [
  {
    check: (infra, allCSR) => infra.hasNextjs && !allCSR,
    frontendRefId: 'INFRA',
    wrappers: [
      { id: 'INFRA', label: '☁ VERCEL · Edge Network' },
      { id: 'RUNTIME', label: '⚙ Node.js · Server Runtime' },
      { id: 'FRAMEWORK', label: '▲ Next.js · App Router' },
      { id: 'REACT', label: '⚛ React · SSR Engine' },
    ],
  },
  {
    check: (infra, allCSR) => infra.hasNextjs && allCSR,
    frontendRefId: 'BROWSER',
    wrappers: [
      { id: 'BROWSER', label: '🌐 Browser · Client-Side App' },
      { id: 'FRAMEWORK', label: '▲ Next.js · App Router' },
      { id: 'REACT', label: '⚛ React · CSR Engine' },
    ],
  },
  {
    check: (infra) => infra.hasVite,
    frontendRefId: 'BROWSER',
    wrappers: [
      { id: 'BROWSER', label: '🌐 Browser · Client-Side App' },
      { id: 'BUNDLER', label: '⚡ Vite · Dev/Build' },
      { id: 'REACT', label: '⚛ React · CSR Engine' },
    ],
  },
  {
    check: (infra) => infra.hasExpo,
    frontendRefId: 'MOBILE',
    wrappers: [
      { id: 'MOBILE', label: '📱 Mobile · iOS / Android' },
      { id: 'RN', label: '⚛ React Native · Expo' },
    ],
  },
  {
    check: (infra) => infra.hasReactRouter,
    frontendRefId: 'BROWSER',
    wrappers: [
      { id: 'BROWSER', label: '🌐 Browser · Client-Side App' },
      { id: 'ROUTER', label: '🧭 React Router · SPA' },
      { id: 'REACT', label: '⚛ React · CSR Engine' },
    ],
  },
  {
    check: (infra) => infra.hasVueSpa,
    frontendRefId: 'BROWSER',
    wrappers: [
      { id: 'BROWSER', label: '🌐 Browser · Client-Side App' },
      { id: 'ROUTER', label: '🧭 Vue Router · SPA' },
      { id: 'VUE', label: '💚 Vue · CSR Engine' },
    ],
  },
  {
    check: (infra) => infra.hasAngular,
    frontendRefId: 'BROWSER',
    wrappers: [
      { id: 'BROWSER', label: '🌐 Browser · Client-Side App' },
      { id: 'ROUTER', label: '🧭 Angular Router · SPA' },
      { id: 'ANGULAR', label: '🅰 Angular · CSR Engine' },
    ],
  },
]

export function buildRenderingDiagram(graph: IRGraph): string {
  if (graph.metadata?.adapterCategory === 'BE') return buildBeRenderingDiagram(graph)

  const infra = metadataToInfra(graph.metadata)
  // Only page routes — skip loading, layout, error, template, route-handler (same as Tab 2)
  const routeNodes = graph.nodes.filter(isRouteNode).filter(r => r.routeFileKind === 'page')
  if (routeNodes.length === 0) return 'graph TD\n  empty["(no routes found)"]'

  // FE 표준 v1.2.55 (R-T1.2 re-amendment, §9): Tab1은 단일 래퍼 안에 URL 도메인 트리를 root→대→중→소
  // full-depth 폴더 subgraph로 중첩하고 폴더별 재귀 route 수 배지를 표시한다(개별 route leaf는 Tab2 위임).
  // 노드 수는 폴더 수준이라 청킹 불필요(폐지). 이전 청킹 게이트(routeCount>100 / branchingGroups>
  // GROUPS_PER_ROW=v1.2.51 C2)는 wrapper(R-T1.1)·외부분기(R-T1.5)를 폐기시켜 Tab1을 전락시키던 결함이었다.
  const branchingGroups = findBranchingGroups(groupRoutesByUrl(routeNodes))

  const tableNodes = graph.nodes.filter(isTableNode)
  const hasDirectDB = infra.hasSupabase || infra.hasDexie || infra.hasPrisma || infra.hasFirebase
  const hasExternalAPI = tableNodes.length > 0 && !hasDirectDB
  const backends = graph.metadata?.backends ?? []
  const allCSR = routeNodes.length > 0 && routeNodes.every(r => r.renderingMode === 'CSR')

  // (Playwright 검증): FE Tab1은 outer `graph LR` 사용.
  // 표준 1 R-T1.2 "동일 Depth = X축"을 mermaid가 형제 subgraph 자동 가로 배치로 충족.
  // 외부 edge가 어느 컨테이너에 incoming해도 LR이 영향받지 않음 (TD + nested direction LR은 무시됨).
  const lines: string[] = [RENDERING_INIT, 'graph LR', CLASS_DEFS]

  // ── 1. FRONTEND LAYER ────────────────────────────────────────────────────
  // frontendRef: outermost wrapper subgraph ID — 외부 data layer edge source.
  // mermaid v11 공식 명세 "subgraph 노드 중 하나라도 외부 edge 가지면
  // 그 subgraph direction 무시"에 따라, 외부 edge는 반드시 *outermost* wrapper에서 발사해야
  // inner sub-cluster의 direction(LR + ~~~ chain)이 보존됨. middle/inner wrapper(REACT, VUE 등)에서
  // 외부 edge 발사하면 부모 direction 상속 연쇄로 top-level sibling이 Y축 stack됨.
  let frontendRef: string | undefined
  const fwConfig = FW_CONFIGS.find(cfg => cfg.check(infra, allCSR))
  if (fwConfig !== undefined) {
    frontendRef = fwConfig.frontendRefId
    let depth = 0
    for (const w of fwConfig.wrappers) {
      lines.push(`${'  '.repeat(depth + 1)}subgraph ${w.id}["${w.label}"]`)
      depth++
    }
    const innerIndent = '  '.repeat(depth + 1)
    for (const l of buildNestedFolderOverviewLines(branchingGroups, innerIndent)) lines.push(l)
    const closeParts: string[] = []
    while (depth > 0) { closeParts.push(`${'  '.repeat(depth)}end`); depth-- }
    lines.push(closeParts.join('\n'))
  } else {
    for (const l of buildNestedFolderOverviewLines(branchingGroups, '  ')) lines.push(l)
  }

  // ── 2. DATA / BACKEND LAYER (always outside frontend, unconditional) ─────
  if (backends.length > 0) {
    // Detailed backend from LLM analysis (monorepo / explicit backend detected)
    for (let i = 0; i < backends.length; i++) {
      const be = backends[i]!
      const beId = `BACKEND_${i}`
      const dbId = `DB_${i}`
      const dbLabel = be.dbType === 'postgresql' ? '🐘 PostgreSQL' :
                      be.dbType === 'mysql' ? '🐬 MySQL' :
                      be.dbType === 'mongodb' ? '🍃 MongoDB' : '🗄 Database'
      const visibleMods = (be.modules ?? []).slice(0, 8)
      const extraModCount = (be.modules ?? []).length - visibleMods.length
      lines.push(`  subgraph ${beId}["⚙ ${be.name} · ${be.framework}"]`)
      if (visibleMods.length > 0) {
        lines.push(`    subgraph MODULES_${i}["Core Modules"]`)
        for (const mod of visibleMods) {
          lines.push(`      ${sanitizeId(mod)}_${i}["${mod}"]`)
        }
        if (extraModCount > 0) lines.push(`      MORE_${i}["+ ${extraModCount} more"]`)
        lines.push('    end')
      }
      lines.push(`    ${dbId}[("${dbLabel}")]`)
      if (visibleMods.length > 0) {
        for (const mod of visibleMods) {
          lines.push(`    ${sanitizeId(mod)}_${i} --> ${dbId}`)
        }
      }
      lines.push('  end')
      if (frontendRef !== undefined) lines.push(`  ${frontendRef} -.->|"REST"| ${beId}`)
    }
  } else if (infra.hasSupabase) {
    // fetchSrc도 frontendRef(outermost wrapper) 사용 — middle wrapper에서 외부 edge 발사 금지.
    const fetchSrc = frontendRef ?? 'BROWSER'
    lines.push(`  subgraph DATALAYER["🗄 DATA LAYER"]`)
    lines.push(`    subgraph SUPABASE_G["⚡ Supabase · BaaS"]`)
    lines.push(`      PG_SB[("PostgreSQL")]`)
    if (infra.hasNextjs && !allCSR) lines.push(`      SB_AUTH["Auth · OAuth"]`)
    lines.push('    end\n  end')
    if (frontendRef !== undefined) lines.push(`  ${fetchSrc} -.->|"supabase-js"| PG_SB`)
  } else if (infra.hasDexie) {
    lines.push(`  subgraph LOCALDATA["💾 LOCAL DATA LAYER"]`)
    lines.push(`    subgraph DEXIE_G["📦 Dexie.js · IndexedDB"]`)
    lines.push(`      IDB[("IndexedDB")]`)
    lines.push('    end\n  end')
    if (frontendRef !== undefined) lines.push(`  ${frontendRef} -.->|"dexie"| IDB`)
  } else if (infra.hasFirebase) {
    lines.push(`  subgraph DATALAYER["🔥 DATA LAYER"]`)
    lines.push(`    subgraph FIREBASE_G["Firebase · BaaS"]`)
    lines.push(`      FS[("Firestore")]`)
    lines.push('    end\n  end')
    if (frontendRef !== undefined) lines.push(`  ${frontendRef} -.->|"firebase"| FS`)
  } else if (infra.hasPrisma) {
    lines.push(`  subgraph DATALAYER["🗄 DATA LAYER"]`)
    lines.push(`    subgraph PRISMA_G["Prisma ORM"]`)
    lines.push(`      PG_DB[("Database")]`)
    lines.push('    end\n  end')
    if (frontendRef !== undefined) lines.push(`  ${frontendRef} -.->|"prisma"| PG_DB`)
  } else if (hasExternalAPI) {
    lines.push(`  subgraph DATALAYER["🔌 API LAYER"]`)
    lines.push(`    subgraph API_G["⚡ REST API · Backend"]`)
    lines.push(`      API_SVC[("Backend Service")]`)
    lines.push('    end\n  end')
    if (frontendRef !== undefined) lines.push(`  ${frontendRef} -.->|"REST"| API_SVC`)
  } else {
    // ST1: FE 어댑터에서 axios/fetch/react-query 호출(api-call edges)이 감지됐고
    // 위 모든 데이터 레이어 분기(backends/Supabase/Dexie/Firebase/Prisma/hasExternalAPI)에 해당 없으면
    // 외부 REST API Gateway 노드를 표시. React Router SPA + 다른 SPA들이 주 대상.
    // LLM enabled에서 backends가 채워지면 line 765의 `if backends.length > 0` 분기가 우선이라 충돌 없음.
    const apiCallEdges = graph.edges.filter(e => e.kind === 'api-call')
    if (apiCallEdges.length > 0 && frontendRef !== undefined) {
      const libraries = new Set<string>()
      for (const e of apiCallEdges) {
        if (e.apiCall?.library !== undefined) libraries.add(e.apiCall.library)
      }
      const libLabel = libraries.size > 0 ? Array.from(libraries).join(' · ') : 'REST'
      lines.push(`  subgraph DATALAYER["🔌 API LAYER"]`)
      lines.push(`    subgraph API_G["⚡ External REST API"]`)
      lines.push(`      API_GATEWAY[("Backend Service")]`)
      lines.push('    end\n  end')
      lines.push(`  ${frontendRef} -.->|"${libLabel}"| API_GATEWAY`)
    }
  }

  return lines.join('\n')
}
