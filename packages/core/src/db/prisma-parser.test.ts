import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { parsePrismaSchema } from './prisma-parser.js'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-prisma-test-'))
  await fs.mkdir(path.join(tmpDir, 'prisma'), { recursive: true })
  await fs.writeFile(
    path.join(tmpDir, 'prisma', 'schema.prisma'),
    `
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id    Int    @id @default(autoincrement())
  name  String
  email String @unique
  posts Post[]
}

model Post {
  id       Int    @id @default(autoincrement())
  title    String
  authorId Int
  author   User   @relation(fields: [authorId], references: [id])
}
`,
  )
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('parsePrismaSchema', () => {
  it('User와 Post 모델을 TableNode로 추출한다', async () => {
    const tables = await parsePrismaSchema(tmpDir, 'test@0.1')
    expect(tables).toHaveLength(2)
    const names = tables.map(t => t.name)
    expect(names).toContain('User')
    expect(names).toContain('Post')
  })

  it('relation 필드는 컬럼에서 제외한다', async () => {
    const tables = await parsePrismaSchema(tmpDir, 'test@0.1')
    const user = tables.find(t => t.name === 'User')!
    const colNames = user.columns.map(c => c.name)
    expect(colNames).not.toContain('posts')
    expect(colNames).toContain('name')
    expect(colNames).toContain('email')
  })

  it('@id 필드를 isPrimaryKey: true로 마킹한다', async () => {
    const tables = await parsePrismaSchema(tmpDir, 'test@0.1')
    const user = tables.find(t => t.name === 'User')!
    const idCol = user.columns.find(c => c.name === 'id')
    expect(idCol?.isPrimaryKey).toBe(true)
  })

  it('schema.prisma 없으면 빈 배열 반환', async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-empty-'))
    const tables = await parsePrismaSchema(emptyDir, 'test@0.1')
    expect(tables).toHaveLength(0)
    await fs.rm(emptyDir, { recursive: true, force: true })
  })

  it('confidence는 inferred, inferenceChain 포함', async () => {
    const tables = await parsePrismaSchema(tmpDir, 'test@0.1')
    const user = tables.find(t => t.name === 'User')!
    expect(user.confidence).toBe('inferred')
    if (user.confidence === 'inferred') {
      expect(user.inferenceChain.length).toBeGreaterThan(0)
    }
  })
})
