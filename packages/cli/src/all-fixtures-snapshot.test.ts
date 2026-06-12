import { describe, it, expect } from 'vitest'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDefaultRegistry } from '@codebase-viz/core'
import { buildDiagrams } from '@codebase-viz/renderer'
import { detectStack } from '@codebase-viz/llm'
import { createIRGraph, EMPTY_ADAPTER_RESULT, type IRGraph, type IRNode, type IREdge } from '@codebase-viz/types'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURES = path.resolve(__dirname, '../../../fixtures')

const FIXTURE_LIST = [
  'mini-next-app',
  'mini-nuxt-app',
  'mini-sveltekit-app',
  'mini-nest-app',
  'mini-django-app',
  'mini-fastapi-app',
  'mini-spring-app',
  'mini-spring-lombok-mybatis-app',
  'mini-spring-deep-pkg-app',
  'mini-spring-wide-pkg-app',
  'mini-spring-partner-mock-app',
  'mini-flask-app',
  'mini-vue-spa-app',
  'mini-angular-app',
  'mini-remix-app',
  'mini-react-router-app',
  'mini-react-partner-mock-app',
  'mini-react-router-domain-app',
  'mini-nextpages-app',
] as const

interface GraphSummary {
  nodesByKind: Record<string, number>
  edgesByKind: Record<string, number>
  nodeIds: string[]
  edgeIds: string[]
}

function summarize(graph: IRGraph): GraphSummary {
  const nodesByKind: Record<string, number> = {}
  for (const n of graph.nodes) {
    nodesByKind[n.kind] = (nodesByKind[n.kind] ?? 0) + 1
  }
  const edgesByKind: Record<string, number> = {}
  for (const e of graph.edges) {
    edgesByKind[e.kind] = (edgesByKind[e.kind] ?? 0) + 1
  }
  return {
    nodesByKind,
    edgesByKind,
    nodeIds: graph.nodes.map((n: IRNode) => n.id).sort(),
    edgeIds: graph.edges.map((e: IREdge) => e.id).sort(),
  }
}

async function buildGraphForFixture(fixtureName: string): Promise<IRGraph> {
  const repoRoot = path.join(FIXTURES, fixtureName)
  const stack = await detectStack(repoRoot)
  const registry = createDefaultRegistry()
  const adapter = registry.get(stack.adapterId)
  const result = adapter !== undefined
    ? await adapter.analyze({ repoRoot, stack, analyzerVersion: 'codebase-viz@0.1.0' })
    : EMPTY_ADAPTER_RESULT

  return createIRGraph({
    analyzerVersion: 'codebase-viz@0.1.0',
    repoRoot,
    projectName: path.basename(repoRoot),
    metadata: {
      framework: stack.framework,
      hasSupabase: stack.hasSupabase,
      hasPrisma: stack.hasPrisma,
      hasDexie: stack.hasDexie,
      hasFirebase: false,
      ...(adapter?.category !== undefined ? { adapterCategory: adapter.category } : {}),
    },
    nodes: [
      ...result.routeNodes,
      ...result.componentNodes,
      ...result.tableNodes,
      ...(result.serverNodes ?? []),
    ],
    edges: [
      ...result.componentEdges,
      ...result.mapperEdges,
      ...(result.serverEdges ?? []),
    ],
  })
}

describe('Phase XI — fixture baseline snapshots (P1)', () => {
  for (const fixture of FIXTURE_LIST) {
    describe(fixture, { timeout: 30000 }, () => {
      it('IRGraph summary', async () => {
        const graph = await buildGraphForFixture(fixture)
        expect(summarize(graph)).toMatchSnapshot()
      })

      it('Tab1 rendering diagram', async () => {
        const graph = await buildGraphForFixture(fixture)
        const diagrams = buildDiagrams(graph)
        expect(diagrams.rendering).toMatchSnapshot()
      })

      it('Tab2 screen-component diagram', async () => {
        const graph = await buildGraphForFixture(fixture)
        const diagrams = buildDiagrams(graph)
        expect(diagrams.screenComponent).toMatchSnapshot()
      })

      it('Tab3 db-screen diagram', async () => {
        const graph = await buildGraphForFixture(fixture)
        const diagrams = buildDiagrams(graph)
        expect(diagrams.dbScreen).toMatchSnapshot()
      })
    })
  }
})
