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

  it('@Column(nullable = false) → nullable: false', async () => {
    await writeFile('Product.java', `
import jakarta.persistence.*;

@Entity
public class Product {
    @Id
    private Long id;

    @Column(nullable = false)
    private String name;
}
`)
    const tables = await parseJpaEntities(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    const col = (tables[0]?.columns ?? []).find(c => c.name === 'name')
    expect(col?.nullable).toBe(false)
  })

  it('@Column(nullable = true) → nullable: true', async () => {
    await writeFile('Product.java', `
import jakarta.persistence.*;

@Entity
public class Product {
    @Id
    private Long id;

    @Column(nullable = true)
    private String description;
}
`)
    const tables = await parseJpaEntities(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    const col = (tables[0]?.columns ?? []).find(c => c.name === 'description')
    expect(col?.nullable).toBe(true)
  })

  it('@Column 인자 없음 → nullable: true (JPA 기본값)', async () => {
    await writeFile('Product.java', `
import jakarta.persistence.*;

@Entity
public class Product {
    @Id
    private Long id;

    @Column
    private String title;
}
`)
    const tables = await parseJpaEntities(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    const col = (tables[0]?.columns ?? []).find(c => c.name === 'title')
    expect(col?.nullable).toBe(true)
  })

  it('@JoinColumn(name = "author_id") → ColumnDef 컬럼명 author_id', async () => {
    await writeFile('Post.java', `
import jakarta.persistence.*;

@Entity
public class Post {
    @Id
    private Long id;

    @ManyToOne
    @JoinColumn(name = "author_id")
    private User author;
}
`)
    const tables = await parseJpaEntities(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    const names = (tables[0]?.columns ?? []).map(c => c.name)
    expect(names).toContain('author_id')
    expect(names).not.toContain('author')
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

  it('@Id 필드 nullable=false (II-A-4)', async () => {
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
    const idCol = (tables[0]?.columns ?? []).find(c => c.name === 'id')
    expect(idCol?.nullable).toBe(false)
    const nameCol = (tables[0]?.columns ?? []).find(c => c.name === 'name')
    expect(nameCol?.nullable).toBe(true)
  })

  it('@ManyToOne → references 채우기 + JPA convention column name (II-A-3)', async () => {
    await writeFile('Post.java', `
import jakarta.persistence.*;

@Entity
public class Post {
    @Id
    private Long id;

    @ManyToOne
    private User author;
}
`)
    const tables = await parseJpaEntities(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    const fkCol = (tables[0]?.columns ?? []).find(c => c.name === 'author_id')
    expect(fkCol).toBeDefined()
    expect(fkCol?.references?.table).toBe('User')
    expect(fkCol?.references?.column).toBe('id')
  })

  it('@ManyToOne + @JoinColumn → JoinColumn name + references (II-A-3)', async () => {
    await writeFile('Post.java', `
import jakarta.persistence.*;

@Entity
public class Post {
    @Id
    private Long id;

    @ManyToOne
    @JoinColumn(name = "author_id")
    private User author;
}
`)
    const tables = await parseJpaEntities(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    const fkCol = (tables[0]?.columns ?? []).find(c => c.name === 'author_id')
    expect(fkCol).toBeDefined()
    expect(fkCol?.references?.table).toBe('User')
    expect(fkCol?.references?.column).toBe('id')
  })

  it('@OneToMany 필드는 FK 컬럼 없음 (inverse side 스킵)', async () => {
    await writeFile('User.java', `
import jakarta.persistence.*;
import java.util.List;

@Entity
public class User {
    @Id
    private Long id;

    @OneToMany(mappedBy = "author")
    private List<Post> posts;
}
`)
    const tables = await parseJpaEntities(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    const names = (tables[0]?.columns ?? []).map(c => c.name)
    expect(names).not.toContain('posts')
    expect(names).not.toContain('posts_id')
  })
})
