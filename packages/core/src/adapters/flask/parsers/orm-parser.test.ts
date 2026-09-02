import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseFlaskSqlAlchemyModels } from './orm-parser.js'
import { ORM_CLASS_PREFIX, readOrmClassName } from '@codebase-viz/types'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

let tmpDir: string
beforeEach(async () => { tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cv-flask-orm-')) })
afterEach(async () => { await fs.rm(tmpDir, { recursive: true, force: true }) })

async function writeFile(relPath: string, content: string): Promise<void> {
  const absPath = path.join(tmpDir, relPath)
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, content, 'utf-8')
}

describe('parseFlaskSqlAlchemyModels', () => {
  it('db.Model 서브클래스 → TableNode 생성', async () => {
    await writeFile('models.py', `
from flask_sqlalchemy import SQLAlchemy
db = SQLAlchemy()

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(80), nullable=False)
`)
    const tables = await parseFlaskSqlAlchemyModels(tmpDir, 'test')
    expect(tables.length).toBeGreaterThanOrEqual(1)
    const userTable = tables.find(t => t.name === 'User')
    expect(userTable).toBeDefined()
  })

  it('컬럼 타입 및 nullable 파싱', async () => {
    await writeFile('models.py', `
from flask_sqlalchemy import SQLAlchemy
db = SQLAlchemy()

class Post(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    body = db.Column(db.Text, nullable=True)
`)
    const tables = await parseFlaskSqlAlchemyModels(tmpDir, 'test')
    const postTable = tables.find(t => t.name === 'Post')
    expect(postTable?.columns.length).toBeGreaterThanOrEqual(2)
  })

  it('SQLAlchemy 없는 파일은 스킵', async () => {
    await writeFile('views.py', `
def index():
    return 'Hello'
`)
    const tables = await parseFlaskSqlAlchemyModels(tmpDir, 'test')
    expect(tables).toEqual([])
  })

  it('primary_key 컬럼은 nullable=false', async () => {
    await writeFile('models.py', `
from flask_sqlalchemy import SQLAlchemy
db = SQLAlchemy()

class Item(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    label = db.Column(db.String(50), nullable=False)
`)
    const tables = await parseFlaskSqlAlchemyModels(tmpDir, 'test')
    const itemTable = tables.find(t => t.name === 'Item')
    const idCol = itemTable?.columns.find(c => c.name === 'id')
    expect(idCol?.nullable).toBe(false)
    expect(idCol?.isPrimaryKey).toBe(true)
  })

  it('__tablename__ 재정의 반영', async () => {
    await writeFile('models.py', `
from flask_sqlalchemy import SQLAlchemy
db = SQLAlchemy()

class Category(db.Model):
    __tablename__ = 'categories'
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
`)
    const tables = await parseFlaskSqlAlchemyModels(tmpDir, 'test')
    const cat = tables.find(t => t.name === 'categories')
    expect(cat).toBeDefined()
  })

  it('ForeignKey → references 생성 (X-1)', async () => {
    await writeFile('models.py', `
from flask_sqlalchemy import SQLAlchemy
db = SQLAlchemy()

class Post(db.Model):
    __tablename__ = 'posts'
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
`)
    const tables = await parseFlaskSqlAlchemyModels(tmpDir, 'test')
    const post = tables.find(t => t.name === 'posts')
    expect(post).toBeDefined()
    const userIdCol = post?.columns.find(c => c.name === 'user_id')
    expect(userIdCol?.references).toBeDefined()
    expect(userIdCol?.references?.table).toBe('users')
    expect(userIdCol?.references?.column).toBe('id')
  })

  it('provenance adapter 값 확인', async () => {
    await writeFile('models.py', `
from flask_sqlalchemy import SQLAlchemy
db = SQLAlchemy()

class Tag(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(50), nullable=False)
`)
    const tables = await parseFlaskSqlAlchemyModels(tmpDir, 'test')
    const tag = tables.find(t => t.name === 'Tag')
    expect(tag?.provenance.adapter).toBe('flask-orm-parser@0.1')
  })
})

// T5: `orm-class:` 센티넬 포맷 계약 고정. 이 단언이 없으면 파서가 inferenceChain 문구를 바꿔도
// verify.sh가 초록불인 채 Tab3 클래스명 배지만 조용히 사라진다(도입 전 이 파일의 inferenceChain
// 단언은 0건이었다). 소비측은 readOrmClassName()으로만 읽으므로 여기서 계약을 지킨다.
describe('parseFlaskSqlAlchemyModels — orm-class 센티넬 (T5)', () => {
  it('클래스명이 테이블명과 달라도 readOrmClassName으로 클래스명을 복원할 수 있다', async () => {
    await writeFile('app/models.py', `from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class DecoSheet(db.Model):
    __tablename__ = 'TB_HODS401'
    req_no = db.Column(db.String, primary_key=True)
`)
    const tables = await parseFlaskSqlAlchemyModels(tmpDir, 'test')
    const t = tables.find(x => x.name === 'TB_HODS401')
    expect(t, 'TB_HODS401 테이블 노드 없음').toBeDefined()
    expect(readOrmClassName(t!)).toBe('DecoSheet')
    expect(t!.name).toBe('TB_HODS401')
  })

  it('센티넬은 사람이 읽는 기존 문장을 대체하지 않고 함께 실린다', async () => {
    await writeFile('app/models.py', `from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


class DecoSheet(db.Model):
    __tablename__ = 'TB_HODS401'
    req_no = db.Column(db.String, primary_key=True)
`)
    const tables = await parseFlaskSqlAlchemyModels(tmpDir, 'test')
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
