// ─── Branded Identifiers ─────────────────────────────────────────────────────
// Branded types prevent arbitrary strings from being assigned without going
// through the factory functions. `as NodeId` casts are only in makeNodeId.
export type NodeId = string & { readonly __brand: 'NodeId' }
export type EdgeId = string & { readonly __brand: 'EdgeId' }

// ─── SourceLocation ──────────────────────────────────────────────────────────
// Zero-based row/column from tree-sitter AST nodes.
export interface SourceLocation {
  row: number     // 0-based
  column: number  // 0-based
}

// ─── Provenance ──────────────────────────────────────────────────────────────
// All `file` paths are repo-relative. The absolute base lives on IRGraph.repoRoot.
export interface Provenance {
  file: string            // repo-relative, e.g. "src/app/blog/page.tsx"
  line: number            // 1-based
  adapter: string         // e.g. "nextjs-app-router@0.1"
  analyzerVersion: string // e.g. "codebase-viz@0.1.0"
}

// Converts a tree-sitter AST node start position to Provenance.
export function astToProvenance(
  repoRelativePath: string,
  startPosition: SourceLocation,
  adapter: string,
  analyzerVersion: string,
): Provenance {
  return {
    file: repoRelativePath,
    line: startPosition.row + 1,
    adapter,
    analyzerVersion,
  }
}

// ─── Confidence (discriminated) ───────────────────────────────────────────────
// `inferenceChain` is structurally required for 'inferred' and absent for others.
// This enforces Absolute Principle 2 (Evidence-First) at the type level.
export type ConfidenceInfo =
  | { confidence: 'verified' | 'manual' }
  | { confidence: 'inferred'; inferenceChain: string[] }

// ─── RouteNode ────────────────────────────────────────────────────────────────
// Covers all Next.js App Router special files in a single node kind.
export type RouteFileKind =
  | 'page'
  | 'layout'
  | 'loading'
  | 'error'
  | 'template'
  | 'not-found'
  | 'route-handler'  // API route (route.ts)

// 'static' = no dynamic segment, 'dynamic' = [slug], 'catch-all' = [...slug],
// 'optional-catch-all' = [[...slug]]
export type DynamicSegmentType =
  | 'static'
  | 'dynamic'
  | 'catch-all'
  | 'optional-catch-all'

type RouteNodeBase = {
  kind: 'route'
  id: NodeId
  path: string               // URL path, e.g. "/blog/[slug]"
  filePath: string           // repo-relative file that defines this route
  routeFileKind: RouteFileKind
  dynamicSegmentType: DynamicSegmentType
  isGroupRoute: boolean      // true for (group) directories
  renderingMode: RenderingMode
  provenance: Provenance
}

export type RenderingMode = 'SSR' | 'SSG' | 'ISR' | 'CSR' | 'PPR' | 'unknown'

export type RouteNode = RouteNodeBase & ConfidenceInfo

// ─── ComponentNode ────────────────────────────────────────────────────────────
// 'runtime' replaces the previous isClientComponent + isServerComponent pair,
// which allowed the invalid state { isClientComponent: true, isServerComponent: true }.
export type ComponentRuntime = 'client' | 'server' | 'shared' | 'unknown'

type ComponentNodeBase = {
  kind: 'component'
  id: NodeId
  name: string               // export identifier (or filename for default exports)
  filePath: string           // repo-relative
  runtime: ComponentRuntime
  provenance: Provenance
}

export type ComponentNode = ComponentNodeBase & ConfidenceInfo

// ─── TableNode ────────────────────────────────────────────────────────────────
type TableNodeBase = {
  kind: 'table'
  id: NodeId
  name: string               // Supabase table name
  columns: ColumnDef[]
  provenance: Provenance
}

export interface ColumnDef {
  name: string
  type: string
  nullable: boolean
  isPrimaryKey?: boolean
  references?: { table: string; column: string }  // FK target
}

export type TableNode = TableNodeBase & ConfidenceInfo

// ─── Union ───────────────────────────────────────────────────────────────────
export type IRNode = RouteNode | ComponentNode | TableNode

// ─── IREdge ───────────────────────────────────────────────────────────────────
// Edge kind convention (enforced by adapter authors, documented here):
//   'renders'  — RouteNode(page/layout) → ComponentNode
//   'imports'  — ComponentNode → ComponentNode (direct TSX import)
//   'queries'  — ComponentNode → TableNode (supabase.from() call)
//   'calls'    — reserved for Server Action calls (out of scope for MVP)
//
// `importDepth` is meaningful only for 'imports' edges (1 = direct import).
export type EdgeKind = 'renders' | 'calls' | 'queries' | 'imports'

type IREdgeBase = {
  id: EdgeId
  from: NodeId
  to: NodeId
  kind: EdgeKind
  importDepth?: number       // populated only for kind === 'imports'
  provenance: Provenance
}

export type IREdge = IREdgeBase & ConfidenceInfo

// ─── IRGraphMetadata ──────────────────────────────────────────────────────────
// Carries stack/infra info from detectStack() or LLM through the pipeline.
// Populated in CLI; consumed by renderer (replaces detectInfra() re-parsing).
export interface IRBackendService {
  name: string               // e.g. "NestJS API"
  framework: string          // "nestjs" | "express" | "fastify"
  modules?: string[]         // e.g. ["AuthModule", "CrmModule"]
  entities?: string[]        // DB entity/table names
  dbType?: string            // "postgresql" | "mysql" | "mongodb"
}

export interface IRGraphMetadata {
  framework: string          // e.g. "nextjs-app-router", "vite-react", "expo", or LLM-returned string
  deployTarget?: string      // "browser" | "server" | "mobile" | "edge"
  hasSupabase: boolean
  hasPrisma: boolean
  hasDexie: boolean
  hasFirebase: boolean
  backends?: IRBackendService[]  // backend services detected by LLM
}

// ─── IRGraph (root) ───────────────────────────────────────────────────────────
export interface IRGraph {
  schemaVersion: '0.1'
  analyzerVersion: string    // "codebase-viz@0.1.0"
  repoRoot: string           // absolute path; used to resolve provenance.file
  projectName?: string
  generatedAt: string        // ISO 8601
  metadata?: IRGraphMetadata // stack/infra info for renderer; set by CLI
  nodes: IRNode[]
  edges: IREdge[]
  warnings?: Array<{
    file: string             // repo-relative
    message: string
    severity: 'warn' | 'error'
  }>
}

// ─── Factory functions ────────────────────────────────────────────────────────
// Recommended way to create nodes and edges — `kind` is injected automatically.
// Note: the interfaces are exported for type annotations, but factories are the
// preferred construction path as they enforce `kind` at the call site.

export function createRouteNode(
  params: Omit<RouteNodeBase, 'kind'> & ConfidenceInfo
): RouteNode {
  return { kind: 'route', ...params }
}

export function createComponentNode(
  params: Omit<ComponentNodeBase, 'kind'> & ConfidenceInfo
): ComponentNode {
  return { kind: 'component', ...params }
}

export function createTableNode(
  params: Omit<TableNodeBase, 'kind'> & ConfidenceInfo
): TableNode {
  return { kind: 'table', ...params }
}

export function createEdge(params: IREdgeBase & ConfidenceInfo): IREdge {
  return { ...params }
}

export function createIRGraph(
  params: Omit<IRGraph, 'schemaVersion' | 'generatedAt'>
): IRGraph {
  return {
    schemaVersion: '0.1',
    generatedAt: new Date().toISOString(),
    ...params,
  }
}

// ─── Type guards ──────────────────────────────────────────────────────────────
export function isRouteNode(node: IRNode): node is RouteNode {
  return node.kind === 'route'
}

export function isComponentNode(node: IRNode): node is ComponentNode {
  return node.kind === 'component'
}

export function isTableNode(node: IRNode): node is TableNode {
  return node.kind === 'table'
}

// ─── NodeId / EdgeId builders ─────────────────────────────────────────────────
// Symbol convention per kind:
//   RouteNode    → symbol = routeFileKind  (e.g. 'page', 'layout', 'route-handler')
//                  Prevents NodeId collision when page.tsx and layout.tsx share a directory.
//   ComponentNode → symbol = exported identifier (default export → filename stem)
//   TableNode    → symbol = table name
//
// Full format: "${kind}:${repoRelativePath}:${symbol}"
// Deterministic — same input always yields the same ID. UUID is forbidden.
export function makeNodeId(
  kind: 'route' | 'component' | 'table',
  repoRelativePath: string,
  symbol: string
): NodeId {
  return `${kind}:${repoRelativePath}:${symbol}` as NodeId
}

export function makeEdgeId(
  kind: EdgeKind,
  from: NodeId,
  to: NodeId
): EdgeId {
  return `${kind}:${from}:${to}` as EdgeId
}
