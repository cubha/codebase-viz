import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseDecorators } from './decorator-parser.js'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-viz-fastapi-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeFile(relPath: string, content: string): Promise<void> {
  const absPath = path.join(tmpDir, relPath)
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, content, 'utf-8')
}

describe('parseDecorators (FastAPI)', () => {
  it('.py 없으면 빈 배열 반환', async () => {
    const nodes = await parseDecorators(tmpDir)
    expect(nodes).toEqual([])
  })

  it('@app.get("/") → path="/"', async () => {
    await writeFile('main.py', `
from fastapi import FastAPI
app = FastAPI()

@app.get('/')
def root():
    return {}
`)
    const nodes = await parseDecorators(tmpDir)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.path).toBe('/')
    expect(nodes[0]!.dynamicSegmentType).toBe('static')
    expect(nodes[0]!.confidence).toBe('verified')
  })

  it('@router.get("/users/{user_id}") → /users/:user_id, dynamic', async () => {
    await writeFile('routers/users.py', `
from fastapi import APIRouter
router = APIRouter()

@router.get('/users/{user_id}')
def get_user(user_id: int):
    return {}
`)
    const nodes = await parseDecorators(tmpDir)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.path).toBe('/users/:user_id')
    expect(nodes[0]!.dynamicSegmentType).toBe('dynamic')
  })

  it('@router.post, @router.delete 등 HTTP method 지원', async () => {
    await writeFile('api.py', `
from fastapi import APIRouter
router = APIRouter()

@router.get('/items')
def list_items():
    return []

@router.post('/items')
def create_item():
    return {}

@router.delete('/items/{item_id}')
def delete_item(item_id: int):
    return {}
`)
    const nodes = await parseDecorators(tmpDir)
    expect(nodes).toHaveLength(3)
    const paths = nodes.map(n => n.path).sort()
    expect(paths).toEqual(['/items', '/items', '/items/:item_id'].sort())
  })

  it('provenance에 adapter="fastapi@0.1" 포함', async () => {
    await writeFile('main.py', `
from fastapi import FastAPI
app = FastAPI()

@app.get('/health')
def health():
    return {}
`)
    const nodes = await parseDecorators(tmpDir, 'codebase-viz@0.1.0')
    expect(nodes[0]!.provenance.adapter).toBe('fastapi@0.1')
    expect(nodes[0]!.provenance.analyzerVersion).toBe('codebase-viz@0.1.0')
  })

  it('여러 파일 동시 수집', async () => {
    await writeFile('main.py', `
from fastapi import FastAPI
app = FastAPI()

@app.get('/')
def root():
    return {}
`)
    await writeFile('routers/users.py', `
from fastapi import APIRouter
router = APIRouter()

@router.get('/users')
def list_users():
    return []
`)
    const nodes = await parseDecorators(tmpDir)
    expect(nodes.length).toBeGreaterThanOrEqual(2)
  })

  it('APIRouter(prefix="/users") intra-file prefix 합성 → /users/list (verified)', async () => {
    await writeFile('api.py', `
from fastapi import APIRouter
router = APIRouter(prefix='/users')

@router.get('/list')
def list_users():
    return []

@router.get('/{user_id}')
def get_user(user_id: int):
    return {}
`)
    const nodes = await parseDecorators(tmpDir)
    expect(nodes).toHaveLength(2)
    const paths = nodes.map(n => n.path).sort()
    expect(paths).toContain('/users/list')
    expect(paths).toContain('/users/:user_id')
    nodes.forEach(n => expect(n.confidence).toBe('verified'))
  })

  it('include_router(X.router, prefix="/api") cross-file → /api/users (inferred)', async () => {
    await writeFile('main.py', `
from fastapi import FastAPI
from routers import users

app = FastAPI()
app.include_router(users.router, prefix='/api')

@app.get('/health')
def health():
    return {}
`)
    await writeFile('routers/users.py', `
from fastapi import APIRouter
router = APIRouter()

@router.get('/users')
def list_users():
    return []

@router.get('/users/{user_id}')
def get_user(user_id: int):
    return {}
`)
    const nodes = await parseDecorators(tmpDir)
    const paths = nodes.map(n => n.path)
    expect(paths).toContain('/health')
    expect(paths).toContain('/api/users')
    expect(paths).toContain('/api/users/:user_id')

    const inferredRoutes = nodes.filter(n => n.confidence === 'inferred')
    expect(inferredRoutes.length).toBeGreaterThanOrEqual(2)
    if (inferredRoutes[0]?.confidence === 'inferred') {
      expect(inferredRoutes[0].inferenceChain).toBeDefined()
    }
  })
})
