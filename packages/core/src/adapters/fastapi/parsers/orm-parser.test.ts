import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseSqlAlchemyModels } from './orm-parser.js'
import { ORM_CLASS_PREFIX, readOrmClassName } from '@codebase-viz/types'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-viz-fastapi-orm-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeFile(relPath: string, content: string): Promise<void> {
  const absPath = path.join(tmpDir, relPath)
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, content, 'utf-8')
}

describe('parseSqlAlchemyModels', () => {
  it('.py 파일 없으면 빈 배열 반환', async () => {
    const tables = await parseSqlAlchemyModels(tmpDir, 'test')
    expect(tables).toEqual([])
  })

  it('Column 없는 파일은 스킵', async () => {
    await writeFile('models.py', `
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass
`)
    const tables = await parseSqlAlchemyModels(tmpDir, 'test')
    expect(tables).toEqual([])
  })

  it('Base 서브클래스에서 TableNode 추출', async () => {
    await writeFile('models.py', `
from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = 'users'
    id = Column(Integer, primary_key=True)
    name = Column(String)
`)
    const tables = await parseSqlAlchemyModels(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    expect(tables[0]?.name).toBe('users')
    expect(tables[0]?.confidence).toBe('inferred')
  })

  it('Column 할당 추출 — type은 실제 SQLAlchemy 타입명으로 기록됨', async () => {
    await writeFile('models.py', `
from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

class Post(Base):
    __tablename__ = 'posts'
    id = Column(Integer, primary_key=True)
    title = Column(String)
    body = Column(String)
`)
    const tables = await parseSqlAlchemyModels(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    const cols = tables[0]?.columns ?? []
    expect(cols.map(c => c.name)).toEqual(expect.arrayContaining(['id', 'title', 'body']))
    expect(cols[0]?.type).toBe('Integer')
  })

  it('Column 없는 Base 서브클래스는 추출 안 됨', async () => {
    await writeFile('models.py', `
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

class EmptyModel(Base):
    __tablename__ = 'empty'
`)
    const tables = await parseSqlAlchemyModels(tmpDir, 'test')
    expect(tables).toEqual([])
  })

  it('복수 모델 모두 추출', async () => {
    await writeFile('models.py', `
from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = 'users'
    id = Column(Integer)
    name = Column(String)

class Post(Base):
    __tablename__ = 'posts'
    id = Column(Integer)
    title = Column(String)
`)
    const tables = await parseSqlAlchemyModels(tmpDir, 'test')
    expect(tables).toHaveLength(2)
    expect(tables.map(t => t.name)).toEqual(expect.arrayContaining(['users', 'posts']))
  })

  it('NodeId가 결정론적으로 생성됨 (className 기반)', async () => {
    await writeFile('models.py', `
from sqlalchemy import Column, Integer
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = 'users'
    id = Column(Integer)
`)
    const tables = await parseSqlAlchemyModels(tmpDir, 'test')
    expect(tables[0]?.id).toBe('table:models.py:User')
  })

  it('nullable=False → nullable: false', async () => {
    await writeFile('models.py', `
from sqlalchemy import Column, String
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = 'users'
    name = Column(String, nullable=False)
`)
    const tables = await parseSqlAlchemyModels(tmpDir, 'test')
    const cols = tables[0]?.columns ?? []
    const nameCol = cols.find(c => c.name === 'name')
    expect(nameCol?.nullable).toBe(false)
  })

  it('nullable=True → nullable: true', async () => {
    await writeFile('models.py', `
from sqlalchemy import Column, String
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = 'users'
    email = Column(String, nullable=True)
`)
    const tables = await parseSqlAlchemyModels(tmpDir, 'test')
    const cols = tables[0]?.columns ?? []
    const emailCol = cols.find(c => c.name === 'email')
    expect(emailCol?.nullable).toBe(true)
  })

  it('nullable 미지정 시 기본값 true', async () => {
    await writeFile('models.py', `
from sqlalchemy import Column, String
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = 'users'
    name = Column(String)
`)
    const tables = await parseSqlAlchemyModels(tmpDir, 'test')
    const cols = tables[0]?.columns ?? []
    const nameCol = cols.find(c => c.name === 'name')
    expect(nameCol?.nullable).toBe(true)
  })

  it('__tablename__ 값을 테이블명으로 사용', async () => {
    await writeFile('models.py', `
from sqlalchemy import Column, Integer
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

class UserAccount(Base):
    __tablename__ = 'user_accounts'
    id = Column(Integer)
`)
    const tables = await parseSqlAlchemyModels(tmpDir, 'test')
    expect(tables[0]?.name).toBe('user_accounts')
  })

  it('__tablename__ 없으면 클래스명 사용', async () => {
    await writeFile('models.py', `
from sqlalchemy import Column, Integer
from sqlalchemy.orm import Base

class Product(Base):
    id = Column(Integer)
`)
    const tables = await parseSqlAlchemyModels(tmpDir, 'test')
    expect(tables[0]?.name).toBe('Product')
  })

  it('Column 첫 인자에서 타입명 추출 (String, Integer 등)', async () => {
    await writeFile('models.py', `
from sqlalchemy import Column, Integer, String, JSON
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

class Item(Base):
    __tablename__ = 'items'
    id = Column(Integer)
    name = Column(String)
    data = Column(JSON)
`)
    const tables = await parseSqlAlchemyModels(tmpDir, 'test')
    const cols = tables[0]?.columns ?? []
    expect(cols.find(c => c.name === 'id')?.type).toBe('Integer')
    expect(cols.find(c => c.name === 'name')?.type).toBe('String')
    expect(cols.find(c => c.name === 'data')?.type).toBe('JSON')
  })

  it('ForeignKey 참조가 있는 Column → 타입명→FK로 표시', async () => {
    await writeFile('models.py', `
from sqlalchemy import Column, Integer, ForeignKey
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

class Post(Base):
    __tablename__ = 'posts'
    user_id = Column(Integer, ForeignKey('users.id'))
`)
    const tables = await parseSqlAlchemyModels(tmpDir, 'test')
    const cols = tables[0]?.columns ?? []
    const userIdCol = cols.find(c => c.name === 'user_id')
    expect(userIdCol?.type).toBe('Integer→FK')
  })

  it('mapped_column primary_key=True → isPrimaryKey: true (II-C-2)', async () => {
    await writeFile('models.py', `
from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from typing import Optional

class Base(DeclarativeBase):
    pass

class User(Base):
    __tablename__ = 'users'
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column()
    bio: Mapped[Optional[str]] = mapped_column()
`)
    const tables = await parseSqlAlchemyModels(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    const cols = tables[0]?.columns ?? []
    const idCol = cols.find(c => c.name === 'id')
    expect(idCol?.isPrimaryKey).toBe(true)
    expect(idCol?.nullable).toBe(false)
  })

  it('Mapped[str] → nullable: false, Mapped[Optional[str]] → nullable: true (II-C-2)', async () => {
    await writeFile('models.py', `
from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from typing import Optional

class Base(DeclarativeBase):
    pass

class Post(Base):
    __tablename__ = 'posts'
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column()
    body: Mapped[Optional[str]] = mapped_column()
`)
    const tables = await parseSqlAlchemyModels(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    const cols = tables[0]?.columns ?? []
    const titleCol = cols.find(c => c.name === 'title')
    const bodyCol = cols.find(c => c.name === 'body')
    expect(titleCol?.nullable).toBe(false)
    expect(bodyCol?.nullable).toBe(true)
  })

  it('기존 Column 스타일에도 isPrimaryKey 동작 (II-C-2)', async () => {
    await writeFile('models.py', `
from sqlalchemy import Column, Integer, String
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

class Item(Base):
    __tablename__ = 'items'
    id = Column(Integer, primary_key=True)
    name = Column(String)
`)
    const tables = await parseSqlAlchemyModels(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    const cols = tables[0]?.columns ?? []
    const idCol = cols.find(c => c.name === 'id')
    expect(idCol?.isPrimaryKey).toBe(true)
  })

  it('ForeignKey("users.id") → references { table: "users", column: "id" } (B-4)', async () => {
    await writeFile('models.py', `
from sqlalchemy import Column, Integer, ForeignKey
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

class Post(Base):
    __tablename__ = 'posts'
    id = Column(Integer, primary_key=True)
    user_id = Column(Integer, ForeignKey('users.id'))
`)
    const tables = await parseSqlAlchemyModels(tmpDir, 'test')
    const cols = tables[0]?.columns ?? []
    const userIdCol = cols.find(c => c.name === 'user_id')
    expect(userIdCol?.references).toBeDefined()
    expect(userIdCol?.references?.table).toBe('users')
    expect(userIdCol?.references?.column).toBe('id')
  })

  it('ForeignKey("categories") → references { table: "categories", column: "id" } (B-4)', async () => {
    await writeFile('models.py', `
from sqlalchemy import Column, Integer, ForeignKey
from sqlalchemy.orm import DeclarativeBase

class Base(DeclarativeBase):
    pass

class Article(Base):
    __tablename__ = 'articles'
    id = Column(Integer, primary_key=True)
    category_id = Column(Integer, ForeignKey('categories'))
`)
    const tables = await parseSqlAlchemyModels(tmpDir, 'test')
    const cols = tables[0]?.columns ?? []
    const catCol = cols.find(c => c.name === 'category_id')
    expect(catCol?.references).toBeDefined()
    expect(catCol?.references?.table).toBe('categories')
    expect(catCol?.references?.column).toBe('id')
  })
})

// T5: `orm-class:` 센티넬 포맷 계약 고정. 이 단언이 없으면 파서가 inferenceChain 문구를 바꿔도
// verify.sh가 초록불인 채 Tab3 클래스명 배지만 조용히 사라진다(도입 전 이 파일의 inferenceChain
// 단언은 0건이었다). 소비측은 readOrmClassName()으로만 읽으므로 여기서 계약을 지킨다.
describe('parseSqlAlchemyModels — orm-class 센티넬 (T5)', () => {
  it('클래스명이 테이블명과 달라도 readOrmClassName으로 클래스명을 복원할 수 있다', async () => {
    await writeFile('app/models.py', `from sqlalchemy.orm import declarative_base
from sqlalchemy import Column, String

Base = declarative_base()


class DecoSheet(Base):
    __tablename__ = 'TB_HODS401'
    req_no = Column(String, primary_key=True)
`)
    const tables = await parseSqlAlchemyModels(tmpDir, 'test')
    const t = tables.find(x => x.name === 'TB_HODS401')
    expect(t, 'TB_HODS401 테이블 노드 없음').toBeDefined()
    expect(readOrmClassName(t!)).toBe('DecoSheet')
    expect(t!.name).toBe('TB_HODS401')
  })

  it('센티넬은 사람이 읽는 기존 문장을 대체하지 않고 함께 실린다', async () => {
    await writeFile('app/models.py', `from sqlalchemy.orm import declarative_base
from sqlalchemy import Column, String

Base = declarative_base()


class DecoSheet(Base):
    __tablename__ = 'TB_HODS401'
    req_no = Column(String, primary_key=True)
`)
    const tables = await parseSqlAlchemyModels(tmpDir, 'test')
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
