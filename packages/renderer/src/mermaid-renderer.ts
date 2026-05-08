import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  isRouteNode,
  isComponentNode,
  isTableNode,
  type IRGraph,
  type IREdge,
  type IRNode,
  type RouteNode,
  type ComponentNode,
  type IRGraphMetadata,
  type IRBackendService,
} from '@codebase-viz/types'
import { groupRoutesByUrl, type NestedGroup } from './url-grouper.js'
import {
  shouldChunk,
  chunkByGroups,
  joinChunks,
  CHUNK_SEPARATOR,
  DEFAULT_CHUNK_THRESHOLD,
  DEFAULT_NODE_THRESHOLD,
  type ChunkOptions,
} from './_shared/wrap-fallback.js'

function edgeArrow(edge: IREdge): string {
  return edge.confidence === 'inferred' ? '-.->' : '-->'
}

function sanitizeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, '_')
}

const RENDERING_INIT = `%%{init:{'theme':'base','themeVariables':{'background':'#060810','primaryColor':'#0c1a30','primaryTextColor':'#7dd3fc','primaryBorderColor':'#0e3a6e','edgeLabelBackground':'#0c1a30','lineColor':'#334155','secondaryColor':'#0f172a','clusterBkg':'#060c18','clusterBorder':'#1e3a5f','fontFamily':'JetBrains Mono'}}}%%`

const CLASS_DEFS = [
  `  classDef ssr fill:#0d1a0d,stroke:#16a34a,color:#86efac`,
  `  classDef csr fill:#2d1200,stroke:#c2410c,color:#fb923c`,
  `  classDef ssg fill:#1a0d1a,stroke:#7c3aed,color:#c4b5fd`,
  `  classDef isr fill:#1a1a0d,stroke:#ca8a04,color:#fde047`,
  `  classDef ppr fill:#0d1a2d,stroke:#2563eb,color:#93c5fd`,
  `  classDef unk fill:#1a1a1a,stroke:#6b7280,color:#9ca3af`,
].join('\n')

function modeClass(mode: string): string {
  const map: Record<string, string> = {
    SSR: 'ssr', CSR: 'csr', SSG: 'ssg', ISR: 'isr', PPR: 'ppr',
  }
  return map[mode] ?? 'unk'
}

function getTopSection(routePath: string): string {
  const parts = routePath.split('/').filter(Boolean)
  if (parts.length === 0) return 'root'
  const first = parts[0]
  if (first === undefined) return 'root'
  return first.replace(/^\[/, '').replace(/\]$/, '') || 'root'
}

// Convert url-grouper groupKey (e.g. "/blog", "/") to the section key used internally
// (e.g. "blog", "root"). Strips leading slash, returns "root" for empty/root.
function groupKeyToSectionKey(groupKey: string): string {
  const stripped = groupKey.replace(/^\//, '')
  return stripped || 'root'
}

function collectNestedRoutes(groups: NestedGroup[]): RouteNode[] {
  const result: RouteNode[] = []
  for (const g of groups) {
    result.push(...g.routes)
    if (g.children.length > 0) result.push(...collectNestedRoutes(g.children))
  }
  return result
}

// Flatten NestedGroup[] into a Map for buildScreenComponentDiagram (preserves one section per top-level cluster).
function buildSectionsFromRoutes(routes: RouteNode[]): Map<string, RouteNode[]> {
  const groups = groupRoutesByUrl(routes)
  const sections = new Map<string, RouteNode[]>()
  for (const group of groups) {
    const secKey = groupKeyToSectionKey(group.groupKey)
    const allRoutes = collectNestedRoutes([group])
    const existing = sections.get(secKey) ?? []
    for (const r of allRoutes) existing.push(r)
    sections.set(secKey, existing)
  }
  return sections
}

function renderingRouteLabel(r: RouteNode, ind: string): string {
  const badge = r.renderingMode === 'unknown' ? '?' : r.renderingMode
  const methodPrefix = r.httpMethod !== undefined ? `${r.httpMethod} ` : ''
  return `${ind}${sanitizeId(r.id)}["${methodPrefix}${r.path} · ${badge}"]:::${modeClass(r.renderingMode)}`
}

// Emit nested Mermaid subgraphs from NestedGroup[]. Used by buildRenderingDiagram and buildCombinedDiagram.
function buildNestedSubgraphLines(groups: NestedGroup[], indent: string): string[] {
  const lines: string[] = []
  const i2 = indent + '  '
  for (const group of groups) {
    const leafSeg = group.groupKey.split('/').filter(Boolean).pop()
    if (leafSeg === undefined) {
      for (const r of group.routes) lines.push(renderingRouteLabel(r, indent))
      if (group.children.length > 0) lines.push(...buildNestedSubgraphLines(group.children, indent))
    } else {
      const sgId = sanitizeId(leafSeg.toUpperCase()) + '_G'
      const label = sectionLabel(leafSeg)
      lines.push(`${indent}subgraph ${sgId}["${label}"]`)
      for (const r of group.routes) lines.push(renderingRouteLabel(r, i2))
      if (group.children.length > 0) lines.push(...buildNestedSubgraphLines(group.children, i2))
      lines.push(`${indent}end`)
    }
  }
  return lines
}

const SECTION_EMOJI: Record<string, string> = {
  root: '🏠',
  blog: '📝',
  project: '📁',
  projects: '📁',
  contact: '📬',
  admin: '⚙',
  auth: '🔐',
  about: '👤',
  api: '⚡',
}

function sectionLabel(key: string): string {
  const emoji = SECTION_EMOJI[key] ?? '📄'
  return `${emoji} /${key}`
}

interface InfraInfo {
  hasNextjs: boolean
  hasVite: boolean
  hasExpo: boolean
  hasSupabase: boolean
  hasDexie: boolean
  hasPrisma: boolean
  hasFirebase: boolean
}

function metadataToInfra(meta?: IRGraphMetadata): InfraInfo {
  if (meta === undefined) {
    return { hasNextjs: false, hasVite: false, hasExpo: false, hasSupabase: false, hasDexie: false, hasPrisma: false, hasFirebase: false }
  }
  const fw = meta.framework.toLowerCase()
  return {
    hasNextjs: fw === 'nextjs-app-router' || fw === 'nextjs-pages' || fw.startsWith('next'),
    hasVite: fw === 'vite-react' || fw.includes('vite'),
    hasExpo: fw === 'expo' || fw.includes('expo') || meta.deployTarget === 'mobile',
    hasSupabase: meta.hasSupabase,
    hasDexie: meta.hasDexie,
    hasPrisma: meta.hasPrisma,
    hasFirebase: meta.hasFirebase,
  }
}

function buildRouteSectionLines(sections: Map<string, RouteNode[]>, indent: string): string[] {
  const lines: string[] = []
  const i2 = indent + '  '
  for (const [secKey, nodes] of sections) {
    if (secKey === 'root') {
      for (const r of nodes) {
        const badge = r.renderingMode === 'unknown' ? '?' : r.renderingMode
        const methodPrefix = r.httpMethod !== undefined ? `${r.httpMethod} ` : ''
        lines.push(`${indent}${sanitizeId(r.id)}["${methodPrefix}${r.path} · ${badge}"]:::${modeClass(r.renderingMode)}`)
      }
    } else {
      lines.push(`${indent}subgraph ${sanitizeId(secKey.toUpperCase())}_G["${sectionLabel(secKey)}"]`)
      for (const r of nodes) {
        const badge = r.renderingMode === 'unknown' ? '?' : r.renderingMode
        lines.push(`${i2}${sanitizeId(r.id)}["${r.path} · ${badge}"]:::${modeClass(r.renderingMode)}`)
      }
      lines.push(`${indent}end`)
    }
  }
  return lines
}

const GROUPS_PER_ROW = 5

// Descend past single-child transit nodes (e.g. /api → /api/v1) to the first real branching level.
// Stops if the single node has its own routes (to avoid silently dropping them).
function findBranchingGroups(groups: NestedGroup[]): NestedGroup[] {
  if (groups.length !== 1) return groups
  const [single] = groups
  if (single === undefined || single.children.length === 0 || single.routes.length > 0) return groups
  return findBranchingGroups(single.children)
}

function chunkGroups<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
  return result
}

function buildRouteRowDiagram(groups: NestedGroup[]): string {
  const lines = [RENDERING_INIT, 'graph TD', CLASS_DEFS]
  for (const l of buildNestedSubgraphLines(groups, '  ')) lines.push(l)
  return lines.join('\n')
}

function renderScreenSection(
  pageRoutes: RouteNode[],
  allRendersEdges: IREdge[],
  importsEdges: IREdge[],
  allComponentNodes: ComponentNode[],
): string {
  const pageRouteIds = new Set(pageRoutes.map(r => r.id))
  const rowRendersEdges = allRendersEdges.filter(e => pageRouteIds.has(e.from))
  const connectedCompIds = new Set(rowRendersEdges.map(e => e.to))
  const connectedComponents = allComponentNodes.filter(c => connectedCompIds.has(c.id))

  const routeToComps = new Map<string, string[]>()
  for (const edge of rowRendersEdges) {
    if (!connectedCompIds.has(edge.to)) continue
    const list = routeToComps.get(edge.from) ?? []
    list.push(edge.to)
    routeToComps.set(edge.from, list)
  }

  const lines: string[] = [RENDERING_INIT, 'graph TB', CLASS_DEFS]
  const sections = buildSectionsFromRoutes(pageRoutes)
  const compNodeRendered = new Set<string>()
  const compNodeLines: string[] = []
  const edgesForSection: string[] = []

  for (const [secKey, nodes] of sections) {
    const subId = `${sanitizeId(secKey.toUpperCase())}_S`
    lines.push(`  subgraph ${subId}["${sectionLabel(secKey)}"]`)
    for (const r of nodes) {
      const routeNodeId = sanitizeId(r.id)
      const badge = r.renderingMode === 'unknown' ? '?' : r.renderingMode
      lines.push(`    ${routeNodeId}["${r.path} · ${badge}"]:::${modeClass(r.renderingMode)}`)
    }
    lines.push(`  end`)
    for (const r of nodes) {
      const comps = routeToComps.get(r.id) ?? []
      for (const compId of comps) {
        const edge = rowRendersEdges.find(e => e.from === r.id && e.to === compId)
        if (edge !== undefined) {
          edgesForSection.push(`  ${sanitizeId(r.id)} ${edgeArrow(edge)} ${sanitizeId(compId)}`)
        }
        if (compNodeRendered.has(compId)) continue
        compNodeRendered.add(compId)
        const comp = connectedComponents.find(c => c.id === compId)
        if (comp === undefined) continue
        const compNodeId = sanitizeId(comp.id)
        const label = comp.runtime === 'client' ? `${comp.name} [CSR]` : comp.name
        compNodeLines.push(`  ${compNodeId}["${label}"]`)
      }
    }
  }

  for (const cl of compNodeLines) lines.push(cl)
  for (const e of edgesForSection) lines.push(e)

  const connectedIdSet = new Set(connectedComponents.map(c => c.id))
  for (const edge of importsEdges) {
    if (connectedIdSet.has(edge.from) && connectedIdSet.has(edge.to)) {
      lines.push(`  ${sanitizeId(edge.from)} ${edgeArrow(edge)} ${sanitizeId(edge.to)}`)
    }
  }

  if (pageRoutes.length === 0 && connectedComponents.length === 0) {
    lines.push('  empty["(no screen/component data)"]')
  }

  return lines.join('\n')
}

function buildRenderingDiagram(graph: IRGraph): string {
  const infra = metadataToInfra(graph.metadata)
  // Only page routes — skip loading, layout, error, template, route-handler (same as Tab 2)
  const routeNodes = graph.nodes.filter(isRouteNode).filter(r => r.routeFileKind === 'page')
  if (routeNodes.length === 0) return 'graph TD\n  empty["(no routes found)"]'

  const routeGroups = groupRoutesByUrl(routeNodes)
  const branchingGroups = findBranchingGroups(routeGroups)
  if (branchingGroups.length > GROUPS_PER_ROW) {
    return joinChunks(chunkGroups(branchingGroups, GROUPS_PER_ROW).map(buildRouteRowDiagram))
  }

  const tableNodes = graph.nodes.filter(isTableNode)
  const hasDirectDB = infra.hasSupabase || infra.hasDexie || infra.hasPrisma || infra.hasFirebase
  const hasExternalAPI = tableNodes.length > 0 && !hasDirectDB
  const backends = graph.metadata?.backends ?? []
  const allCSR = routeNodes.length > 0 && routeNodes.every(r => r.renderingMode === 'CSR')

  const lines: string[] = [RENDERING_INIT, 'graph TD', CLASS_DEFS]

  // ── 1. FRONTEND LAYER ────────────────────────────────────────────────────
  // frontendRef: subgraph node ID to use as source for data layer edges.
  // undefined for backend-only frameworks (Django, Flask, SpringBoot, etc.)
  let frontendRef: string | undefined
  if (infra.hasNextjs && !allCSR) {
    frontendRef = 'REACT'
    lines.push(`  subgraph INFRA["☁ VERCEL · Edge Network"]`)
    lines.push(`    subgraph RUNTIME["⚙ Node.js · Server Runtime"]`)
    lines.push(`      subgraph FRAMEWORK["▲ Next.js · App Router"]`)
    lines.push(`        subgraph REACT["⚛ React · SSR Engine"]`)
    if (infra.hasSupabase) lines.push(`          SSR_FETCH["(SSR data fetch)"]:::unk`)
    for (const l of buildNestedSubgraphLines(routeGroups, '          ')) lines.push(l)
    lines.push('        end\n      end\n    end\n  end')
  } else if (infra.hasNextjs && allCSR) {
    frontendRef = 'REACT'
    lines.push(`  subgraph BROWSER["🌐 Browser · Client-Side App"]`)
    lines.push(`    subgraph FRAMEWORK["▲ Next.js · App Router"]`)
    lines.push(`      subgraph REACT["⚛ React · CSR Engine"]`)
    for (const l of buildNestedSubgraphLines(routeGroups, '        ')) lines.push(l)
    lines.push('      end\n    end\n  end')
  } else if (infra.hasVite) {
    frontendRef = 'REACT'
    lines.push(`  subgraph BROWSER["🌐 Browser · Client-Side App"]`)
    lines.push(`    subgraph BUNDLER["⚡ Vite · Dev/Build"]`)
    lines.push(`      subgraph REACT["⚛ React · CSR Engine"]`)
    for (const l of buildNestedSubgraphLines(routeGroups, '        ')) lines.push(l)
    lines.push('      end\n    end\n  end')
  } else if (infra.hasExpo) {
    frontendRef = 'RN'
    lines.push(`  subgraph MOBILE["📱 Mobile · iOS / Android"]`)
    lines.push(`    subgraph RN["⚛ React Native · Expo"]`)
    for (const l of buildNestedSubgraphLines(routeGroups, '      ')) lines.push(l)
    lines.push('    end\n  end')
  } else {
    for (const l of buildNestedSubgraphLines(routeGroups, '  ')) lines.push(l)
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
    const fetchSrc = (infra.hasNextjs && !allCSR) ? 'SSR_FETCH' : (frontendRef ?? 'REACT')
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
  }

  return lines.join('\n')
}

function buildScreenComponentDiagram(graph: IRGraph): string {
  const allRouteNodes = graph.nodes.filter(isRouteNode)
  const componentNodes = graph.nodes.filter(isComponentNode)

  // Only page-type routes — remove loading, layout, template, error, route-handler
  const allPageRoutes = allRouteNodes.filter(r => r.routeFileKind === 'page')

  // Build path → display route map; prefer verified (static) over inferred (LLM duplicates)
  const pathToDisplayRoute = new Map<string, RouteNode>()
  for (const r of allPageRoutes) {
    const existing = pathToDisplayRoute.get(r.path)
    if (existing === undefined || r.confidence === 'verified') {
      pathToDisplayRoute.set(r.path, r)
    }
  }
  const pageRoutes = Array.from(pathToDisplayRoute.values())
  const pageRouteIds = new Set(pageRoutes.map(r => r.id))

  // Remap renders edges: inferred/non-display routes → display route by path, deduplicate
  const seenEdgeKeys = new Set<string>()
  const rendersEdges = graph.edges
    .filter(e => e.kind === 'renders')
    .map(e => {
      if (pageRouteIds.has(e.from)) return e
      // Try to find source route in graph nodes
      const src = allRouteNodes.find(r => r.id === e.from)
      if (src !== undefined) {
        const target = pathToDisplayRoute.get(src.path)
        return target !== undefined ? { ...e, from: target.id } : null
      }
      // Source was rejected by verifier — parse URL path from ID: "route:<file>:<routePath>"
      const colonIdx = e.from.indexOf(':', 'route:'.length)
      if (e.from.startsWith('route:') && colonIdx !== -1) {
        const routePath = e.from.slice(colonIdx + 1)
        const target = pathToDisplayRoute.get(routePath)
        return target !== undefined ? { ...e, from: target.id } : null
      }
      return null
    })
    .filter((e): e is IREdge => {
      if (e === null) return false
      const key = `${e.from}:${e.to}`
      if (seenEdgeKeys.has(key)) return false
      seenEdgeKeys.add(key)
      return true
    })

  const importsEdges = graph.edges.filter(e => e.kind === 'imports')

  const routeGroups = groupRoutesByUrl(pageRoutes)
  const branchingGroups = findBranchingGroups(routeGroups)

  if (branchingGroups.length > GROUPS_PER_ROW) {
    return joinChunks(chunkGroups(branchingGroups, GROUPS_PER_ROW).map(rowGroups => {
      const rowRouteIds = new Set(collectNestedRoutes(rowGroups).map(r => r.id))
      const rowRoutes = pageRoutes.filter(r => rowRouteIds.has(r.id))
      return renderScreenSection(rowRoutes, rendersEdges, importsEdges, componentNodes)
    }))
  }

  return renderScreenSection(pageRoutes, rendersEdges, importsEdges, componentNodes)
}

const DB_DIAGRAM_INIT = `%%{init:{'theme':'base','themeVariables':{'background':'#060810','primaryColor':'#0a2030','primaryTextColor':'#e2e8f0','primaryBorderColor':'#1e4060','lineColor':'#f59e0b','secondaryColor':'#0f172a','tertiaryColor':'#1a0a20','attributeBackgroundColorEven':'#0f1e30','attributeBackgroundColorOdd':'#091624','nodeBorder':'#1e4060','clusterBkg':'#0a0e1a','fontFamily':'JetBrains Mono'}}}%%`

function getSourceLabel(node: IRNode): string | undefined {
  if (isRouteNode(node)) {
    const clean = node.path.replace(/\//g, '_').replace(/^_/, '') || 'root'
    return sanitizeId(clean)
  }
  if (isComponentNode(node)) return sanitizeId(node.name)
  return undefined
}

function buildDbScreenDiagram(graph: IRGraph): string {
  const tableNodes = graph.nodes.filter(isTableNode)
  const queriesEdges = graph.edges.filter(e => e.kind === 'queries')

  // Deduplicate query sources (routes + components that actually query tables)
  const sourcesMap = new Map<string, string>()
  for (const edge of queriesEdges) {
    if (sourcesMap.has(edge.from)) continue
    const src = graph.nodes.find(n => n.id === edge.from)
    if (src === undefined || isTableNode(src)) continue
    const label = getSourceLabel(src)
    if (label !== undefined) sourcesMap.set(edge.from, label)
  }

  const lines: string[] = [DB_DIAGRAM_INIT, 'erDiagram']

  for (const t of tableNodes) {
    const file = t.provenance.file
    if (file !== undefined && file !== '') {
      lines.push(`%% table:${sanitizeId(t.name)} path:${file}`)
    }
  }

  for (const t of tableNodes) {
    lines.push(`  ${sanitizeId(t.name)} {`)
    for (const col of t.columns) {
      const pkFlag = col.isPrimaryKey === true ? ' PK' : ''
      const fkFlag = col.references !== undefined ? ' FK' : ''
      lines.push(`    ${sanitizeId(col.type)} ${sanitizeId(col.name)}${pkFlag}${fkFlag}`)
    }
    lines.push('  }')
  }

  // Source (route/component/action) proxy entities
  for (const label of new Set(sourcesMap.values())) {
    lines.push(`  ${label} {`)
    lines.push(`    string name`)
    lines.push('  }')
  }

  // Table ↔ Table FK relationships (from ColumnDef.references)
  const tableNameSet = new Set(tableNodes.map(t => sanitizeId(t.name)))
  for (const t of tableNodes) {
    for (const col of t.columns) {
      if (col.references === undefined) continue
      const target = sanitizeId(col.references.table)
      if (tableNameSet.has(target)) {
        lines.push(`  ${sanitizeId(t.name)} }o--|| ${target} : "${col.name}"`)
      }
    }
  }

  // Source → Table queries edges
  for (const edge of queriesEdges) {
    const srcLabel = sourcesMap.get(edge.from)
    const tblNode = graph.nodes.find(n => n.id === edge.to)
    if (srcLabel === undefined || tblNode === undefined || !isTableNode(tblNode)) continue
    lines.push(`  ${srcLabel} }|--|| ${sanitizeId(tblNode.name)} : "queries"`)
  }

  return lines.join('\n')
}

function wrapMermaid(diagram: string): string {
  return `\`\`\`mermaid\n${diagram}\n\`\`\``
}

export async function renderMermaid(graph: IRGraph, outputDir: string): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true })

  const renderingDiagram = buildRenderingDiagram(graph)
  const screenComponentDiagram = buildScreenComponentDiagram(graph)
  const dbScreenDiagram = buildDbScreenDiagram(graph)

  await fs.writeFile(
    path.join(outputDir, 'rendering.md'),
    `# Rendering Architecture\n\n${wrapMermaid(renderingDiagram)}\n`,
    'utf8',
  )

  await fs.writeFile(
    path.join(outputDir, 'screen-component.md'),
    `# Screen–Component Mapping\n\n${wrapMermaid(screenComponentDiagram)}\n`,
    'utf8',
  )

  await fs.writeFile(
    path.join(outputDir, 'db-screen.md'),
    `# DB–Screen Mapping\n\n${wrapMermaid(dbScreenDiagram)}\n`,
    'utf8',
  )
}

export interface DiagramSet {
  rendering: string
  screenComponent: string
  dbScreen: string
}

export interface GroupingOptions {
  maxNodesPerGroup?: number
  maxDepth?: number
}

export interface BuildDiagramsOptions {
  grouping?: GroupingOptions
  chunkThreshold?: number
  nodeThreshold?: number
}

export const DEFAULT_GROUPING: Required<GroupingOptions> = {
  maxNodesPerGroup: 30,
  maxDepth: 8,
}

function buildWithChunkFallback(
  graph: IRGraph,
  build: (g: IRGraph) => string,
  chunkOpts: ChunkOptions,
  threshold: number,
  nodeCount = 0,
  nodeThreshold = DEFAULT_NODE_THRESHOLD,
): string {
  const text = build(graph)
  if (text.includes(CHUNK_SEPARATOR)) return text
  if (!shouldChunk(text, threshold, nodeCount, nodeThreshold)) return text
  const subGraphs = chunkByGroups(graph, chunkOpts)
  if (subGraphs.length <= 1) return text
  const parts = subGraphs.map(g => build(g))
  return joinChunks(parts)
}

const COMBINED_FALLBACK = '⚠ 결합 다이어그램 1M 초과 — Cytoscape 마이그레이션 대기 중'

function findParentRouteId(componentId: string, feGraph: IRGraph): string | undefined {
  return feGraph.edges.find(e => e.kind === 'renders' && e.to === componentId)?.from
}

export function buildCombinedDiagram(
  feGraph: IRGraph,
  beGraph: IRGraph,
  crossEdges: IREdge[],
  opts?: BuildDiagramsOptions,
): DiagramSet {
  const threshold = opts?.chunkThreshold ?? DEFAULT_CHUNK_THRESHOLD

  // Tab1: FE subgraph + BE subgraph + cross-edges
  const feRoutes = feGraph.nodes.filter(isRouteNode).filter(r => r.routeFileKind === 'page')
  const beRoutes = beGraph.nodes.filter(isRouteNode).filter(r => r.routeFileKind === 'page')

  const lines: string[] = [RENDERING_INIT, 'graph TD', CLASS_DEFS]

  // FE subgraph
  if (feRoutes.length > 0) {
    lines.push(`  subgraph FE_PROJ["🖥 Frontend · ${feGraph.projectName ?? 'FE'}"]`)
    for (const l of buildNestedSubgraphLines(groupRoutesByUrl(feRoutes), '    ')) lines.push(l)
    lines.push('  end')
  }

  // BE subgraph
  if (beRoutes.length > 0) {
    lines.push(`  subgraph BE_PROJ["⚙ Backend · ${beGraph.projectName ?? 'BE'}"]`)
    for (const l of buildNestedSubgraphLines(groupRoutesByUrl(beRoutes), '    ')) lines.push(l)
    lines.push('  end')
  }

  // Cross-edges: find parent RouteNode for ComponentNode from ids
  for (const edge of crossEdges) {
    if (edge.kind !== 'fe-be-call') continue
    const visualFrom = findParentRouteId(edge.from, feGraph) ?? edge.from
    lines.push(`  ${sanitizeId(visualFrom)} -.-> ${sanitizeId(edge.to)}`)
  }

  const renderingText = lines.join('\n')
  const totalRouteCount = feRoutes.length + beRoutes.length

  if (!shouldChunk(renderingText, threshold, totalRouteCount)) {
    return {
      rendering: renderingText,
      screenComponent: buildScreenComponentDiagram(feGraph),
      dbScreen: buildDbScreenDiagram(beGraph),
    }
  }

  return {
    rendering: `graph TD\n  fallback["${COMBINED_FALLBACK}"]`,
    screenComponent: buildScreenComponentDiagram(feGraph),
    dbScreen: buildDbScreenDiagram(beGraph),
  }
}

export function buildDiagrams(graph: IRGraph, opts?: BuildDiagramsOptions): DiagramSet {
  const chunkOpts: ChunkOptions = {
    maxNodesPerGroup: opts?.grouping?.maxNodesPerGroup ?? DEFAULT_GROUPING.maxNodesPerGroup,
    maxDepth: opts?.grouping?.maxDepth ?? DEFAULT_GROUPING.maxDepth,
  }
  const threshold = opts?.chunkThreshold ?? DEFAULT_CHUNK_THRESHOLD
  const nodeThr = opts?.nodeThreshold ?? DEFAULT_NODE_THRESHOLD
  const routeCount = graph.nodes.filter(isRouteNode).length
  return {
    rendering: buildWithChunkFallback(graph, buildRenderingDiagram, chunkOpts, threshold, routeCount, nodeThr),
    screenComponent: buildWithChunkFallback(graph, buildScreenComponentDiagram, chunkOpts, threshold, routeCount, nodeThr),
    dbScreen: buildWithChunkFallback(graph, buildDbScreenDiagram, chunkOpts, threshold, routeCount, nodeThr),
  }
}
