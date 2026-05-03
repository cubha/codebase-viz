import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { parseFlaskRoutes } from './route-parser.js'

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-flask-test-'))
  await fs.writeFile(path.join(tmpDir, 'requirements.txt'), 'flask>=3.0.0\n')
  await fs.writeFile(
    path.join(tmpDir, 'app.py'),
    `from flask import Flask
app = Flask(__name__)

@app.route('/')
def index():
    return {}

@app.route('/health')
def health():
    return {}

@app.route('/users/<int:user_id>')
def get_user(user_id):
    return {}
`,
  )
})

afterAll(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('parseFlaskRoutes', () => {
  it('@app.route 라우트를 추출한다', async () => {
    const routes = await parseFlaskRoutes(tmpDir, 'test@0.1')
    expect(routes.length).toBeGreaterThanOrEqual(3)
    const paths = routes.map(r => r.path)
    expect(paths).toContain('/')
    expect(paths).toContain('/health')
  })

  it('동적 라우트를 감지한다', async () => {
    const routes = await parseFlaskRoutes(tmpDir, 'test@0.1')
    const dynamic = routes.find(r => r.path.includes(':user_id'))
    expect(dynamic).toBeDefined()
    expect(dynamic?.dynamicSegmentType).toBe('dynamic')
  })

  it('routeFileKind는 page', async () => {
    const routes = await parseFlaskRoutes(tmpDir, 'test@0.1')
    for (const r of routes) {
      expect(r.routeFileKind).toBe('page')
    }
  })

  it('파일 없으면 빈 배열 반환', async () => {
    const emptyDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-empty-'))
    const routes = await parseFlaskRoutes(emptyDir, 'test@0.1')
    expect(routes).toHaveLength(0)
    await fs.rm(emptyDir, { recursive: true, force: true })
  })
})
