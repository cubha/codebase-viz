import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseJpaEntities } from './orm-parser.js'
import { ORM_CLASS_PREFIX, readOrmClassName } from '@codebase-viz/types'
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

  it('@OneToOne → references 채우기 + JPA convention column name (N-6)', async () => {
    await writeFile('OrderDetail.java', `
import jakarta.persistence.*;

@Entity
public class OrderDetail {
    @Id
    private Long id;

    @OneToOne
    private Order order;
}
`)
    const tables = await parseJpaEntities(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    const fkCol = (tables[0]?.columns ?? []).find(c => c.name === 'order_id')
    expect(fkCol).toBeDefined()
    expect(fkCol?.references?.table).toBe('Order')
    expect(fkCol?.references?.column).toBe('id')
  })

  it('@OneToOne + @JoinColumn → JoinColumn name + references (N-6)', async () => {
    await writeFile('UserProfile.java', `
import jakarta.persistence.*;

@Entity
public class UserProfile {
    @Id
    private Long id;

    @OneToOne
    @JoinColumn(name = "user_id")
    private User user;
}
`)
    const tables = await parseJpaEntities(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    const fkCol = (tables[0]?.columns ?? []).find(c => c.name === 'user_id')
    expect(fkCol).toBeDefined()
    expect(fkCol?.references?.table).toBe('User')
    expect(fkCol?.references?.column).toBe('id')
  })

  it('@Column(name = "user_name") → ColumnDef 컬럼명 user_name (N-11b)', async () => {
    await writeFile('User.java', `
import jakarta.persistence.*;

@Entity
public class User {
    @Id
    private Long id;

    @Column(name = "user_name")
    private String username;
}
`)
    const tables = await parseJpaEntities(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    const cols = tables[0]?.columns ?? []
    expect(cols.some(c => c.name === 'user_name')).toBe(true)
    expect(cols.some(c => c.name === 'username')).toBe(false)
  })

  it('@Column(name=...) + nullable=false 둘 다 파싱 (N-11b)', async () => {
    await writeFile('Product.java', `
import jakarta.persistence.*;

@Entity
public class Product {
    @Id
    private Long id;

    @Column(name = "product_name", nullable = false)
    private String name;
}
`)
    const tables = await parseJpaEntities(tmpDir, 'test')
    const col = (tables[0]?.columns ?? []).find(c => c.name === 'product_name')
    expect(col).toBeDefined()
    expect(col?.nullable).toBe(false)
  })

  it('@ManyToOne FK 타겟 클래스가 @Table(name=)를 가진 경우 실제 테이블명으로 references 해석 (N-12)', async () => {
    await writeFile('User.java', `
import jakarta.persistence.*;

@Entity
@Table(name = "users")
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

    @ManyToOne
    private User author;
}
`)
    const tables = await parseJpaEntities(tmpDir, 'test')
    const postTable = tables.find(t => t.name === 'Post')
    expect(postTable).toBeDefined()
    const fkCol = (postTable?.columns ?? []).find(c => c.name === 'author_id')
    expect(fkCol).toBeDefined()
    // User의 @Table(name="users") → references.table = "users", 클래스명 "User" 아님
    expect(fkCol?.references?.table).toBe('users')
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

// T5: `orm-class:` 센티넬 포맷 계약 고정. 이 단언이 없으면 파서가 inferenceChain 문구를 바꿔도
// verify.sh가 초록불인 채 Tab3 클래스명 배지만 조용히 사라진다(도입 전 이 파일의 inferenceChain
// 단언은 0건이었다). 소비측은 readOrmClassName()으로만 읽으므로 여기서 계약을 지킨다.
describe('parseJpaEntities — orm-class 센티넬 (T5)', () => {
  it('클래스명이 테이블명과 달라도 readOrmClassName으로 클래스명을 복원할 수 있다', async () => {
    await writeFile('src/main/java/com/x/DecoSheet.java', `package com.x;
import jakarta.persistence.*;

@Entity
@Table(name = "TB_HODS401")
public class DecoSheet {
    @Id
    private String reqNo;
}
`)
    const tables = await parseJpaEntities(tmpDir, 'test')
    const t = tables.find(x => x.name === 'TB_HODS401')
    expect(t, 'TB_HODS401 테이블 노드 없음').toBeDefined()
    expect(readOrmClassName(t!)).toBe('DecoSheet')
    expect(t!.name).toBe('TB_HODS401')
  })

  it('센티넬은 사람이 읽는 기존 문장을 대체하지 않고 함께 실린다', async () => {
    await writeFile('src/main/java/com/x/DecoSheet.java', `package com.x;
import jakarta.persistence.*;

@Entity
@Table(name = "TB_HODS401")
public class DecoSheet {
    @Id
    private String reqNo;
}
`)
    const tables = await parseJpaEntities(tmpDir, 'test')
    const t = tables.find(x => x.name === 'TB_HODS401')!
    expect(t.confidence).toBe('inferred')
    const chain = t.confidence === 'inferred' ? t.inferenceChain : []
    expect(chain.some(e => e.startsWith(ORM_CLASS_PREFIX))).toBe(true)
    expect(chain.some(e => !e.startsWith(ORM_CLASS_PREFIX) && e.includes('DecoSheet'))).toBe(true)
    // 순서 계약: 센티넬은 **뒤에** 붙어야 한다. node-map.ts가 `inferenceChain[0]`을 그대로 hover
    // 툴팁에 싣기 때문에, 센티넬이 앞에 오면 사용자에게 `orm-class:DecoSheet`가 노출된다
    // (scope-critic 지적 — 이전엔 구현 관례일 뿐 코드로 강제되지 않았다).
    expect(chain[0]!.startsWith(ORM_CLASS_PREFIX)).toBe(false)
  })
})
