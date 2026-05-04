import * as fs from 'node:fs/promises'
import type { Dirent } from 'node:fs'
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

async function walkRoutesDir(
  dir: string,
  baseDir: string,
): Promise<{ filePath: string; relToRoutes: string }[]> {
  const results: { filePath: string; relToRoutes: string }[] = []
  let entries: Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return results
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name as string)
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.has(entry.name)) continue
      const nested = await walkRoutesDir(fullPath, baseDir)
      results.push(...nested)
    } else if (entry.isFile()) {
      const relToRoutes = path.relative(baseDir, fullPath).replace(/\\/g, '/')
      results.push({ filePath: fullPath, relToRoutes })
    }
  }

  return results
}

function remixRelPathToRoute(
  relToRoutes: string,
): { urlPath: string; dynamicSegmentType: DynamicSegmentType } | null {
  const ext = path.extname(relToRoutes)
  if (!PAGE_EXTENSIONS.has(ext)) return null

  let p = relToRoutes.slice(0, -ext.length).replace(/\\/g, '/')

  // _index → '' (인덱스 라우트), index → ''
  p = p.replace(/(^|\/)_?index$/, '')

  // 폴더 구분자는 이미 /가 있으므로, 각 세그먼트의 dot-notation만 변환
  const segments = p.split('/')
  const processedSegments = segments.map(seg => {
    const parts = seg.split('.')
    const routeParts = parts
      .filter(part => !part.startsWith('_'))  // strip pathless layout prefixes like _auth
      .map(part => part.replace(/\$(\w+)/g, ':$1'))  // $id → :id
    return routeParts.join('/')
  })

  const joined = processedSegments.filter(Boolean).join('/')
  const urlPath = '/' + joined
  const clean = urlPath === '//' ? '/' : urlPath.replace(/\/+$/, '') || '/'

  const dynamicSegmentType: DynamicSegmentType = clean.includes(':') ? 'dynamic' : 'static'
  return { urlPath: clean, dynamicSegmentType }
}

export async function parseRemixRoutes(
  repoRoot: string,
  analyzerVersion: string,
): Promise<RouteNode[]> {
  const routesDir = await (async () => {
    const p = path.join(repoRoot, 'app/routes')
    try {
      await fs.access(p)
      return p
    } catch {
      return null
    }
  })()

  if (routesDir === null) return []

  const files = await walkRoutesDir(routesDir, routesDir)
  const routes: RouteNode[] = []

  for (const { filePath, relToRoutes } of files) {
    const routeInfo = remixRelPathToRoute(relToRoutes)
    if (routeInfo === null) continue

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
