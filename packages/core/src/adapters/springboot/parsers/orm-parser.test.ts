import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseJpaEntities } from './orm-parser.js'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-viz-spring-orm-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeFile(relPath: string, content: string): Promise<void> {
  const absPath = path.join(tmpDir, relPath)
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, content, 'utf-8')
}

describe('parseJpaEntities', () => {
  it('.java 파일 없으면 빈 배열 반환', async () => {
    const tables = await parseJpaEntities(tmpDir, 'test')
    expect(tables).toEqual([])
  })

  it('@Entity 없는 파일은 스킵', async () => {
    await writeFile('User.java', `
public class User {
    private Long id;
    private String name;
}
`)
    const tables = await parseJpaEntities(tmpDir, 'test')
    expect(tables).toEqual([])
  })

  it('@Entity 클래스에서 TableNode 추출', async () => {
    await writeFile('User.java', `
import jakarta.persistence.*;

@Entity
public class User {
    @Id
    @GeneratedValue
    private Long id;

    @Column
    private String name;
}
`)
    const tables = await parseJpaEntities(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    expect(tables[0]?.name).toBe('User')
    expect(tables[0]?.confidence).toBe('inferred')
  })

  it('@Id 필드는 isPrimaryKey=true로 추출', async () => {
    await writeFile('User.java', `
import jakarta.persistence.*;

@Entity
public class User {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column
    private String name;
}
`)
    const tables = await parseJpaEntities(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    const cols = tables[0]?.columns ?? []
    const idCol = cols.find(c => c.name === 'id')
    expect(idCol?.isPrimaryKey).toBe(true)
  })

  it('@Column 필드 추출', async () => {
    await writeFile('Post.java', `
import jakarta.persistence.*;

@Entity
public class Post {
    @Id
    private Long id;

    @Column
    private String title;

    @Column
    private String body;
}
`)
    const tables = await parseJpaEntities(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    const names = (tables[0]?.columns ?? []).map(c => c.name)
    expect(names).toContain('title')
    expect(names).toContain('body')
  })

  it('@Table(name=...) 어노테이션으로 테이블명 오버라이드', async () => {
    await writeFile('User.java', `
import jakarta.persistence.*;

@Entity
@Table(name = "users")
public class User {
    @Id
    private Long id;
}
`)
    const tables = await parseJpaEntities(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    expect(tables[0]?.name).toBe('users')
  })

  it('복수 엔티티 모두 추출', async () => {
    await writeFile('User.java', `
import jakarta.persistence.*;

@Entity
public class User {
    @Id
    private Long id;
}
`)
    await writeFile('Post.java', `
import jakarta.persistence.*;

@Entity
public class Post {
    @Id
    private Long id;
}
`)
    const tables = await parseJpaEntities(tmpDir, 'test')
    expect(tables).toHaveLength(2)
    expect(tables.map(t => t.name)).toEqual(expect.arrayContaining(['User', 'Post']))
  })

  it('NodeId가 결정론적으로 생성됨', async () => {
    await writeFile('src/User.java', `
import jakarta.persistence.*;

@Entity
@Table(name = "users")
public class User {
    @Id
    private Long id;
}
`)
    const tables = await parseJpaEntities(tmpDir, 'test')
    expect(tables[0]?.id).toBe('table:src/User.java:users')
  })
})
