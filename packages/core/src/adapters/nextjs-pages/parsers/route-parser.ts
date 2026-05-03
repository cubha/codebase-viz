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
const EXCLUDE_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build'])

function fileToRoute(relToPages: string): { urlPath: string; dynamicSegmentType: DynamicSegmentType } | null {
  const ext = path.extname(relToPages)
  if (!PAGE_EXTENSIONS.has(ext)) return null

  let p = relToPages.slice(0, -ext.length)

  // Skip API routes
  if (p.startsWith('api/') || p.startsWith('api\\')) return null

  // index → /
  p = p.replace(/\/index$/, '').replace(/\\index$/, '').replace(/^index$/, '')

  // [param] → :param, [...param] → :param*, [[...param]] → :param?
  p = p
    .replace(/\[\[\.\.\.(\w+)\]\]/g, ':$1?')
    .replace(/\[\.\.\.(\w+)\]/g, ':$1*')
    .replace(/\[(\w+)\]/g, ':$1')

  const urlPath = '/' + p.replace(/\\/g, '/')
  const clean = urlPath === '//' ? '/' : urlPath.replace(/\/+$/, '') || '/'

  const dynamicSegmentType: DynamicSegmentType =
    clean.includes(':') ? 'dynamic' : 'static'

  return { urlPath: clean, dynamicSegmentType }
}

async function walkPages(pagesDir: string): Promise<string[]> {
  const results: string[] = []
  async function recurse(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (entries === null) return
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (!EXCLUDE_DIRS.has(entry.name)) await recurse(fullPath)
      } else if (entry.isFile()) {
        results.push(fullPath)
      }
    }
  }
  await recurse(pagesDir)
  return results
}

export async function parseNextPagesRoutes(
  repoRoot: string,
  analyzerVersion: string,
): Promise<RouteNode[]> {
  const pagesDir = await (async () => {
    for (const candidate of ['pages', 'src/pages']) {
      const p = path.join(repoRoot, candidate)
      try {
        await fs.access(p)
        return p
      } catch { /* skip */ }
    }
    return null
  })()

  if (pagesDir === null) return []

  const files = await walkPages(pagesDir)
  const routes: RouteNode[] = []

  for (const filePath of files) {
    const relToPages = path.relative(pagesDir, filePath)
    const routeInfo = fileToRoute(relToPages)
    if (routeInfo === null) continue

    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
    const provenance: Provenance = {
      file: relPath,
      line: 1,
      adapter: 'nextjs-pages@0.1',
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
