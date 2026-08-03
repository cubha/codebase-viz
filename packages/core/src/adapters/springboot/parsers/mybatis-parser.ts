import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  createTableNode,
  makeNodeId,
  type TableNode,
  type ColumnDef,
  type Provenance,
} from '@codebase-viz/types'

const EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'target', 'build', '.gradle'])

const SQL_KW = new Set([
  'SELECT', 'WHERE', 'SET', 'FROM', 'INTO', 'JOIN', 'INNER', 'LEFT', 'RIGHT',
  'OUTER', 'CROSS', 'FULL', 'ON', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN',
  'LIKE', 'BETWEEN', 'AS', 'BY', 'ORDER', 'GROUP', 'HAVING', 'LIMIT', 'OFFSET',
  'UNION', 'ALL', 'DISTINCT', 'EXISTS', 'WITH', 'CASE', 'WHEN', 'THEN', 'ELSE',
  'END', 'COUNT', 'SUM', 'AVG', 'MAX', 'MIN', 'DUAL', 'ROWNUM', 'SYSDATE',
  'NEXTVAL', 'CURRVAL', 'VALUES', 'TABLE', 'DELETE', 'INSERT', 'UPDATE',
])

// schema.TABLE or plain TABLE — captures only the table part
const TABLE_PATTERNS = [
  /\bFROM\s+(?:[A-Za-z_][A-Za-z0-9_$]*\.)?([A-Za-z_][A-Za-z0-9_$]*)/gi,
  /\bINTO\s+(?:[A-Za-z_][A-Za-z0-9_$]*\.)?([A-Za-z_][A-Za-z0-9_$]*)/gi,
  /\bUPDATE\s+(?:[A-Za-z_][A-Za-z0-9_$]*\.)?([A-Za-z_][A-Za-z0-9_$]*)/gi,
  /\bJOIN\s+(?:[A-Za-z_][A-Za-z0-9_$]*\.)?([A-Za-z_][A-Za-z0-9_$]*)/gi,
]

async function findFiles(repoRoot: string, predicate: (name: string) => boolean): Promise<string[]> {
  const results: string[] = []
  async function recurse(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (!entries) return
    for (const e of entries) {
      if (e.isDirectory()) {
        if (!EXCLUDE_DIRS.has(e.name)) await recurse(path.join(dir, e.name))
      } else if (e.isFile() && predicate(e.name)) {
        results.push(path.join(dir, e.name))
      }
    }
  }
  await recurse(repoRoot)
  return results
}

// CTE(WITH [RECURSIVE] ... AS (...)) 별칭 수집 — `WITH a AS (...), b AS (...)` 콤마 연쇄 및
// `WITH RECURSIVE` 자기참조 형태까지 포함.
const CTE_PATTERNS = [
  /\bWITH\s+(?:RECURSIVE\s+)?([A-Za-z_][A-Za-z0-9_$]*)\s+AS\s*\(/gi,
  /,\s*([A-Za-z_][A-Za-z0-9_$]*)\s+AS\s*\(/gi,
]

export function extractTablesFromSql(sql: string): string[] {
  const cleaned = sql
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    // 문자열 리터럴을 먼저 제거해야 한다 — 라인 주석(--)을 먼저 지우면 리터럴 내부의 '--'가
    // 그 뒤의 진짜 FROM절까지 한 줄 통째로 삼켜버린다(예: SELECT 'a--b' FROM TB_REAL).
    .replace(/'(?:[^']|'')*'/g, ' ')
    .replace(/--[^\n]*/g, ' ')

  const cteNames = new Set<string>()
  for (const p of CTE_PATTERNS) {
    p.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = p.exec(cleaned)) !== null) cteNames.add(m[1]!.toUpperCase())
  }

  const tables = new Set<string>()
  for (const p of TABLE_PATTERNS) {
    p.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = p.exec(cleaned)) !== null) {
      const name = m[1]
      if (name && !SQL_KW.has(name.toUpperCase()) && name.length > 1 && !cteNames.has(name.toUpperCase()))
        tables.add(name)
    }
  }
  return [...tables]
}

function parseResultMapColumns(body: string): ColumnDef[] {
  const cols: ColumnDef[] = []
  let m: RegExpExecArray | null

  // N-14: extract nested <association>/<collection> bodies and strip them from body
  // to avoid duplicates when outer id/result regexes scan the full string
  const nestedBodies: string[] = []
  const stripped = body.replace(
    /<(?:association|collection)\b[^>]*>([\s\S]*?)<\/(?:association|collection)>/gi,
    (_, inner: string) => { nestedBodies.push(inner); return '' },
  )

  const idRe = /<id\b[^>]+column="([^"]+)"[^>]*/gi
  while ((m = idRe.exec(stripped)) !== null)
    cols.push({ name: m[1]!, type: 'unknown', nullable: false, isPrimaryKey: true })
  const resRe = /<result\b[^>]+column="([^"]+)"[^>]*/gi
  while ((m = resRe.exec(stripped)) !== null)
    cols.push({ name: m[1]!, type: 'unknown', nullable: true, isPrimaryKey: false })

  // recurse into each nested body
  for (const nested of nestedBodies)
    cols.push(...parseResultMapColumns(nested))

  return cols
}

function getSimpleName(fqn: string): string {
  const parts = fqn.split('.')
  return parts[parts.length - 1] ?? fqn
}

interface RmEntry { id: string; className: string; columns: ColumnDef[]; extends?: string; line: number }

function resolveExtends(registry: Map<string, RmEntry>): void {
  for (const entry of registry.values()) {
    if (entry.extends === undefined) continue
    const parent = registry.get(entry.extends)
    if (parent === undefined) continue
    const parentCols = parent.columns.filter(pc => !entry.columns.some(c => c.name === pc.name))
    entry.columns = [...parentCols, ...entry.columns]
  }
}

function parseXmlToTables(xml: string, relPath: string, analyzerVersion: string): TableNode[] {
  // Tier 1 — build resultMap registry: id → { className, columns }
  const registry = new Map<string, RmEntry>()
  const rmRe = /<resultMap\b([^>]*)>([\s\S]*?)<\/resultMap>/gi
  let rm: RegExpExecArray | null
  while ((rm = rmRe.exec(xml)) !== null) {
    const idM = /\bid="([^"]+)"/.exec(rm[1]!)
    const typeM = /\btype="([^"]+)"/.exec(rm[1]!)
    const extendsM = /\bextends="([^"]+)"/.exec(rm[1]!)
    if (!idM) continue
    registry.set(idM[1]!, {
      id: idM[1]!,
      className: typeM ? getSimpleName(typeM[1]!) : idM[1]!,
      columns: parseResultMapColumns(rm[2]!),
      ...(extendsM ? { extends: extendsM[1]! } : {}),
      line: xml.slice(0, rm.index).split('\n').length,
    })
  }
  // N-13: resolve extends — prepend parent columns to child
  resolveExtends(registry)

  // collect ids that are used as extends targets — skip them in Fallback to avoid phantom tables
  const extendsTargets = new Set<string>()
  for (const entry of registry.values()) {
    if (entry.extends !== undefined) extendsTargets.add(entry.extends)
  }

  const matched = new Set<string>() // resultMap ids that got a real table name
  const tableMap = new Map<string, { columns: ColumnDef[]; line: number; chain: string }>()

  // Tier 2 — correlate each SQL statement with its resultMap
  const stmtRe = /<(select|insert|update|delete)\b([^>]*)>([\s\S]*?)<\/\1>/gi
  let stmt: RegExpExecArray | null
  while ((stmt = stmtRe.exec(xml)) !== null) {
    const tables = extractTablesFromSql(stmt[3]!)
    const rmRef = /\bresultMap="([^"]+)"/.exec(stmt[2]!)?.[ 1]
    const entry = rmRef ? registry.get(rmRef) : undefined
    const line = xml.slice(0, stmt.index).split('\n').length

    if (tables.length === 1 && entry !== undefined) {
      // High-quality match: single table + resultMap columns
      const tbl = tables[0]!
      if (!tableMap.has(tbl)) {
        tableMap.set(tbl, {
          columns: entry.columns,
          line,
          chain: `mybatis: resultMap "${rmRef}" → table "${tbl}" in ${relPath}`,
        })
      } else if (tableMap.get(tbl)!.columns.length === 0 && entry.columns.length > 0) {
        tableMap.get(tbl)!.columns = entry.columns
      }
      if (rmRef) matched.add(rmRef)
    } else {
      // Multiple tables or no resultMap — register each with no columns
      for (const tbl of tables) {
        if (!tableMap.has(tbl))
          tableMap.set(tbl, { columns: [], line, chain: `mybatis: table "${tbl}" in SQL in ${relPath}` })
      }
    }
  }

  // Fallback — resultMaps not matched to any SQL table → use class simple name
  // skip extends-only parent entries (they exist to be merged, not to produce phantom tables)
  for (const entry of registry.values()) {
    if (!matched.has(entry.id) && !extendsTargets.has(entry.id) && entry.columns.length > 0 && !tableMap.has(entry.className)) {
      tableMap.set(entry.className, {
        columns: entry.columns,
        line: entry.line,
        chain: `mybatis: resultMap "${entry.id}" (type ${entry.className}) in ${relPath}`,
      })
    }
  }

  return [...tableMap.entries()].map(([name, { columns, line, chain }]) => {
    const provenance: Provenance = { file: relPath, line, adapter: 'mybatis-parser@0.1', analyzerVersion }
    return createTableNode({
      id: makeNodeId('table', relPath, name),
      name,
      columns,
      provenance,
      confidence: 'inferred',
      inferenceChain: [chain],
    })
  })
}

// Supplement: extract table names from SQL string literals in @Mapper Java files
function extractTablesFromMapperJava(source: string): string[] {
  const tables = new Set<string>()
  const strRe = /"([^"\\]+(?:\\.[^"\\]*)*)"/g
  let m: RegExpExecArray | null
  while ((m = strRe.exec(source)) !== null) {
    const str = m[1]!
    if (/\b(FROM|INTO|UPDATE)\b/i.test(str)) {
      for (const t of extractTablesFromSql(str)) tables.add(t)
    }
  }
  return [...tables]
}

export async function parseMybatisMappers(repoRoot: string, analyzerVersion: string): Promise<TableNode[]> {
  const globalRegistry = new Map<string, TableNode>()

  function register(nodes: TableNode[]): void {
    for (const node of nodes) {
      const existing = globalRegistry.get(node.name)
      if (!existing || (existing.columns.length === 0 && node.columns.length > 0))
        globalRegistry.set(node.name, node)
    }
  }

  // 1. Mapper XML files (*Mapper.xml or files containing <mapper namespace=)
  const xmlFiles = await findFiles(repoRoot, (n) => n.endsWith('.xml'))
  for (const filePath of xmlFiles) {
    const xml = await fs.readFile(filePath, 'utf-8').catch(() => null)
    if (!xml || !xml.includes('<mapper')) continue
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
    register(parseXmlToTables(xml, relPath, analyzerVersion))
  }

  // 2. @Mapper Java interfaces — supplement only (don't override XML results with columns)
  const javaFiles = await findFiles(repoRoot, (n) => n.endsWith('.java'))
  for (const filePath of javaFiles) {
    const source = await fs.readFile(filePath, 'utf-8').catch(() => null)
    if (!source || !source.includes('@Mapper')) continue
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
    for (const tblName of extractTablesFromMapperJava(source)) {
      if (!globalRegistry.has(tblName)) {
        const provenance: Provenance = { file: relPath, line: 1, adapter: 'mybatis-parser@0.1', analyzerVersion }
        globalRegistry.set(
          tblName,
          createTableNode({
            id: makeNodeId('table', relPath, tblName),
            name: tblName,
            columns: [],
            provenance,
            confidence: 'inferred',
            inferenceChain: [`mybatis: table "${tblName}" referenced in @Mapper ${relPath}`],
          }),
        )
      }
    }
  }

  return [...globalRegistry.values()]
}
