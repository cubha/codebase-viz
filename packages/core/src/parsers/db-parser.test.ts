import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { parseTables } from './db-parser.js'

const SAMPLE_SUPABASE_TYPES = `
export type Json = string | number | boolean | null
export type Database = {
  public: {
    Tables: {
      posts: {
        Row: { id: string; title: string; content: string | null; author_id: string }
        Insert: { id?: string; title: string; content?: string | null; author_id: string }
        Update: { id?: string; title?: string; content?: string | null; author_id?: string }
        Relationships: [{
          foreignKeyName: "posts_author_id_fkey"
          columns: ["author_id"]
          isOneToOne: false
          referencedRelation: "profiles"
          referencedColumns: ["id"]
        }]
      }
      profiles: {
        Row: { id: string; username: string; avatar_url: string | null }
        Insert: { id: string; username: string; avatar_url?: string | null }
        Update: { id?: string; username?: string; avatar_url?: string | null }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
  }
}
`

describe('parseTables', () => {
  let tmpDir: string

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'db-parser-test-'))
    await fs.mkdir(path.join(tmpDir, 'types'), { recursive: true })
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('parses posts table', async () => {
    await fs.writeFile(path.join(tmpDir, 'types', 'supabase.ts'), SAMPLE_SUPABASE_TYPES)
    const tables = await parseTables(tmpDir)
    const posts = tables.find(t => t.name === 'posts')
    expect(posts).toBeDefined()
    expect(posts?.kind).toBe('table')
    expect(posts?.confidence).toBe('verified')
  })

  it('parses profiles table', async () => {
    await fs.writeFile(path.join(tmpDir, 'types', 'supabase.ts'), SAMPLE_SUPABASE_TYPES)
    const tables = await parseTables(tmpDir)
    const profiles = tables.find(t => t.name === 'profiles')
    expect(profiles).toBeDefined()
    expect(profiles?.kind).toBe('table')
  })

  it('posts.content is nullable', async () => {
    await fs.writeFile(path.join(tmpDir, 'types', 'supabase.ts'), SAMPLE_SUPABASE_TYPES)
    const tables = await parseTables(tmpDir)
    const posts = tables.find(t => t.name === 'posts')
    const content = posts?.columns.find(c => c.name === 'content')
    expect(content?.nullable).toBe(true)
  })

  it('posts.title is not nullable', async () => {
    await fs.writeFile(path.join(tmpDir, 'types', 'supabase.ts'), SAMPLE_SUPABASE_TYPES)
    const tables = await parseTables(tmpDir)
    const posts = tables.find(t => t.name === 'posts')
    const title = posts?.columns.find(c => c.name === 'title')
    expect(title?.nullable).toBe(false)
  })

  it('posts.author_id has FK reference to profiles.id', async () => {
    await fs.writeFile(path.join(tmpDir, 'types', 'supabase.ts'), SAMPLE_SUPABASE_TYPES)
    const tables = await parseTables(tmpDir)
    const posts = tables.find(t => t.name === 'posts')
    const authorId = posts?.columns.find(c => c.name === 'author_id')
    expect(authorId?.references).toEqual({ table: 'profiles', column: 'id' })
  })

  it('posts.id is marked as primary key', async () => {
    await fs.writeFile(path.join(tmpDir, 'types', 'supabase.ts'), SAMPLE_SUPABASE_TYPES)
    const tables = await parseTables(tmpDir)
    const posts = tables.find(t => t.name === 'posts')
    const idCol = posts?.columns.find(c => c.name === 'id')
    expect(idCol?.isPrimaryKey).toBe(true)
  })

  it('returns empty array when no supabase.ts found', async () => {
    const tables = await parseTables(tmpDir)
    expect(tables).toEqual([])
  })

  it('parses fixture mini-next-app types/supabase.ts', async () => {
    const fixtureRoot = path.resolve(
      new URL(import.meta.url).pathname,
      '../../../../..',
      'fixtures/mini-next-app',
    )
    const tables = await parseTables(fixtureRoot)
    expect(tables.length).toBe(2)

    const posts = tables.find(t => t.name === 'posts')
    expect(posts).toBeDefined()
    expect(posts?.columns.map(c => c.name)).toContain('created_at')

    const authorId = posts?.columns.find(c => c.name === 'author_id')
    expect(authorId?.references).toEqual({ table: 'profiles', column: 'id' })

    const profiles = tables.find(t => t.name === 'profiles')
    expect(profiles).toBeDefined()
  })
})
