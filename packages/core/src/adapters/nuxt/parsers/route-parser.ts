import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  createRouteNode,
  makeNodeId,
  type RouteNode,
  type DynamicSegmentType,
  type Provenance,
  type RenderingMode,
} from '@codebase-viz/types'

const NUXT_EXTENSIONS = new Set(['.vue', '.ts', '.tsx', '.js', '.jsx'])

const DEFINE_PAGE_META_SSR_RE = /definePageMeta\s*\(\s*\{[^}]*?\bssr\s*:\s*(true|false)/s

async function getVueRenderingMode(absFilePath: string): Promise<RenderingMode> {
  if (!absFilePath.endsWith('.vue')) return 'SSR'
  const content = await fs.readFile(absFilePath, 'utf-8').catch(() => null)
  if (content === null) return 'SSR'
  const match = DEFINE_PAGE_META_SSR_RE.exec(content)
  if (match === null) return 'SSR'
  return match[1] === 'false' ? 'CSR' : 'SSR'
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

// Nuxt: pages/index.vue → /, pages/about.vue → /about
// pages/users/[id].vue → /users/:id, pages/blog/[...slug].vue → /blog/:slug*
function buildUrlPath(fileRelToPages: string): string {
  const withoutExt = fileRelToPages.replace(/\.[^/.]+$/, '')
  const segments = withoutExt.split('/')

  const urlSegments = segments.map(seg => {
    if (seg.startsWith('[...')) {
      // catch-all: [...slug] → :slug*
      const param = seg.slice(4, -1)
      return `:${param}*`
    }
    if (seg.startsWith('[')) {
      // dynamic: [id] → :id
      const param = seg.slice(1, -1)
      return `:${param}`
    }
    return seg
  })

  // index → parent directory path
  const lastIdx = urlSegments.length - 1
  if (urlSegments[lastIdx] === 'index') {
    urlSegments.splice(lastIdx, 1)
  }

  if (urlSegments.length === 0) return '/'
  return '/' + urlSegments.join('/')
}

function getDynamicSegmentType(fileRelToPages: string): DynamicSegmentType {
  const withoutExt = fileRelToPages.replace(/\.[^/.]+$/, '')
  const segments = withoutExt.split('/')
  if (segments.some(s => s.startsWith('[...'))) return 'catch-all'
  if (segments.some(s => s.startsWith('['))) return 'dynamic'
  return 'static'
}

// Resolve pages/ or app/pages/ — Nuxt 4+ compat.
async function findPagesDir(repoRoot: string): Promise<string | null> {
  for (const candidate of ['pages', 'app/pages']) {
    try {
      const fullPath = path.join(repoRoot, candidate)
      await fs.access(fullPath)
      return fullPath
    } catch {
      // not found — try next
    }
  }
  return null
}

export async function parseRoutes(repoRoot: string, analyzerVersion = 'codebase-viz@0.1.0'): Promise<RouteNode[]> {
  const pagesDir = await findPagesDir(repoRoot)
  if (pagesDir === null) return []

  let files: string[]
  try {
    files = await walkDir(pagesDir)
  } catch {
    return []
  }

  const nodes: RouteNode[] = []

  for (const absFilePath of files) {
    const ext = path.extname(absFilePath)
    if (!NUXT_EXTENSIONS.has(ext)) continue

    const repoRelativeFile = path.relative(repoRoot, absFilePath).replace(/\\/g, '/')
    const fileRelToPages = path.relative(pagesDir, absFilePath).replace(/\\/g, '/')

    const urlPath = buildUrlPath(fileRelToPages)
    const dynamicSegmentType = getDynamicSegmentType(fileRelToPages)

    const repoRelativeDir = path.relative(repoRoot, path.dirname(absFilePath)).replace(/\\/g, '/')

    const provenance: Provenance = {
      file: repoRelativeFile,
      line: 1,
      adapter: 'nuxt@0.1',
      analyzerVersion,
    }

    const renderingMode = await getVueRenderingMode(absFilePath)

    nodes.push(
      createRouteNode({
        id: makeNodeId('route', repoRelativeDir, path.basename(absFilePath)),
        path: urlPath,
        filePath: repoRelativeFile,
        routeFileKind: 'page',
        dynamicSegmentType,
        isGroupRoute: false,
        renderingMode,
        provenance,
        confidence: 'verified',
      })
    )
  }

  return nodes
}
