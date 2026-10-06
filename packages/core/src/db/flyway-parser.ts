import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  createTableNode,
  makeNodeId,
  type TableNode,
  type ColumnDef,
} from '@codebase-viz/types'

// Flyway V<version>__<name>.sql naming convention
// version can be: 1, 1_1, 1.1 etc.
const FLYWAY_FILE_RE = /^[Vv][\d._]+__[^/\\]+\.sql$/

// Candidate directories for Flyway migrations, checked in order
const MIGRATION_DIRS = [
  'src/main/resources/db/migration',
  'db/migrations',
  'migrations',
]

async function collectFlywayFiles(repoRoot: string): Promise<string[]> {
  const collected: string[] = []
  for (const rel of MIGRATION_DIRS) {
    const dir = path.join(repoRoot, rel)
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => null)
    if (!entries) continue
    for (const e of entries) {
      if (e.isFile() && FLYWAY_FILE_RE.test(e.name)) {
        collected.push(path.join(dir, e.name))
      }
    }
  }
  return collected.sort((a, b) => compareVersions(flywayVersion(a), flywayVersion(b)))
}

// `V1_2__x.sql` → [1, 2]. 마이그레이션은 누적이라 적용 순서가 결과를 바꾼다 — readdir 순서(V10이 V2보다
// 먼저)로 처리하면 ALTER가 CREATE보다 앞서거나 RENAME이 ADD보다 먼저 와 조용히 틀린다.
function flywayVersion(filePath: string): number[] {
  const m = /^[Vv]([\d._]+?)__/.exec(path.basename(filePath))
  return (m?.[1] ?? '').split(/[._]/).filter(Boolean).map(Number)
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

interface ParsedTable {
  name: string
  columns: ColumnDef[]
  line: number
}

// Extract table name and columns from a single CREATE TABLE statement.
// Handles nested parentheses (e.g. DECIMAL(10,2)).
function parseCreateTable(sql: string): ParsedTable[] {
  const results: ParsedTable[] = []

  // Match CREATE TABLE [IF NOT EXISTS] [schema.]name (...)
  const createRe = /\bCREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:[A-Za-z_][A-Za-z0-9_$]*\.)?([A-Za-z_][A-Za-z0-9_$]*)\s*\(/gi

  let m: RegExpExecArray | null
  while ((m = createRe.exec(sql)) !== null) {
    const tableName = m[1]
    if (!tableName) continue

    const line = sql.slice(0, m.index).split('\n').length

    // Find the matching closing paren, tracking depth
    const startIdx = m.index + m[0].length
    let depth = 1
    let i = startIdx
    while (i < sql.length && depth > 0) {
      const end = quotedEnd(sql, i)
      if (end !== -1) { i = end; continue }
      if (sql[i] === '(') depth++
      else if (sql[i] === ')') depth--
      i++
    }
    const bodyRaw = sql.slice(startIdx, i - 1)
    const columns = extractColumnsFromBody(bodyRaw)
    results.push({ name: tableName, columns, line })
  }
  return results
}

// Non-column constraint keywords that start a definition line
const CONSTRAINT_START = /^\s*(?:PRIMARY\s+KEY|FOREIGN\s+KEY|CONSTRAINT|UNIQUE|INDEX|KEY|CHECK)\b/i

function extractColumnsFromBody(body: string): ColumnDef[] {
  // Split on commas that are NOT inside parentheses
  const defs = splitTopLevel(body)
  const cols: ColumnDef[] = []
  const pkSet = new Set<string>()

  // First pass: collect PRIMARY KEY inline markers and standalone PK constraints
  for (const def of defs) {
    const trimmed = def.trim()
    // Standalone PRIMARY KEY (col1, col2)
    const pkConstraintM = /^\s*(?:CONSTRAINT\s+\S+\s+)?PRIMARY\s+KEY\s*\(([^)]+)\)/i.exec(trimmed)
    if (pkConstraintM) {
      for (const col of (pkConstraintM[1] ?? '').split(',')) {
        pkSet.add(col.trim().replace(/`|"/g, ''))
      }
    }
  }

  for (const def of defs) {
    const trimmed = def.trim()
    if (!trimmed) continue
    if (CONSTRAINT_START.test(trimmed)) continue

    // Column name: first identifier (may be backtick- or quote-delimited)
    const colNameM = /^[`"]?([A-Za-z_][A-Za-z0-9_$]*)[`"]?\s+/.exec(trimmed)
    if (!colNameM) continue
    const colName = colNameM[1]
    if (!colName) continue

    // Type: next token after column name (skip length spec)
    const rest = trimmed.slice(colNameM[0].length)
    const typeM = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(rest)
    const colType = typeM?.[1] ?? 'unknown'

    const isPrimaryKey = pkSet.has(colName) || /\bPRIMARY\s+KEY\b/i.test(trimmed)
    const nullable = !isPrimaryKey && !/\bNOT\s+NULL\b/i.test(trimmed)

    const inlineRef = REFERENCES_RE.exec(trimmed)
    cols.push({
      name: colName, type: colType.toLowerCase(), nullable, isPrimaryKey,
      ...(inlineRef !== null ? { references: { table: inlineRef[1]!, column: inlineRef[2]! } } : {}),
    })
  }
  for (const def of defs) applyForeignKey(cols, def.trim().replace(/^ADD\s+/i, ''))
  return cols
}

const IDENT = '[`"]?([A-Za-z_][A-Za-z0-9_$]*)[`"]?'
const REFERENCES_RE = new RegExp(`\\bREFERENCES\\s+(?:[A-Za-z_][A-Za-z0-9_$]*\\.)?${IDENT}\\s*\\(\\s*${IDENT}`, 'i')
const FOREIGN_KEY_RE = new RegExp(`^(?:CONSTRAINT\\s+\\S+\\s+)?FOREIGN\\s+KEY\\s*\\(\\s*${IDENT}[^)]*\\)\\s*REFERENCES\\s+(?:[A-Za-z_][A-Za-z0-9_$]*\\.)?${IDENT}\\s*\\(\\s*${IDENT}`, 'i')

// `[CONSTRAINT x] FOREIGN KEY (col) REFERENCES t(c)` — 복합 키는 첫 컬럼 쌍만 싣는다(ERD 관계선 1개).
function applyForeignKey(cols: ColumnDef[], clause: string): boolean {
  const m = FOREIGN_KEY_RE.exec(clause)
  if (m === null) return false
  const col = cols.find(c => c.name === m[1])
  if (col !== undefined) col.references = { table: m[2]!, column: m[3]! }
  return true
}

// ALTER TABLE <t> <action>[, <action>...] — ERD가 그리는 컬럼 이름·타입·NULL 여부와 FK를 바꾸는 구문만 반영한다
// (ADD/DROP/RENAME COLUMN, FK 추가, Postgres ALTER COLUMN TYPE·SET/DROP NOT NULL, MySQL MODIFY·CHANGE).
// 인덱스·UNIQUE·CHECK·기본값 등은 ERD에 나오지 않아 무시한다.
function applyAlterTable(cols: ColumnDef[], actions: string): void {
  for (const raw of splitTopLevel(actions)) {
    const action = raw.trim()
    if (/^ADD\s+/i.test(action) && applyForeignKey(cols, action.replace(/^ADD\s+/i, ''))) continue
    if (/^ADD\s+(?:CONSTRAINT|PRIMARY|UNIQUE|INDEX|KEY|CHECK|FOREIGN)\b/i.test(action)) continue
    const add = /^ADD\s+(?:COLUMN\s+)?(?:IF\s+NOT\s+EXISTS\s+)?(.+)$/is.exec(action)
    if (add !== null) {
      for (const col of extractColumnsFromBody(add[1]!)) {
        if (!cols.some(c => c.name === col.name)) cols.push(col)
      }
      continue
    }
    const alterType = new RegExp(`^ALTER\\s+(?:COLUMN\\s+)?${IDENT}\\s+(?:SET\\s+DATA\\s+)?TYPE\\s+([A-Za-z_][A-Za-z0-9_]*)`, 'i').exec(action)
    if (alterType !== null) {
      const col = cols.find(c => c.name === alterType[1])
      if (col !== undefined) col.type = alterType[2]!.toLowerCase()
      continue
    }
    const alterNull = new RegExp(`^ALTER\\s+(?:COLUMN\\s+)?${IDENT}\\s+(SET|DROP)\\s+NOT\\s+NULL`, 'i').exec(action)
    if (alterNull !== null) {
      const col = cols.find(c => c.name === alterNull[1])
      if (col !== undefined && col.isPrimaryKey !== true) col.nullable = alterNull[2]!.toUpperCase() === 'DROP'
      continue
    }
    // MySQL: MODIFY [COLUMN] c <def> = 정의 교체, CHANGE [COLUMN] old new <def> = 이름+정의 교체.
    const modify = new RegExp(`^(?:MODIFY\\s+(?:COLUMN\\s+)?(?=${IDENT})|CHANGE\\s+(?:COLUMN\\s+)?${IDENT}\\s+)([\\s\\S]+)$`, 'i').exec(action)
    if (modify !== null) {
      const [replacement] = extractColumnsFromBody(modify[3]!)
      const oldName = modify[2] ?? replacement?.name
      const idx = cols.findIndex(c => c.name === oldName)
      if (replacement !== undefined && idx !== -1) {
        cols[idx] = { ...replacement, isPrimaryKey: cols[idx]!.isPrimaryKey === true || replacement.isPrimaryKey === true,
          ...(cols[idx]!.references !== undefined ? { references: cols[idx]!.references } : {}) }
      }
      continue
    }
    const rename = new RegExp(`^RENAME\\s+COLUMN\\s+${IDENT}\\s+TO\\s+${IDENT}`, 'i').exec(action)
    if (rename !== null) {
      const col = cols.find(c => c.name === rename[1])
      if (col !== undefined) col.name = rename[2]!
      continue
    }
    if (/^DROP\s+(?:CONSTRAINT|INDEX|KEY|PRIMARY|FOREIGN|CHECK)\b/i.test(action)) continue
    const drop = new RegExp(`^DROP\\s+(?:COLUMN\\s+)?(?:IF\\s+EXISTS\\s+)?${IDENT}`, 'i').exec(action)
    if (drop !== null) {
      const idx = cols.findIndex(c => c.name === drop[1])
      if (idx !== -1) cols.splice(idx, 1)
    }
  }
}

const ALTER_TABLE_RE = new RegExp(`^ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(?:ONLY\\s+)?(?:[A-Za-z_][A-Za-z0-9_$]*\\.)?${IDENT}\\s+([\\s\\S]+)$`, 'i')

// 주석을 지우고 최상위 `;`로 문장을 나눈다 — CREATE와 ALTER를 파일 안 순서대로 적용하기 위해서다.
// 문자열('…'·"…"·`…`)·Postgres 달러 인용($$…$$, $tag$…$tag$) 안의 `;`·`--`·괄호·쉼표는 구문이 아니다 —
// MySQL `COMMENT '상태; 0=대기'`처럼 흔한 입력에서 문장·컬럼이 잘리지 않게 인용 구간을 통째로 건너뛴다.
function quotedEnd(text: string, i: number): number {
  const ch = text[i]
  if (ch === "'" || ch === '"' || ch === '`') {
    let j = i + 1
    while (j < text.length) {
      if (text[j] === ch) {
        if (text[j + 1] === ch) { j += 2; continue }  // '' 이스케이프
        return j + 1
      }
      if (text[j] === '\\' && ch === "'") { j += 2; continue }
      j++
    }
    return text.length
  }
  // 식별자 안의 `$`(`acc$tbl$x`)는 인용이 아니다 — 앞 글자가 식별자 문자면 달러 인용 시작이 아니다.
  if (ch === '$' && (i === 0 || !/[A-Za-z0-9_$]/.test(text[i - 1] ?? ''))) {
    const tag = /^\$[A-Za-z_]*\$/.exec(text.slice(i))
    if (tag === null) return -1
    const close = text.indexOf(tag[0], i + tag[0].length)
    return close === -1 ? text.length : close + tag[0].length
  }
  return -1
}

function splitStatements(sql: string): string[] {
  const out: string[] = []
  let cur = ''
  for (let i = 0; i < sql.length;) {
    const end = quotedEnd(sql, i)
    if (end !== -1) { cur += sql.slice(i, end); i = end; continue }
    if (sql.startsWith('--', i)) { const nl = sql.indexOf('\n', i); i = nl === -1 ? sql.length : nl; continue }
    if (sql.startsWith('/*', i)) { const close = sql.indexOf('*/', i + 2); cur += ' '; i = close === -1 ? sql.length : close + 2; continue }
    if (sql[i] === ';') { out.push(cur); cur = ''; i++; continue }
    cur += sql[i]
    i++
  }
  out.push(cur)
  return out.map(st => st.trim()).filter(Boolean)
}

// Split a string on commas that are not inside parentheses
function splitTopLevel(body: string): string[] {
  const parts: string[] = []
  let depth = 0
  let start = 0
  for (let i = 0; i < body.length; i++) {
    const end = quotedEnd(body, i)
    if (end !== -1) { i = end - 1; continue }
    const ch = body[i]
    if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(body.slice(start, i))
      start = i + 1
    }
  }
  parts.push(body.slice(start))
  return parts
}

export async function parseFlywayMigrations(repoRoot: string, analyzerVersion: string): Promise<TableNode[]> {
  const files = await collectFlywayFiles(repoRoot)
  const tableMap = new Map<string, TableNode>()

  for (const filePath of files) {
    const sql = await fs.readFile(filePath, 'utf-8').catch(() => null)
    if (!sql) continue
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
    for (const statement of splitStatements(sql)) {
      const alter = ALTER_TABLE_RE.exec(statement)
      if (alter !== null) {
        const table = tableMap.get(alter[1]!)
        if (table !== undefined) applyAlterTable(table.columns, alter[2]!)
        continue
      }
      for (const { name, columns } of parseCreateTable(statement)) {
        if (tableMap.has(name)) continue
        tableMap.set(
          name,
          createTableNode({
            id: makeNodeId('table', relPath, name),
            name,
            columns,
            provenance: {
              file: relPath,
              line: createTableLine(sql, name),
              adapter: 'flyway-parser@0.1',
              analyzerVersion,
            },
            confidence: 'verified',
          }),
        )
      }
    }
  }

  return [...tableMap.values()]
}

// 문장 분리 전에 주석을 지웠으므로 선언 라인은 원문에서 다시 찾는다(딥링크 좌표).
function createTableLine(sql: string, tableName: string): number {
  const m = new RegExp(`\\bCREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:[A-Za-z_][A-Za-z0-9_$]*\\.)?[\`"]?${tableName.replace(/\$/g, '\\$')}[\`"]?\\s*\\(`, 'i').exec(sql)
  return m === null ? 1 : sql.slice(0, m.index).split('\n').length
}

// Merge Flyway tables into ORM tables.
// ORM tables take precedence by name.
// Flyway columns that do not exist in the ORM table are appended.
export function mergeFlywayTables(ormTables: TableNode[], flywayTables: TableNode[]): TableNode[] {
  const result = new Map<string, TableNode>(ormTables.map(t => [t.name, t]))

  for (const fw of flywayTables) {
    const existing = result.get(fw.name)
    if (!existing) {
      result.set(fw.name, fw)
    } else {
      // Supplement: add Flyway columns not present in ORM table
      const existingColNames = new Set(existing.columns.map(c => c.name))
      const extraCols = fw.columns.filter(c => !existingColNames.has(c.name))
      if (extraCols.length > 0) {
        result.set(fw.name, { ...existing, columns: [...existing.columns, ...extraCols] })
      }
    }
  }

  return [...result.values()]
}
