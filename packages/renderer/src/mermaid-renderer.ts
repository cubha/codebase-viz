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
} from '@codebase-viz/types'

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
  nextVersion?: string
  reactVersion?: string
  hasSupabase: boolean
}

async function detectInfra(repoRoot: string): Promise<InfraInfo> {
  try {
    const raw = await fs.readFile(path.join(repoRoot, 'package.json'), 'utf-8')
    const pkg = JSON.parse(raw) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    const majorVer = (name: string): string | undefined => {
      const v = deps[name]
      return v ? v.replace(/[^0-9.]/g, '').split('.')[0] : undefined
    }
    const result: InfraInfo = {
      hasNextjs: 'next' in deps,
      hasSupabase: '@supabase/supabase-js' in deps || '@supabase/ssr' in deps,
    }
    const nextVer = majorVer('next')
    const reactVer = majorVer('react')
    if (nextVer !== undefined) result.nextVersion = nextVer
    if (reactVer !== undefined) result.reactVersion = reactVer
    return result
  } catch {
    return { hasNextjs: false, hasSupabase: false }
  }
}

function buildRouteSectionLines(sections: Map<string, RouteNode[]>, indent: string): string[] {
  const lines: string[] = []
  const i2 = indent + '  '
  for (const [secKey, nodes] of sections) {
    if (secKey === 'root') {
      for (const r of nodes) {
        const badge = r.renderingMode === 'unknown' ? '?' : r.renderingMode
        lines.push(`${indent}${sanitizeId(r.id)}["${r.path} · ${badge}"]:::${modeClass(r.renderingMode)}`)
      }
    } else {
      lines.push(`${indent}subgraph ${secKey.toUpperCase()}_G["${sectionLabel(secKey)}"]`)
      for (const r of nodes) {
        const badge = r.renderingMode === 'unknown' ? '?' : r.renderingMode
        lines.push(`${i2}${sanitizeId(r.id)}["${r.path} · ${badge}"]:::${modeClass(r.renderingMode)}`)
      }
      lines.push(`${indent}end`)
    }
  }
  return lines
}

function buildRenderingDiagram(graph: IRGraph, infra?: InfraInfo): string {
  const routeNodes = graph.nodes.filter(isRouteNode)
  if (routeNodes.length === 0) return 'graph TD\n  empty["(no routes found)"]'

  const sections = new Map<string, RouteNode[]>()
  for (const r of routeNodes) {
    const sec = getTopSection(r.path)
    const existing = sections.get(sec) ?? []
    existing.push(r)
    sections.set(sec, existing)
  }

  const lines: string[] = [RENDERING_INIT, 'graph TD', CLASS_DEFS]

  if (infra?.hasNextjs) {
    const nextLabel = infra.nextVersion ? ` ${infra.nextVersion}` : ''
    const reactLabel = infra.reactVersion ? ` ${infra.reactVersion}` : ''
    lines.push(`  subgraph INFRA["☁ VERCEL · Edge Network"]`)
    lines.push(`    subgraph RUNTIME["⚙ Node.js · Server Runtime"]`)
    lines.push(`      subgraph FRAMEWORK["▲ Next.js${nextLabel} · App Router"]`)
    lines.push(`        subgraph REACT["⚛ React${reactLabel} · SSR Engine"]`)
    if (infra.hasSupabase) {
      lines.push(`          SSR_FETCH["(SSR data fetch)"]:::unk`)
    }
    const singleSection = sections.size === 1 && sections.has('root')
    const routeIndent = singleSection ? '          ' : '          '
    for (const l of buildRouteSectionLines(sections, routeIndent)) lines.push(l)
    lines.push('        end')
    lines.push('      end')
    lines.push('    end')
    lines.push('  end')
    if (infra.hasSupabase) {
      lines.push(`  subgraph DATALAYER["🗄 DATA LAYER"]`)
      lines.push(`    subgraph SUPABASE_G["⚡ Supabase · BaaS"]`)
      lines.push(`      PG_SB[("PostgreSQL")]`)
      lines.push(`      SB_AUTH["Auth · OAuth"]`)
      lines.push('    end')
      lines.push('  end')
      lines.push('  SSR_FETCH -.->|"supabase-js"| PG_SB')
    }
  } else {
    for (const l of buildRouteSectionLines(sections, '  ')) lines.push(l)
  }

  return lines.join('\n')
}

function buildScreenComponentDiagram(graph: IRGraph): string {
  const routeNodes = graph.nodes.filter(isRouteNode)
  const componentNodes = graph.nodes.filter(isComponentNode)
  const rendersEdges = graph.edges.filter(e => e.kind === 'renders')
  const importsEdges = graph.edges.filter(e => e.kind === 'imports')

  // Only show components that have at least one renders edge pointing to them
  const connectedCompIds = new Set(rendersEdges.map(e => e.to))
  const connectedComponents = componentNodes.filter(c => connectedCompIds.has(c.id))

  const lines: string[] = [RENDERING_INIT, 'graph LR', CLASS_DEFS]

  // Group routes by section
  const sections = new Map<string, RouteNode[]>()
  for (const r of routeNodes) {
    const sec = getTopSection(r.path)
    const existing = sections.get(sec) ?? []
    existing.push(r)
    sections.set(sec, existing)
  }

  if (sections.size > 1) {
    for (const [secKey, nodes] of sections) {
      const subId = `${secKey.toUpperCase()}_S`
      lines.push(`  subgraph ${subId}["${sectionLabel(secKey)}"]`)
      for (const r of nodes) {
        const nodeId = sanitizeId(r.id)
        const badge = r.renderingMode === 'unknown' ? '?' : r.renderingMode
        lines.push(`    ${nodeId}["${r.path} · ${badge}"]:::${modeClass(r.renderingMode)}`)
      }
      lines.push('  end')
    }
  } else {
    for (const r of routeNodes) {
      const nodeId = sanitizeId(r.id)
      lines.push(`  ${nodeId}["${r.path} [${r.routeFileKind}]"]:::${modeClass(r.renderingMode)}`)
    }
  }

  for (const c of connectedComponents) {
    const nodeId = sanitizeId(c.id)
    const label = c.runtime === 'client' ? `${c.name} [CSR]` : c.name
    lines.push(`  ${nodeId}["${label}"]`)
  }

  for (const edge of rendersEdges) {
    const fromId = sanitizeId(edge.from)
    const toId = sanitizeId(edge.to)
    if (connectedCompIds.has(edge.to)) {
      lines.push(`  ${fromId} ${edgeArrow(edge)} ${toId}`)
    }
  }

  // imports edges between connected components only
  const connectedIdSet = new Set(connectedComponents.map(c => c.id))
  for (const edge of importsEdges) {
    if (connectedIdSet.has(edge.from) && connectedIdSet.has(edge.to)) {
      lines.push(`  ${sanitizeId(edge.from)} ${edgeArrow(edge)} ${sanitizeId(edge.to)}`)
    }
  }

  if (routeNodes.length === 0 && connectedComponents.length === 0) {
    lines.push('  empty["(no screen/component data)"]')
  }

  return lines.join('\n')
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

  // Table entities — up to 8 columns with PK/FK flags
  for (const t of tableNodes) {
    lines.push(`  ${sanitizeId(t.name)} {`)
    for (const col of t.columns.slice(0, 8)) {
      const pkFlag = col.isPrimaryKey === true ? ' PK' : ''
      const fkFlag = col.references !== undefined ? ' FK' : ''
      lines.push(`    ${col.type} ${sanitizeId(col.name)}${pkFlag}${fkFlag}`)
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

  if (tableNodes.length === 0) {
    lines.push('  NoTables {')
    lines.push('    string placeholder')
    lines.push('  }')
  }

  return lines.join('\n')
}

function wrapMermaid(diagram: string): string {
  return `\`\`\`mermaid\n${diagram}\n\`\`\``
}

export async function renderMermaid(graph: IRGraph, outputDir: string): Promise<void> {
  await fs.mkdir(outputDir, { recursive: true })

  const infra = await detectInfra(graph.repoRoot)
  const renderingDiagram = buildRenderingDiagram(graph, infra)
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
