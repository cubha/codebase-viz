import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseDjangoOrmModels } from './orm-parser.js'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-viz-django-orm-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeFile(relPath: string, content: string): Promise<void> {
  const absPath = path.join(tmpDir, relPath)
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, content, 'utf-8')
}

describe('parseDjangoOrmModels', () => {
  it('models.py 없으면 빈 배열 반환', async () => {
    const tables = await parseDjangoOrmModels(tmpDir, 'test')
    expect(tables).toEqual([])
  })

  it('models.Model 없는 파일은 스킵', async () => {
    await writeFile('api/models.py', `
class NotAModel:
    name = "helper"
`)
    const tables = await parseDjangoOrmModels(tmpDir, 'test')
    expect(tables).toEqual([])
  })

  it('models.Model 서브클래스에서 TableNode 추출', async () => {
    await writeFile('api/models.py', `
from django.db import models

class User(models.Model):
    name = models.CharField(max_length=100)
    email = models.EmailField()
`)
    const tables = await parseDjangoOrmModels(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    expect(tables[0]?.name).toBe('User')
    expect(tables[0]?.confidence).toBe('inferred')
  })

  it('필드 이름과 타입 추출', async () => {
    await writeFile('api/models.py', `
from django.db import models

class Post(models.Model):
    title = models.CharField(max_length=200)
    body = models.TextField()
    created_at = models.DateTimeField()
`)
    const tables = await parseDjangoOrmModels(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    const cols = tables[0]?.columns ?? []
    expect(cols.map(c => c.name)).toEqual(expect.arrayContaining(['title', 'body', 'created_at']))
    expect(cols.find(c => c.name === 'title')?.type).toBe('CharField')
    expect(cols.find(c => c.name === 'body')?.type).toBe('TextField')
  })

  it('ForeignKey 필드도 column으로 추출됨', async () => {
    await writeFile('api/models.py', `
from django.db import models

class Post(models.Model):
    author = models.ForeignKey('User', on_delete=models.CASCADE)
    title = models.CharField(max_length=200)
`)
    const tables = await parseDjangoOrmModels(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    expect(tables[0]?.columns.map(c => c.name)).toContain('author')
  })

  it('복수 모델 모두 추출', async () => {
    await writeFile('api/models.py', `
from django.db import models

class User(models.Model):
    name = models.CharField(max_length=100)

class Post(models.Model):
    title = models.CharField(max_length=200)
`)
    const tables = await parseDjangoOrmModels(tmpDir, 'test')
    expect(tables).toHaveLength(2)
    expect(tables.map(t => t.name)).toEqual(expect.arrayContaining(['User', 'Post']))
  })

  it('NodeId가 결정론적으로 생성됨', async () => {
    await writeFile('api/models.py', `
from django.db import models

class User(models.Model):
    name = models.CharField(max_length=100)
`)
    const tables = await parseDjangoOrmModels(tmpDir, 'test')
    expect(tables[0]?.id).toBe('table:api/models.py:User')
  })

  it('서브디렉토리의 models.py도 스캔', async () => {
    await writeFile('users/models.py', `
from django.db import models

class Profile(models.Model):
    bio = models.TextField()
`)
    const tables = await parseDjangoOrmModels(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    expect(tables[0]?.name).toBe('Profile')
  })
})
