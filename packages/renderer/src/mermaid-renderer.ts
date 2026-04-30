import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  isRouteNode,
  isComponentNode,
  isTableNode,
  type IRGraph,
  type IREdge,
} from '@codebase-viz/types'

function edgeArrow(edge: IREdge): string {
  return edge.confidence === 'inferred' ? '--.->' : '-->'
}

function sanitizeId(s: string): string {
  return s.replace(/[^a-zA-Z0-9_]/g, '_')
}

function buildRenderingDiagram(graph: IRGraph): string {
  const routeNodes = graph.nodes.filter(isRouteNode)
  if (routeNodes.length === 0) return 'graph TD\n  empty["(no routes found)"]'

  const lines: string[] = ['graph TD']
  for (const r of routeNodes) {
    const nodeId = sanitizeId(r.id)
    const badge = r.renderingMode === 'unknown' ? '?' : r.renderingMode
    const label = `${r.path} [${r.routeFileKind}|${badge}]`
    lines.push(`  ${nodeId}["${label}"]`)
  }
  return lines.join('\n')
}

function buildScreenComponentDiagram(graph: IRGraph): string {
  const routeNodes = graph.nodes.filter(isRouteNode)
  const componentNodes = graph.nodes.filter(isComponentNode)
  const relevantEdges = graph.edges.filter(e => e.kind === 'renders' || e.kind === 'imports')

  const lines: string[] = ['graph LR']

  for (const r of routeNodes) {
    const nodeId = sanitizeId(r.id)
    lines.push(`  ${nodeId}["${r.path} [${r.routeFileKind}]"]`)
  }
  for (const c of componentNodes) {
    const nodeId = sanitizeId(c.id)
    const label = c.runtime === 'client' ? `${c.name} [CSR]` : c.name
    lines.push(`  ${nodeId}["${label}"]`)
  }

  for (const edge of relevantEdges) {
    const fromId = sanitizeId(edge.from)
    const toId = sanitizeId(edge.to)
    const arrow = edgeArrow(edge)
    lines.push(`  ${fromId} ${arrow} ${toId}`)
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
