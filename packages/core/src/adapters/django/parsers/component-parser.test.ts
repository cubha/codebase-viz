import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseDjangoComponents } from './component-parser.js'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-viz-django-comp-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeFile(relPath: string, content: string): Promise<void> {
  const absPath = path.join(tmpDir, relPath)
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, content, 'utf-8')
}

describe('parseDjangoComponents', () => {
  it('views 파일 없으면 빈 배열 반환', async () => {
    const nodes = await parseDjangoComponents(tmpDir, 'test')
    expect(nodes).toEqual([])
  })

  it('View 서브클래스 추출', async () => {
    await writeFile('api/views.py', `
from django.views import View

class UserView(View):
    pass
`)
    const nodes = await parseDjangoComponents(tmpDir, 'test')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.name).toBe('UserView')
    expect(nodes[0]?.runtime).toBe('server')
    expect(nodes[0]?.confidence).toBe('inferred')
  })

  it('ModelViewSet 서브클래스 추출', async () => {
    await writeFile('api/views.py', `
from rest_framework.viewsets import ModelViewSet

class UserViewSet(ModelViewSet):
    pass
`)
    const nodes = await parseDjangoComponents(tmpDir, 'test')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.name).toBe('UserViewSet')
  })

  it('복수 View 클래스 모두 추출', async () => {
    await writeFile('api/views.py', `
class UserListView(ListView):
    pass

class UserDetailView(DetailView):
    pass
`)
    const nodes = await parseDjangoComponents(tmpDir, 'test')
    expect(nodes).toHaveLength(2)
    const names = nodes.map(n => n.name)
    expect(names).toContain('UserListView')
    expect(names).toContain('UserDetailView')
  })

  it('View 서브클래스 아닌 일반 클래스는 추출 안 됨', async () => {
    await writeFile('api/views.py', `
class Helper:
    pass

class Config:
    pass
`)
    const nodes = await parseDjangoComponents(tmpDir, 'test')
    expect(nodes).toEqual([])
  })

  it('함수형 view는 추출 안 됨 (현 구현: 클래스 기반만 지원)', async () => {
    await writeFile('api/views.py', `
def my_view(request):
    return None
`)
    const nodes = await parseDjangoComponents(tmpDir, 'test')
    expect(nodes).toEqual([])
  })

  it('NodeId가 결정론적으로 생성됨', async () => {
    await writeFile('api/views.py', `
class UserView(View):
    pass
`)
    const nodes = await parseDjangoComponents(tmpDir, 'test')
    expect(nodes[0]?.id).toBe('component:api/views.py:UserView')
  })

  it('파일명에 views 포함된 파일도 스캔', async () => {
    await writeFile('api/user_views.py', `
class ProfileView(View):
    pass
`)
    const nodes = await parseDjangoComponents(tmpDir, 'test')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.name).toBe('ProfileView')
  })
})
