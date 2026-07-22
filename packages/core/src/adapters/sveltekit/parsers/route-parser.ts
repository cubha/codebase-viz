import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  createRouteNode,
  makeNodeId,
  type RouteNode,
  type RouteFileKind,
  type RenderingMode,
  type Provenance,
} from '@codebase-viz/types'
import { normalizeSegment, getDynamicSegmentTypeFromSegments } from '../../_shared/url-path-normalizer.js'
import { walkDir } from '../../_shared/file-finder.js'

const ROUTE_FILES: Record<string, RouteFileKind> = {
  '+page.svelte': 'page',
  '+layout.svelte': 'layout',
  '+server.ts': 'route-handler',
  '+server.js': 'route-handler',
  '+error.svelte': 'error',
}


// SvelteKit URL path: strip (group) segments, normalize [param] → :param
function buildUrlPath(dirRelToRoutes: string): string {
  if (dirRelToRoutes === '') return '/'
  const segments = dirRelToRoutes.split('/')
  const urlSegments = segments.filter(s => !/^\(.*\)$/.test(s)).map(normalizeSegment)
  return urlSegments.length === 0 ? '/' : '/' + urlSegments.join('/')
}

async function detectRenderingMode(absFilePath: string): Promise<RenderingMode> {
  const dir = path.dirname(absFilePath)
  const candidates = [
    path.join(dir, '+page.server.ts'),
    path.join(dir, '+page.ts'),
    absFilePath,
  ]
  for (const candidate of candidates) {
    let content: string
    try {
      content = await fs.readFile(candidate, 'utf-8')
    } catch {
      continue
    }
    if (content.includes('export const ssr = false')) return 'CSR'
    if (content.includes('export const prerender = true')) return 'SSG'
  }
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

export async function parseRoutes(repoRoot: string, analyzerVersion: string): Promise<RouteNode[]> {
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
        dynamicSegmentType: getDynamicSegmentTypeFromSegments(segments),
        isGroupRoute,
        renderingMode: await detectRenderingMode(absFilePath),
        provenance,
        confidence: 'verified',
      })
    )
  }

  return nodes
}
