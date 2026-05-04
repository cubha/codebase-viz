import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseSqlAlchemyModels } from './orm-parser.js'
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
})
