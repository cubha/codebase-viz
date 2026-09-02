import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseDjangoOrmModels } from './orm-parser.js'
import { ORM_CLASS_PREFIX, readOrmClassName } from '@codebase-viz/types'
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

  it('null=True가 있는 필드는 nullable: true, 없으면 nullable: false', async () => {
    await writeFile('api/models.py', `
from django.db import models

class User(models.Model):
    name = models.CharField(max_length=100, null=True)
    email = models.EmailField()
`)
    const tables = await parseDjangoOrmModels(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    const cols = tables[0]?.columns ?? []
    expect(cols.find(c => c.name === 'name')?.nullable).toBe(true)
    expect(cols.find(c => c.name === 'email')?.nullable).toBe(false)
  })

  it('ForeignKey 첫 번째 인자에서 대상 모델명 추출', async () => {
    await writeFile('api/models.py', `
from django.db import models

class Post(models.Model):
    author = models.ForeignKey('User', on_delete=models.CASCADE)
    related = models.OneToOneField(Profile, on_delete=models.CASCADE)
`)
    const tables = await parseDjangoOrmModels(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    const cols = tables[0]?.columns ?? []
    expect(cols.find(c => c.name === 'author')?.type).toBe('ForeignKey→User')
    expect(cols.find(c => c.name === 'related')?.type).toBe('OneToOneField→Profile')
  })

  it('ForeignKey → ColumnDef.references 생성', async () => {
    await writeFile('api/models.py', `
from django.db import models

class Author(models.Model):
    name = models.CharField(max_length=100)

class Book(models.Model):
    title = models.CharField(max_length=200)
    author = models.ForeignKey(Author, on_delete=models.CASCADE)
`)
    const tables = await parseDjangoOrmModels(tmpDir, 'test')
    const bookTable = tables.find(t => t.name === 'Book')
    const authorCol = bookTable?.columns.find(c => c.name === 'author')
    expect(authorCol?.references).toBeDefined()
    expect(authorCol?.references?.table).toBe('Author')
    expect(authorCol?.references?.column).toBe('id')
  })

  it('Meta 클래스 db_table 값을 테이블명으로 사용', async () => {
    await writeFile('api/models.py', `
from django.db import models

class User(models.Model):
    name = models.CharField(max_length=100)

    class Meta:
        db_table = 'auth_users'
`)
    const tables = await parseDjangoOrmModels(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    expect(tables[0]?.name).toBe('auth_users')
  })

  it('ManyToManyField → column으로 추출 + references 생성 (N-7)', async () => {
    await writeFile('api/models.py', `
from django.db import models

class Post(models.Model):
    tags = models.ManyToManyField('Tag', blank=True)
    title = models.CharField(max_length=200)
`)
    const tables = await parseDjangoOrmModels(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    const cols = tables[0]?.columns ?? []
    const tagsCol = cols.find(c => c.name === 'tags')
    expect(tagsCol).toBeDefined()
    expect(tagsCol?.type).toBe('ManyToManyField→Tag')
    expect(tagsCol?.references?.table).toBe('Tag')
    expect(tagsCol?.references?.column).toBe('id')
  })

  it('ManyToManyField identifier target → references 생성 (N-7)', async () => {
    await writeFile('api/models.py', `
from django.db import models

class Article(models.Model):
    categories = models.ManyToManyField(Category)
    body = models.TextField()
`)
    const tables = await parseDjangoOrmModels(tmpDir, 'test')
    expect(tables).toHaveLength(1)
    const categoriesCol = (tables[0]?.columns ?? []).find(c => c.name === 'categories')
    expect(categoriesCol?.references?.table).toBe('Category')
  })
})

// T5: `orm-class:` 센티넬 포맷 계약 고정. 이 단언이 없으면 파서가 inferenceChain 문구를 바꿔도
// verify.sh가 초록불인 채 Tab3 클래스명 배지만 조용히 사라진다(도입 전 이 파일의 inferenceChain
// 단언은 0건이었다). 소비측은 readOrmClassName()으로만 읽으므로 여기서 계약을 지킨다.
describe('parseDjangoOrmModels — orm-class 센티넬 (T5)', () => {
  it('클래스명이 테이블명과 달라도 readOrmClassName으로 클래스명을 복원할 수 있다', async () => {
    await writeFile('app/models.py', `from django.db import models


class DecoSheet(models.Model):
    req_no = models.CharField(max_length=32)

    class Meta:
        db_table = 'TB_HODS401'
`)
    const tables = await parseDjangoOrmModels(tmpDir, 'test')
    const t = tables.find(x => x.name === 'TB_HODS401')
    expect(t, 'TB_HODS401 테이블 노드 없음').toBeDefined()
    expect(readOrmClassName(t!)).toBe('DecoSheet')
    expect(t!.name).toBe('TB_HODS401')
  })

  it('센티넬은 사람이 읽는 기존 문장을 대체하지 않고 함께 실린다', async () => {
    await writeFile('app/models.py', `from django.db import models


class DecoSheet(models.Model):
    req_no = models.CharField(max_length=32)

    class Meta:
        db_table = 'TB_HODS401'
`)
    const tables = await parseDjangoOrmModels(tmpDir, 'test')
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
