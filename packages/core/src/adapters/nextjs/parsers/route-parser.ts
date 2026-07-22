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
  'page.tsx': 'page',
  'page.jsx': 'page',
  'page.js': 'page',
  'layout.tsx': 'layout',
  'layout.jsx': 'layout',
  'layout.js': 'layout',
  'loading.tsx': 'loading',
  'loading.jsx': 'loading',
  'loading.js': 'loading',
  'error.tsx': 'error',
  'error.jsx': 'error',
  'error.js': 'error',
  'template.tsx': 'template',
  'template.jsx': 'template',
  'template.js': 'template',
  'not-found.tsx': 'not-found',
  'not-found.jsx': 'not-found',
  'not-found.js': 'not-found',
  'route.ts': 'route-handler',
  'route.js': 'route-handler',
}

const HTTP_METHOD_RE = /export\s+(?:async\s+)?function\s+(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS)\b/g

function extractHttpMethods(content: string): string[] {
  const methods: string[] = []
  for (const m of content.matchAll(HTTP_METHOD_RE)) {
    if (m[1] !== undefined) methods.push(m[1])
  }
  return methods
}


function buildUrlPath(dirRelToApp: string): string {
  if (dirRelToApp === '') return '/'
  const segments = dirRelToApp.split('/')
  const urlSegments = segments.filter(s => !/^\(.*\)$/.test(s)).map(normalizeSegment)
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

async function findAppDir(repoRoot: string): Promise<{ dir: string; prefix: string } | null> {
  for (const candidate of ['app', 'src/app']) {
    try {
      const fullPath = path.join(repoRoot, candidate)
      await fs.access(fullPath)
      return { dir: fullPath, prefix: candidate }
    } catch {
      // not found — try next
    }
  }
  return null
}

export async function parseRoutes(repoRoot: string, analyzerVersion: string): Promise<RouteNode[]> {
  const appDirInfo = await findAppDir(repoRoot)
  if (appDirInfo === null) return []

  const { dir: appDir, prefix: appPrefix } = appDirInfo

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
      repoRelativeDir === appPrefix
        ? ''
        : repoRelativeDir.startsWith(`${appPrefix}/`)
          ? repoRelativeDir.slice(appPrefix.length + 1)
          : repoRelativeDir

    const segments = dirRelToApp === '' ? [] : dirRelToApp.split('/')

    const provenance: Provenance = {
      file: repoRelativeFile,
      line: 1,
      adapter: 'nextjs-app-router@0.1',
      analyzerVersion,
    }

    const urlPath = buildUrlPath(dirRelToApp)
    const dynType = getDynamicSegmentTypeFromSegments(segments)
    const isGroup = segments.some(s => /^\(.*\)$/.test(s))

    if (routeFileKind === 'route-handler') {
      const content = await fs.readFile(absFilePath, 'utf-8').catch(() => '')
      const methods = extractHttpMethods(content)
      if (methods.length > 0) {
        for (const method of methods) {
          nodes.push(
            createRouteNode({
              id: makeNodeId('route', repoRelativeDir, `${routeFileKind}:${method}`),
              path: urlPath,
              filePath: repoRelativeFile,
              routeFileKind,
              dynamicSegmentType: dynType,
              isGroupRoute: isGroup,
              renderingMode: 'SSR',
              httpMethod: method,
              provenance,
              confidence: 'verified',
            })
          )
        }
      } else {
        nodes.push(
          createRouteNode({
            id: makeNodeId('route', repoRelativeDir, routeFileKind),
            path: urlPath,
            filePath: repoRelativeFile,
            routeFileKind,
            dynamicSegmentType: dynType,
            isGroupRoute: isGroup,
            renderingMode: 'SSR',
            provenance,
            confidence: 'verified',
          })
        )
      }
    } else {
      nodes.push(
        createRouteNode({
          id: makeNodeId('route', repoRelativeDir, routeFileKind),
          path: urlPath,
          filePath: repoRelativeFile,
          routeFileKind,
          dynamicSegmentType: dynType,
          isGroupRoute: isGroup,
          renderingMode: await detectRenderingMode(absFilePath),
          provenance,
          confidence: 'verified',
        })
      )
    }
  }

  return nodes
}
