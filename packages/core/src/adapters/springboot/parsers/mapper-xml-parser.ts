import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  createComponentNode,
  createEdge,
  makeNodeId,
  makeEdgeId,
  type ComponentNode,
  type IREdge,
  type Provenance,
} from '@codebase-viz/types'

const EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'target', 'build', '.gradle'])

async function findXmlFiles(repoRoot: string): Promise<string[]> {
  const results: string[] = []
  async function recurse(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (!entries) return
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!EXCLUDE_DIRS.has(e.name)) await recurse(path.join(dir, e.name))
      } else if (e.isFile() && e.name.endsWith('.xml')) {
        results.push(path.join(dir, e.name))
      }
    }
  }
  await recurse(repoRoot)
  return results
}

// 컴포넌트 파일경로 → Java FQN (`src/main/java/<pkg>/<Class>.java` → `<pkg>.<Class>`).
// 마지막 `java`/`kotlin` 소스 루트 segment 이후를 package로 간주. 비표준 경로면 undefined.
function componentFqn(filePath: string): string | undefined {
  const segs = filePath.replace(/\\/g, '/').split('/')
  const ext = path.extname(filePath)
  let rootIdx = -1
  for (let i = segs.length - 1; i >= 0; i--) {
    if (segs[i] === 'java' || segs[i] === 'kotlin') { rootIdx = i; break }
  }
  if (rootIdx === -1 || rootIdx === segs.length - 1) return undefined
  const tail = segs.slice(rootIdx + 1)
  const last = tail[tail.length - 1]
  if (last === undefined) return undefined
  tail[tail.length - 1] = path.basename(last, ext)
  return tail.join('.')
}

export interface MapperXmlResult {
  xmlNodes: ComponentNode[]
  xmlEdges: IREdge[]
}

// A-ST3: MyBatis Mapper XML `<mapper namespace="FQN">` ↔ Repository interface 컴포넌트 매칭.
// namespace FQN과 컴포넌트 FQN이 정확히 일치할 때만 XML 노드 + Repository → XML calls 엣지 emit.
// 정확 매칭 실패 시 침묵 (Less is More — phantom 노드 금지).
export async function parseMapperXmlEdges(
  repoRoot: string,
  componentNodes: ComponentNode[],
  analyzerVersion: string,
): Promise<MapperXmlResult> {
  if (componentNodes.length === 0) return { xmlNodes: [], xmlEdges: [] }

  const fqnToComponent = new Map<string, ComponentNode>()
  for (const c of componentNodes) {
    const fqn = componentFqn(c.filePath)
    if (fqn !== undefined && !fqnToComponent.has(fqn)) fqnToComponent.set(fqn, c)
  }

  const xmlFiles = await findXmlFiles(repoRoot)
  const xmlNodes: ComponentNode[] = []
  const xmlEdges: IREdge[] = []
  const seenXmlIds = new Set<string>()
  const seenEdgeIds = new Set<string>()

  for (const filePath of xmlFiles) {
    const xml = await fs.readFile(filePath, 'utf-8').catch(() => null)
    if (xml === null || !xml.includes('<mapper')) continue
    const nsMatch = /<mapper\b[^>]*\bnamespace\s*=\s*"([^"]+)"/.exec(xml)
    if (nsMatch === null) continue
    const namespace = nsMatch[1]!
    const repo = fqnToComponent.get(namespace)
    if (repo === undefined) continue

    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
    const xmlName = path.basename(filePath)
    const provenance: Provenance = {
      file: relPath,
      line: 1,
      adapter: 'mybatis-xml-parser@0.1',
      analyzerVersion,
    }
    const xmlId = makeNodeId('component', relPath, xmlName)
    if (!seenXmlIds.has(xmlId)) {
      seenXmlIds.add(xmlId)
      xmlNodes.push(
        createComponentNode({
          id: xmlId,
          name: xmlName,
          filePath: relPath,
          runtime: 'server',
          provenance,
          confidence: 'verified',
        }),
      )
    }
    const edgeId = makeEdgeId('calls', repo.id, xmlId)
    if (!seenEdgeIds.has(edgeId)) {
      seenEdgeIds.add(edgeId)
      // namespace 리터럴 == 컴포넌트 FQN 정확 일치 → statically provable.
      xmlEdges.push(
        createEdge({
          id: edgeId,
          from: repo.id,
          to: xmlId,
          kind: 'calls',
          provenance,
          confidence: 'verified',
        }),
      )
    }
  }

  return { xmlNodes, xmlEdges }
}
