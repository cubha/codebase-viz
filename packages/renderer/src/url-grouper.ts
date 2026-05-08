import type { RouteNode } from '@codebase-viz/types'

export interface NestedGroup {
  groupKey: string
  routes: RouteNode[]
  children: NestedGroup[]
}

export interface GroupingOpts {
  maxDepth?: number
  minGroupSize?: number
}

// Split a URL path into non-empty segments.
// "/api/v1/users" → ["api", "v1", "users"]
function pathSegments(p: string): string[] {
  return p.split('/').filter(Boolean)
}

// Compute segment-wise LCP of all paths.
// Returns the common prefix as a joined path (e.g. "/api/v1"), or "" when no common prefix.
function segmentLcp(paths: string[]): string {
  if (paths.length === 0) return ''
  const segmented = paths.map(pathSegments)
  const first = segmented[0] ?? []
  const result: string[] = []
  for (let i = 0; i < first.length; i++) {
    const seg = first[i]
    if (segmented.every(segs => segs[i] === seg)) {
      result.push(seg!)
    } else {
      break
    }
  }
  return result.length > 0 ? '/' + result.join('/') : ''
}

function groupRoutesRecursive(
  routes: RouteNode[],
  parentPrefix: string,
  depth: number,
  maxDepth: number,
  minGroupSize: number,
): NestedGroup[] {
  if (routes.length === 0) return []

  // Compute relative paths (strip parent prefix)
  const relPaths = routes.map(r => {
    const rel = r.path.startsWith(parentPrefix) ? r.path.slice(parentPrefix.length) : r.path
    return rel === '' ? '/' : rel
  })

  // Find LCP among non-root relative paths
  const nonRootRel = relPaths.filter(p => p !== '/')
  const relLcp = nonRootRel.length > 0 ? segmentLcp(nonRootRel) : ''
  const fullGroupKey = relLcp !== '' ? (parentPrefix + relLcp).replace(/\/+/g, '/') : ''

  if (relLcp !== '') {
    const exactRoutes = routes.filter(r => r.path === fullGroupKey)
    const deeperRoutes = routes.filter(r => r.path !== fullGroupKey)
    // Recurse only when the total group is large enough and we haven't hit maxDepth
    const shouldRecurse = depth < maxDepth && routes.length > minGroupSize

    if (!shouldRecurse || deeperRoutes.length === 0) {
      return [{ groupKey: fullGroupKey, routes: [...routes], children: [] }]
    }

    return [{
      groupKey: fullGroupKey,
      routes: exactRoutes,
      children: groupRoutesRecursive(deeperRoutes, fullGroupKey, depth + 1, maxDepth, minGroupSize),
    }]
  }

  // No shared LCP — cluster by first remaining segment
  const clusterMap = new Map<string, RouteNode[]>()
  for (let i = 0; i < routes.length; i++) {
    const r = routes[i]!
    const rel = relPaths[i]!
    const segs = rel.split('/').filter(Boolean)
    const seg = segs[0]
    const clusterKey = seg
      ? (parentPrefix + '/' + seg).replace(/\/+/g, '/')
      : (parentPrefix || '/')
    const existing = clusterMap.get(clusterKey) ?? []
    existing.push(r)
    clusterMap.set(clusterKey, existing)
  }

  return Array.from(clusterMap.entries()).map(([clusterKey, clusterRoutes]) => {
    const exactRoutes = clusterRoutes.filter(r => r.path === clusterKey)
    const deeperRoutes = clusterRoutes.filter(r => r.path !== clusterKey)
    // Each cluster checks its own size for recursion
    const shouldRecurseCluster = depth < maxDepth && clusterRoutes.length > minGroupSize

    if (!shouldRecurseCluster || deeperRoutes.length === 0) {
      return { groupKey: clusterKey, routes: clusterRoutes, children: [] }
    }

    return {
      groupKey: clusterKey,
      routes: exactRoutes,
      children: groupRoutesRecursive(deeperRoutes, clusterKey, depth + 1, maxDepth, minGroupSize),
    }
  })
}

export function groupRoutesByUrl(
  routes: RouteNode[],
  opts?: GroupingOpts,
): NestedGroup[] {
  const maxDepth = opts?.maxDepth ?? 8
  const minGroupSize = opts?.minGroupSize ?? 3
  return groupRoutesRecursive(routes, '', 0, maxDepth, minGroupSize)
}
