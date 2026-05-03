import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseUrls } from './urls-parser.js'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-viz-django-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeFile(relPath: string, content: string): Promise<void> {
  const absPath = path.join(tmpDir, relPath)
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, content, 'utf-8')
}

describe('parseUrls (Django)', () => {
  it('urls.py 없으면 빈 배열 반환', async () => {
    const nodes = await parseUrls(tmpDir)
    expect(nodes).toEqual([])
  })

  it('정적 경로: path("users/", ...) → /users', async () => {
    await writeFile('api/urls.py', `
from django.urls import path
from . import views
urlpatterns = [
    path('users/', views.UserListView.as_view(), name='user-list'),
]
`)
    const nodes = await parseUrls(tmpDir)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.path).toBe('/users')
    expect(nodes[0]!.dynamicSegmentType).toBe('static')
    expect(nodes[0]!.confidence).toBe('verified')
  })

  it('동적 경로: path("users/<int:pk>/", ...) → /users/:pk', async () => {
    await writeFile('api/urls.py', `
from django.urls import path
from . import views
urlpatterns = [
    path('users/<int:pk>/', views.UserDetailView.as_view()),
]
`)
    const nodes = await parseUrls(tmpDir)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.path).toBe('/users/:pk')
    expect(nodes[0]!.dynamicSegmentType).toBe('dynamic')
  })

  it('slug 변환: path("posts/<slug:slug>/") → /posts/:slug', async () => {
    await writeFile('api/urls.py', `
from django.urls import path
from . import views
urlpatterns = [
    path('posts/<slug:slug>/', views.PostDetailView.as_view()),
]
`)
    const nodes = await parseUrls(tmpDir)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.path).toBe('/posts/:slug')
  })

  it('include() 호출은 경로로 등록하지 않음', async () => {
    await writeFile('config/urls.py', `
from django.urls import path, include
urlpatterns = [
    path('api/', include('api.urls')),
]
`)
    const nodes = await parseUrls(tmpDir)
    expect(nodes).toHaveLength(0)
  })

  it('여러 urls.py: 모두 수집', async () => {
    await writeFile('api/urls.py', `
from django.urls import path
from . import views
urlpatterns = [
    path('users/', views.UserListView.as_view()),
    path('users/<int:pk>/', views.UserDetailView.as_view()),
]
`)
    await writeFile('blog/urls.py', `
from django.urls import path
from . import views
urlpatterns = [
    path('posts/', views.PostListView.as_view()),
]
`)
    const nodes = await parseUrls(tmpDir)
    expect(nodes).toHaveLength(3)
    const paths = nodes.map(n => n.path).sort()
    expect(paths).toEqual(['/posts', '/users', '/users/:pk'].sort())
  })

  it('provenance에 adapter="django@0.1" 포함', async () => {
    await writeFile('api/urls.py', `
from django.urls import path
from . import views
urlpatterns = [path('users/', views.UserListView.as_view())]
`)
    const nodes = await parseUrls(tmpDir, 'codebase-viz@0.1.0')
    expect(nodes[0]!.provenance.adapter).toBe('django@0.1')
    expect(nodes[0]!.provenance.analyzerVersion).toBe('codebase-viz@0.1.0')
  })

  it('include() prefix 합성 2-pass → /api/users (inferred)', async () => {
    await writeFile('config/urls.py', `
from django.urls import path, include
urlpatterns = [
    path('api/', include('api.urls')),
]
`)
    await writeFile('api/urls.py', `
from django.urls import path
from . import views
urlpatterns = [
    path('users/', views.UserListView.as_view()),
    path('users/<int:pk>/', views.UserDetailView.as_view()),
]
`)
    const nodes = await parseUrls(tmpDir)
    expect(nodes).toHaveLength(2)
    const paths = nodes.map(n => n.path).sort()
    expect(paths).toEqual(['/api/users', '/api/users/:pk'].sort())
    nodes.forEach(n => {
      expect(n.confidence).toBe('inferred')
      if (n.confidence === 'inferred') {
        expect(n.inferenceChain).toBeDefined()
        expect(n.inferenceChain![0]).toContain('include()')
      }
    })
  })

  it('include() 대상 파일 없으면 결과 없음', async () => {
    await writeFile('config/urls.py', `
from django.urls import path, include
urlpatterns = [path('api/', include('missing.urls'))]
`)
    const nodes = await parseUrls(tmpDir)
    expect(nodes).toHaveLength(0)
  })
})
