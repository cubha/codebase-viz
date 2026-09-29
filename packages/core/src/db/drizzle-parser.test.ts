import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readOrmClassName, ORM_CLASS_PREFIX } from '@codebase-viz/types'
import { parseDrizzleSchema } from './drizzle-parser.js'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-drizzle-test-'))
  await fs.mkdir(path.join(tmpDir, 'src'), { recursive: true })
  await fs.writeFile(
    path.join(tmpDir, 'src', 'schema.ts'),
    `
import { pgTable, integer, text, boolean } from 'drizzle-orm/pg-core'

export const usersTable = pgTable('users', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').unique(),
  active: boolean('active').default(true),
})

export const postsTable = pgTable('posts', {
  id: integer('id').primaryKey(),
  title: text('title').notNull(),
  authorId: integer('author_id').notNull(),
})
`,
  )
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('parseDrizzleSchema', () => {
  it('users와 posts 테이블을 TableNode로 추출한다', async () => {
    const tables = await parseDrizzleSchema(tmpDir, 'test@0.1')
    expect(tables).toHaveLength(2)
    const names = tables.map(t => t.name)
    expect(names).toContain('users')
    expect(names).toContain('posts')
  })

  it('컬럼을 추출한다', async () => {
    const tables = await parseDrizzleSchema(tmpDir, 'test@0.1')
    const users = tables.find(t => t.name === 'users')!
    const colNames = users.columns.map(c => c.name)
    expect(colNames).toContain('id')
    expect(colNames).toContain('name')
  })

  it('drizzle 파일이 없으면 빈 배열 반환', async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-empty-'))
    const tables = await parseDrizzleSchema(emptyDir, 'test@0.1')
    expect(tables).toHaveLength(0)
    await fs.rm(emptyDir, { recursive: true, force: true })
  })

  it('confidence는 inferred', async () => {
    const tables = await parseDrizzleSchema(tmpDir, 'test@0.1')
    expect(tables[0]?.confidence).toBe('inferred')
  })
})

describe('parseDrizzleSchema — ORM 클래스 센티넬 (v1.2.68 ST3)', () => {
  it('테이블 변수명을 orm-class 센티넬로 싣고, 센티넬은 inferenceChain[0]이 아니다', async () => {
    const tables = await parseDrizzleSchema(tmpDir, 'test@0.1')
    for (const [table, varName] of [['users', 'usersTable'], ['posts', 'postsTable']] as const) {
      const node = tables.find(t => t.name === table)!
      expect(readOrmClassName(node)).toBe(varName)
      if (node.confidence === 'inferred') expect(node.inferenceChain[0]!.startsWith(ORM_CLASS_PREFIX)).toBe(false)
    }
  })
})
