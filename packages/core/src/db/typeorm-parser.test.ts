import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readOrmClassName, ORM_CLASS_PREFIX } from '@codebase-viz/types'
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

  it('@Column({ nullable: true }) → nullable: true (B-2)', async () => {
    const relDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-nullable-'))
    await fs.mkdir(path.join(relDir, 'src'), { recursive: true })
    await fs.writeFile(
      path.join(relDir, 'src', 'user.entity.ts'),
      `
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm'

@Entity()
export class User {
  @PrimaryGeneratedColumn()
  id: number

  @Column({ nullable: true })
  bio: string | null

  @Column()
  name: string
}
`,
    )
    const tables = await parseTypeOrmEntities(relDir, 'test')
    const user = tables.find(t => t.name === 'user')
    const bioCol = user?.columns.find(c => c.name === 'bio')
    const nameCol = user?.columns.find(c => c.name === 'name')
    expect(bioCol?.nullable).toBe(true)
    expect(nameCol?.nullable).toBe(false)
    await fs.rm(relDir, { recursive: true, force: true })
  })

  it('string | null TypeNode → nullable: true (B-2)', async () => {
    const relDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-nulltype-'))
    await fs.mkdir(path.join(relDir, 'src'), { recursive: true })
    await fs.writeFile(
      path.join(relDir, 'src', 'item.entity.ts'),
      `
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm'

@Entity()
export class Item {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  description: string | null
}
`,
    )
    const tables = await parseTypeOrmEntities(relDir, 'test')
    const item = tables.find(t => t.name === 'item')
    const descCol = item?.columns.find(c => c.name === 'description')
    expect(descCol?.nullable).toBe(true)
    await fs.rm(relDir, { recursive: true, force: true })
  })

  it('() => { return User; } 블록 바디 ArrowFunction → references 생성 (B-3)', async () => {
    const relDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-arrow-'))
    await fs.mkdir(path.join(relDir, 'src'), { recursive: true })
    await fs.writeFile(
      path.join(relDir, 'src', 'post.entity.ts'),
      `
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm'
import { User } from './user.entity'

@Entity()
export class Post {
  @PrimaryGeneratedColumn()
  id: number

  @ManyToOne(() => { return User; })
  author: User
}
`,
    )
    const tables = await parseTypeOrmEntities(relDir, 'test')
    const post = tables.find(t => t.name === 'post')
    const authorCol = post?.columns.find(c => c.name === 'author')
    expect(authorCol?.references).toBeDefined()
    expect(authorCol?.references?.table).toBe('User')
    await fs.rm(relDir, { recursive: true, force: true })
  })

  it('@ManyToOne decorator → ColumnDef.references 생성', async () => {
    const relDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-rel-'))
    await fs.mkdir(path.join(relDir, 'src', 'entities'), { recursive: true })
    await fs.writeFile(
      path.join(relDir, 'src', 'entities', 'post.entity.ts'),
      `
import { Entity, Column, PrimaryGeneratedColumn, ManyToOne } from 'typeorm'
import { User } from './user.entity'

@Entity()
export class Post {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  title: string

  @ManyToOne(() => User, user => user.posts)
  author: User
}
`,
    )
    const tables = await parseTypeOrmEntities(relDir, 'test')
    const postTable = tables.find(t => t.name === 'post')
    const authorCol = postTable?.columns.find(c => c.name === 'author')
    expect(authorCol?.references).toBeDefined()
    expect(authorCol?.references?.table).toBe('User')
    await fs.rm(relDir, { recursive: true, force: true })
  })
})

describe('parseTypeOrmEntities — ORM 클래스 센티넬·FK 테이블명 (v1.2.68 ST2)', () => {
  let relDir: string

  beforeAll(async () => {
    relDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-typeorm-rel-'))
    await fs.writeFile(
      path.join(relDir, 'member.entity.ts'),
      `
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm'

@Entity('tb_member')
export class Member {
  @PrimaryGeneratedColumn()
  id: number

  @Column()
  name: string
}
`,
    )
    await fs.writeFile(
      path.join(relDir, 'order.entity.ts'),
      `
import { Entity, PrimaryGeneratedColumn, Column, ManyToOne } from 'typeorm'
import { Member } from './member.entity'

@Entity()
export class PurchaseOrder {
  @PrimaryGeneratedColumn()
  id: number

  @ManyToOne(() => Member)
  buyer: Member
}
`,
    )
  })

  afterAll(async () => {
    await fs.rm(relDir, { recursive: true, force: true })
  })

  it('클래스명을 orm-class 센티넬로 싣고, 센티넬은 inferenceChain[0]이 아니다', async () => {
    const tables = await parseTypeOrmEntities(relDir, 'test@0.1')
    for (const [table, cls] of [['tb_member', 'Member'], ['purchaseorder', 'PurchaseOrder']] as const) {
      const node = tables.find(t => t.name === table)!
      expect(readOrmClassName(node)).toBe(cls)
      if (node.confidence === 'inferred') expect(node.inferenceChain[0]!.startsWith(ORM_CLASS_PREFIX)).toBe(false)
    }
  })

  it('관계 FK는 대상 엔티티의 클래스명이 아니라 테이블명을 참조한다', async () => {
    const tables = await parseTypeOrmEntities(relDir, 'test@0.1')
    const buyer = tables.find(t => t.name === 'purchaseorder')!.columns.find(c => c.name === 'buyer')
    expect(buyer?.references?.table).toBe('tb_member')
  })
})

describe('parseTypeOrmEntities — @Column({ name }) DB 실제 이름 (v1.2.68 FIX)', () => {
  it('데코레이터 name 옵션이 있으면 컬럼명으로 쓰고, 없으면 프로퍼티명', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-typeorm-col-'))
    await fs.writeFile(path.join(dir, 'account.entity.ts'), `
import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm'
@Entity('accounts')
export class Account {
  @PrimaryGeneratedColumn({ name: 'account_id' })
  id: number

  @Column({ name: 'user_name', type: 'varchar' })
  userName: string

  @Column()
  email: string
}
`)
    const tables = await parseTypeOrmEntities(dir, 'test@0.1')
    const cols = tables.find(t => t.name === 'accounts')!.columns.map(c => c.name)
    expect(cols).toEqual(['account_id', 'user_name', 'email'])
    await fs.rm(dir, { recursive: true, force: true })
  })
})
