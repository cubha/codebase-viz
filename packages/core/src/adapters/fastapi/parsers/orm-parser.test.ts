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
    expect(tables[0]?.name).toBe('User')
    expect(tables[0]?.confidence).toBe('inferred')
  })

  it('Column 할당 추출 — type은 Column/mapped_column으로 기록됨', async () => {
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
    expect(cols[0]?.type).toBe('Column')
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
    expect(tables.map(t => t.name)).toEqual(expect.arrayContaining(['User', 'Post']))
  })

  it('NodeId가 결정론적으로 생성됨', async () => {
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
})
