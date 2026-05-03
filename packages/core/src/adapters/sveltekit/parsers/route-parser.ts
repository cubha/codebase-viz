import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  createRouteNode,
  makeNodeId,
  type RouteNode,
  type RouteFileKind,
  type DynamicSegmentType,
  type RenderingMode,
  type Provenance,
} from '@codebase-viz/types'
import { normalizeSegment } from '../../_shared/url-path-normalizer.js'

const ROUTE_FILES: Record<string, RouteFileKind> = {
  '+page.svelte': 'page',
  '+layout.svelte': 'layout',
  '+server.ts': 'route-handler',
  '+server.js': 'route-handler',
  '+error.svelte': 'error',
}

async function walkDir(dir: string): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const results: string[] = []
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const nested = await walkDir(fullPath)
      results.push(...nested)
    } else if (entry.isFile()) {
      results.push(fullPath)
    }
  }
  return results
}

// Priority: optional-catch-all > catch-all > dynamic > static
function getDynamicSegmentType(segments: string[]): DynamicSegmentType {
  if (segments.some(s => s.startsWith('[[...'))) return 'optional-catch-all'
  if (segments.some(s => s.startsWith('[...'))) return 'catch-all'
  if (segments.some(s => s.startsWith('['))) return 'dynamic'
  return 'static'
}

// SvelteKit URL path: strip (group) segments, normalize [param] → :param
function buildUrlPath(dirRelToRoutes: string): string {
  if (dirRelToRoutes === '') return '/'
  const segments = dirRelToRoutes.split('/')
  const urlSegments = segments.filter(s => !/^\(.*\)$/.test(s)).map(normalizeSegment)
  return urlSegments.length === 0 ? '/' : '/' + urlSegments.join('/')
}

async function detectRenderingMode(filePath: string): Promise<RenderingMode> {
  let content: string
  try {
    content = await fs.readFile(filePath, 'utf-8')
  } catch {
    return 'SSR'
  }
  if (content.includes('export const ssr = false')) return 'CSR'
  if (content.includes('export const prerender = true')) return 'SSG'
  return 'SSR'
}

async function findRoutesDir(repoRoot: string): Promise<{ dir: string; prefix: string } | null> {
  for (const candidate of ['src/routes', 'routes']) {
    const fullPath = path.join(repoRoot, candidate)
    try {
      await fs.access(fullPath)
      return { dir: fullPath, prefix: candidate }
    } catch {
      // not found — try next
    }
  }
  return null
}

export async function parseRoutes(repoRoot: string, analyzerVersion = 'codebase-viz@0.1.0'): Promise<RouteNode[]> {
  const routesDirInfo = await findRoutesDir(repoRoot)
  if (routesDirInfo === null) return []

  const { dir: routesDir, prefix: routesPrefix } = routesDirInfo

  let files: string[]
  try {
    files = await walkDir(routesDir)
  } catch {
    return []
  }

  const nodes: RouteNode[] = []

  for (const absFilePath of files) {
    const fileName = path.basename(absFilePath)
    const routeFileKind = ROUTE_FILES[fileName]
    if (routeFileKind === undefined) continue

    const absDir = path.dirname(absFilePath)
    const repoRelativeDir = path.relative(repoRoot, absDir).replace(/\\/g, '/')
    const repoRelativeFile = path.relative(repoRoot, absFilePath).replace(/\\/g, '/')

    const dirRelToRoutes =
      repoRelativeDir === routesPrefix
        ? ''
        : repoRelativeDir.startsWith(`${routesPrefix}/`)
          ? repoRelativeDir.slice(routesPrefix.length + 1)
          : repoRelativeDir

    const segments = dirRelToRoutes === '' ? [] : dirRelToRoutes.split('/')

    const isGroupRoute = segments.some(s => /^\(.*\)$/.test(s))

    const provenance: Provenance = {
      file: repoRelativeFile,
      line: 1,
      adapter: 'sveltekit@0.1',
      analyzerVersion,
    }

    nodes.push(
      createRouteNode({
        id: makeNodeId('route', repoRelativeDir, routeFileKind),
        path: buildUrlPath(dirRelToRoutes),
        filePath: repoRelativeFile,
        routeFileKind,
        dynamicSegmentType: getDynamicSegmentType(segments),
        isGroupRoute,
        renderingMode: await detectRenderingMode(absFilePath),
        provenance,
        confidence: 'verified',
      })
    )
  }

  return nodes
}
