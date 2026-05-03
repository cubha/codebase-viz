import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { parseTypeOrmEntities } from './typeorm-parser.js'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-typeorm-test-'))
  await fs.mkdir(path.join(tmpDir, 'src', 'entities'), { recursive: true })
  await fs.writeFile(
    path.join(tmpDir, 'src', 'entities', 'user.entity.ts'),
    `
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm'

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id: string

  @Column()
  name: string

  @Column({ type: 'varchar', length: 150, nullable: true })
  email: string

  @Column()
  active: boolean
}
`,
  )
  await fs.writeFile(
    path.join(tmpDir, 'src', 'entities', 'post.entity.ts'),
    `
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm'

@Entity()
export class Post {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  title: string

  @Column()
  authorId: number
}
`,
  )
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('parseTypeOrmEntities', () => {
  it('User와 Post 엔티티를 TableNode로 추출한다', async () => {
    const tables = await parseTypeOrmEntities(tmpDir, 'test@0.1')
    expect(tables).toHaveLength(2)
    const names = tables.map(t => t.name)
    expect(names).toContain('users')
    expect(names).toContain('post')
  })

  it('@Column 필드를 컬럼으로 추출한다', async () => {
    const tables = await parseTypeOrmEntities(tmpDir, 'test@0.1')
    const user = tables.find(t => t.name === 'users')!
    const colNames = user.columns.map(c => c.name)
    expect(colNames).toContain('name')
    expect(colNames).toContain('email')
    expect(colNames).toContain('active')
  })

  it('@PrimaryGeneratedColumn을 isPrimaryKey: true로 마킹한다', async () => {
    const tables = await parseTypeOrmEntities(tmpDir, 'test@0.1')
    const user = tables.find(t => t.name === 'users')!
    const id = user.columns.find(c => c.name === 'id')
    expect(id?.isPrimaryKey).toBe(true)
  })

  it('@Entity가 없으면 빈 배열 반환', async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-empty-'))
    const tables = await parseTypeOrmEntities(emptyDir, 'test@0.1')
    expect(tables).toHaveLength(0)
    await fs.rm(emptyDir, { recursive: true, force: true })
  })
})
