import * as path from 'node:path'
import {
  createIRGraph,
  type IAdapter,
  type AdapterContext,
  type AdapterResult,
} from '@codebase-viz/types'
import { parseRoutes } from './parsers/route-parser.js'
import { parseComponents } from './parsers/component-parser.js'
import { parseTables } from './parsers/db-parser.js'
import { mapScreenToTable, mapServerFilesToTable } from './mapper/screen-mapper.js'
import { detectTsOrmTables } from '../../db/index.js'

export class NextJsAdapter implements IAdapter {
  readonly id = 'nextjs-app-router'
  readonly framework = 'nextjs-app-router' as const
  readonly parsingLevel = 'L1' as const

  async analyze(ctx: AdapterContext): Promise<AdapterResult> {
    const { repoRoot, analyzerVersion } = ctx

    const [routeNodes, components, supabaseTables, ormTables] = await Promise.all([
      parseRoutes(repoRoot),
      parseComponents(repoRoot),
      parseTables(repoRoot),
      detectTsOrmTables(repoRoot, analyzerVersion),
    ])
    const tableNodes = [...supabaseTables, ...ormTables]

    // mapScreenToTable expects IRGraph; build an in-memory graph just for mapping.
    const tempGraph = createIRGraph({
      analyzerVersion,
      repoRoot,
      projectName: path.basename(repoRoot),
      nodes: [...routeNodes, ...components.nodes, ...tableNodes],
      edges: components.edges,
    })

    const mapperEdges = await mapScreenToTable(tempGraph)
    const serverFiles = await mapServerFilesToTable(repoRoot, tableNodes)

    return {
      routeNodes,
      componentNodes: components.nodes,
      componentEdges: components.edges,
      tableNodes,
      mapperEdges,
      serverNodes: serverFiles.nodes,
      serverEdges: serverFiles.edges,
    }
  }
}

export const nextJsAdapter = new NextJsAdapter()
