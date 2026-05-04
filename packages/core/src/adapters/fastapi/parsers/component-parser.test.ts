import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseFastapiComponents } from './component-parser.js'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-viz-fastapi-comp-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeFile(relPath: string, content: string): Promise<void> {
  const absPath = path.join(tmpDir, relPath)
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, content, 'utf-8')
}

describe('parseFastapiComponents', () => {
  it('.py 파일 없으면 빈 배열 반환', async () => {
    const nodes = await parseFastapiComponents(tmpDir, 'test')
    expect(nodes).toEqual([])
  })

  it('BaseModel 없는 파일은 스킵', async () => {
    await writeFile('main.py', `
from fastapi import FastAPI
app = FastAPI()
`)
    const nodes = await parseFastapiComponents(tmpDir, 'test')
    expect(nodes).toEqual([])
  })

  it('BaseModel 서브클래스 추출', async () => {
    await writeFile('schemas.py', `
from pydantic import BaseModel

class UserSchema(BaseModel):
    name: str
    email: str
`)
    const nodes = await parseFastapiComponents(tmpDir, 'test')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.name).toBe('UserSchema')
    expect(nodes[0]?.runtime).toBe('server')
    expect(nodes[0]?.confidence).toBe('inferred')
  })

  it('Schema suffix 클래스도 추출 (BaseModel 직접 상속 필요)', async () => {
    await writeFile('schemas.py', `
from pydantic import BaseModel

class UserCreateSchema(BaseModel):
    name: str

class PostSchema(BaseModel):
    title: str
`)
    const nodes = await parseFastapiComponents(tmpDir, 'test')
    expect(nodes).toHaveLength(2)
    const names = nodes.map(n => n.name)
    expect(names).toContain('UserCreateSchema')
    expect(names).toContain('PostSchema')
  })

  it('BaseModel/Schema 아닌 일반 클래스는 추출 안 됨', async () => {
    await writeFile('schemas.py', `
from pydantic import BaseModel

class Helper:
    pass

class UserSchema(BaseModel):
    name: str
`)
    const nodes = await parseFastapiComponents(tmpDir, 'test')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.name).toBe('UserSchema')
  })

  it('APIRouter 포함 파일에서도 BaseModel 추출', async () => {
    await writeFile('routers/users.py', `
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter()

class UserSchema(BaseModel):
    id: int
    name: str
`)
    const nodes = await parseFastapiComponents(tmpDir, 'test')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.name).toBe('UserSchema')
  })

  it('NodeId가 결정론적으로 생성됨', async () => {
    await writeFile('schemas.py', `
from pydantic import BaseModel

class UserSchema(BaseModel):
    name: str
`)
    const nodes = await parseFastapiComponents(tmpDir, 'test')
    expect(nodes[0]?.id).toBe('component:schemas.py:UserSchema')
  })
})
