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

const ROUTE_FILES: Record<string, RouteFileKind> = {
  'page.tsx': 'page',
  'layout.tsx': 'layout',
  'loading.tsx': 'loading',
  'error.tsx': 'error',
  'template.tsx': 'template',
  'not-found.tsx': 'not-found',
  'route.ts': 'route-handler',
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

// Priority order: optional-catch-all > catch-all > dynamic > static
// Applied across ALL segments (not first-match per segment).
function getDynamicSegmentType(segments: string[]): DynamicSegmentType {
  if (segments.some(s => s.startsWith('[[...'))) return 'optional-catch-all'
  if (segments.some(s => s.startsWith('[...'))) return 'catch-all'
  if (segments.some(s => s.startsWith('['))) return 'dynamic'
  return 'static'
}

function buildUrlPath(dirRelToApp: string): string {
  if (dirRelToApp === '') return '/'
  const segments = dirRelToApp.split('/')
  const urlSegments = segments.filter(s => !/^\(.*\)$/.test(s))
  return urlSegments.length === 0 ? '/' : '/' + urlSegments.join('/')
}

async function detectRenderingMode(filePath: string): Promise<RenderingMode> {
  const content = await fs.readFile(filePath, 'utf-8')
  if (
    content.includes("export const dynamic = 'force-static'") ||
    content.includes('export const dynamic = "force-static"')
  ) {
    return 'SSG'
  }
  if (content.includes('export const revalidate = ')) {
    return 'ISR'
  }
  if (content.includes("'use client'") || content.includes('"use client"')) {
    return 'CSR'
  }
  return 'SSR'
}

export async function parseRoutes(repoRoot: string): Promise<RouteNode[]> {
  const appDir = path.join(repoRoot, 'app')

  let files: string[]
  try {
    files = await walkDir(appDir)
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

    const dirRelToApp =
      repoRelativeDir === 'app'
        ? ''
        : repoRelativeDir.startsWith('app/')
          ? repoRelativeDir.slice(4)
          : repoRelativeDir

    const segments = dirRelToApp === '' ? [] : dirRelToApp.split('/')

    const provenance: Provenance = {
      file: repoRelativeFile,
      line: 1,
      adapter: 'nextjs-app-router@0.1',
      analyzerVersion: 'codebase-viz@0.1.0',
    }

    nodes.push(
      createRouteNode({
        id: makeNodeId('route', repoRelativeDir, routeFileKind),
        path: buildUrlPath(dirRelToApp),
        filePath: repoRelativeFile,
        routeFileKind,
        dynamicSegmentType: getDynamicSegmentType(segments),
        isGroupRoute: segments.some(s => /^\(.*\)$/.test(s)),
        renderingMode: await detectRenderingMode(absFilePath),
        provenance,
        confidence: 'verified',
      })
    )
  }

  return nodes
}
