import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  isRouteNode,
  isComponentNode,
  isTableNode,
  type IRGraph,
  type IREdge,
  type RouteNode,
} from '@codebase-viz/types'

function edgeArrow(edge: IREdge): string {
  return edge.confidence === 'inferred' ? '-.->' : '-->'
}

function sanitizeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, '_')
}

const RENDERING_INIT = `%%{init:{'theme':'base','themeVariables':{'background':'#060810','primaryColor':'#0c1a30','primaryTextColor':'#7dd3fc','edgeLabelBackground':'#0c1a30','lineColor':'#2563eb'}}}%%`

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
  // strip dynamic segments from section key
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

function buildRenderingDiagram(graph: IRGraph): string {
  const routeNodes = graph.nodes.filter(isRouteNode)
  if (routeNodes.length === 0) return 'graph TD\n  empty["(no routes found)"]'

  // Group routes into sections by top-level path segment
  const sections = new Map<string, RouteNode[]>()
  for (const r of routeNodes) {
    const sec = getTopSection(r.path)
    const existing = sections.get(sec) ?? []
    existing.push(r)
    sections.set(sec, existing)
  }

  const lines: string[] = [RENDERING_INIT, 'graph TD', CLASS_DEFS]

  if (sections.size === 1 && sections.has('root')) {
    // Single section — flat output
    for (const r of routeNodes) {
      const nodeId = sanitizeId(r.id)
      const badge = r.renderingMode === 'unknown' ? '?' : r.renderingMode
      const label = `${r.path} · ${badge}`
      lines.push(`  ${nodeId}["${label}"]:::${modeClass(r.renderingMode)}`)
    }
  } else {
    // Multi-section — subgraph per section
    for (const [secKey, nodes] of sections) {
      if (secKey === 'root') {
        // Root routes inline (no subgraph wrapper)
        for (const r of nodes) {
          const nodeId = sanitizeId(r.id)
          const badge = r.renderingMode === 'unknown' ? '?' : r.renderingMode
          lines.push(`  ${nodeId}["${r.path} · ${badge}"]:::${modeClass(r.renderingMode)}`)
        }
      } else {
        const subId = `${secKey.toUpperCase()}_G`
        lines.push(`  subgraph ${subId}["${sectionLabel(secKey)}"]`)
        for (const r of nodes) {
          const nodeId = sanitizeId(r.id)
          const badge = r.renderingMode === 'unknown' ? '?' : r.renderingMode
          lines.push(`    ${nodeId}["${r.path} · ${badge}"]:::${modeClass(r.renderingMode)}`)
        }
        lines.push('  end')
      }
    }
  }

  return lines.join('\n')
}

function buildScreenComponentDiagram(graph: IRGraph): string {
  const routeNodes = graph.nodes.filter(isRouteNode)
  const componentNodes = graph.nodes.filter(isComponentNode)
  const relevantEdges = graph.edges.filter(e => e.kind === 'renders' || e.kind === 'imports')

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

  for (const c of componentNodes) {
    const nodeId = sanitizeId(c.id)
    const label = c.runtime === 'client' ? `${c.name} [CSR]` : c.name
    lines.push(`  ${nodeId}["${label}"]`)
  }

  for (const edge of relevantEdges) {
    const fromId = sanitizeId(edge.from)
    const toId = sanitizeId(edge.to)
    lines.push(`  ${fromId} ${edgeArrow(edge)} ${toId}`)
  }

  if (routeNodes.length === 0 && componentNodes.length === 0) {
    lines.push('  empty["(no screen/component data)"]')
  }

  return lines.join('\n')
}

function buildDbScreenDiagram(graph: IRGraph): string {
  const tableNodes = graph.nodes.filter(isTableNode)
  const queriesEdges = graph.edges.filter(e => e.kind === 'queries')

  const involvedComponentIds = new Set(queriesEdges.map(e => e.from))
  const involvedComponentNodes = graph.nodes.filter(
    n => isComponentNode(n) && involvedComponentIds.has(n.id),
  )

  const lines: string[] = ['erDiagram']

  for (const t of tableNodes) {
    lines.push(`  ${sanitizeId(t.name)} {`)
    for (const col of t.columns.slice(0, 5)) {
      lines.push(`    ${col.type} ${sanitizeId(col.name)}`)
    }
    lines.push('  }')
  }

  for (const c of involvedComponentNodes) {
    if (!isComponentNode(c)) continue
    lines.push(`  ${sanitizeId(c.name)} {`)
    lines.push(`    string name`)
    lines.push('  }')
  }

  for (const edge of queriesEdges) {
    const componentNode = graph.nodes.find(n => n.id === edge.from)
    const tableNode = graph.nodes.find(n => n.id === edge.to)
    if (componentNode === undefined || tableNode === undefined) continue
    if (!isComponentNode(componentNode) || !isTableNode(tableNode)) continue

    const rel = edge.confidence === 'inferred' ? '}|..|{' : '}|--||'
    lines.push(
      `  ${sanitizeId(componentNode.name)} ${rel} ${sanitizeId(tableNode.name)} : "queries"`,
    )
  }

  if (tableNodes.length === 0) {
    lines.push('  NoTables["(no tables found)"] {')
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
