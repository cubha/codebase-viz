import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  createRouteNode,
  makeNodeId,
  type RouteNode,
  type DynamicSegmentType,
  type Provenance,
} from '@codebase-viz/types'

const PAGE_EXTENSIONS = new Set(['.tsx', '.ts', '.jsx', '.js'])
const EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'build', '.cache'])

function remixFileToRoute(filename: string): { urlPath: string; dynamicSegmentType: DynamicSegmentType } | null {
  const ext = path.extname(filename)
  if (!PAGE_EXTENSIONS.has(ext)) return null

  let name = filename.slice(0, -ext.length)

  // _index.tsx → / (index route)
  if (name === '_index') return { urlPath: '/', dynamicSegmentType: 'static' }

  // Remix v2 dot-separated segments: users.$id.tsx → /users/:id
  // Underscore prefix = layout route without path segment
  name = name
    .replace(/^_/, '')           // remove leading underscore (pathless layout)
    .replace(/\$(\w+)/g, ':$1')  // $id → :id
    .replace(/\./g, '/')         // . → /

  const urlPath = '/' + name
  const dynamicSegmentType: DynamicSegmentType = urlPath.includes(':') ? 'dynamic' : 'static'
  return { urlPath, dynamicSegmentType }
}

export async function parseRemixRoutes(
  repoRoot: string,
  analyzerVersion: string,
): Promise<RouteNode[]> {
  const routesDir = await (async () => {
    for (const candidate of ['app/routes', 'app']) {
      const p = path.join(repoRoot, candidate)
      try {
        await fs.access(p)
        return p
      } catch { /* skip */ }
    }
    return null
  })()

  if (routesDir === null) return []

  const entries = await fs.readdir(routesDir, { withFileTypes: true }).catch(() => [])
  const routes: RouteNode[] = []

  for (const entry of entries) {
    if (!entry.isFile()) continue

    const routeInfo = remixFileToRoute(entry.name)
    if (routeInfo === null) continue

    const filePath = path.join(routesDir, entry.name)
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')

    const provenance: Provenance = {
      file: relPath,
      line: 1,
      adapter: 'remix@0.1',
      analyzerVersion,
    }

    routes.push(
      createRouteNode({
        id: makeNodeId('route', relPath, 'page'),
        path: routeInfo.urlPath,
        filePath: relPath,
        routeFileKind: 'page',
        dynamicSegmentType: routeInfo.dynamicSegmentType,
        isGroupRoute: false,
        renderingMode: 'SSR',
        provenance,
        confidence: 'verified',
      }),
    )
  }

  return routes
}
