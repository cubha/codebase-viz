import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { FrameworkKind } from './schema.js'

export interface StackInfo {
  framework: FrameworkKind
  hasSupabase: boolean
  hasPrisma: boolean
  hasDexie: boolean
  isMonorepo: boolean
  appDirs: string[]
}

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await fs.readFile(filePath, 'utf8')
    return JSON.parse(content) as Record<string, unknown>
  } catch {
    return null
  }
}

function getDeps(pkg: Record<string, unknown>): Record<string, string> {
  return {
    ...(pkg['dependencies'] as Record<string, string> ?? {}),
    ...(pkg['devDependencies'] as Record<string, string> ?? {}),
  }
}

async function hasPath(...segments: string[]): Promise<boolean> {
  try {
    await fs.access(path.join(...segments))
    return true
  } catch {
    return false
  }
}

async function detectMonorepoApps(repoRoot: string): Promise<string[]> {
  const candidates = ['apps', 'packages']
  const dirs: string[] = []
  for (const candidate of candidates) {
    const candidatePath = path.join(repoRoot, candidate)
    try {
      const entries = await fs.readdir(candidatePath, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const appPkg = await readJson(path.join(candidatePath, entry.name, 'package.json'))
        if (appPkg !== null) dirs.push(path.join(candidatePath, entry.name))
      }
    } catch {
      // directory doesn't exist
    }
  }
  return dirs
}

export async function detectStack(repoRoot: string): Promise<StackInfo> {
  const pkg = await readJson(path.join(repoRoot, 'package.json'))
  const deps = pkg !== null ? getDeps(pkg) : {}

  let framework: FrameworkKind = 'unknown'

  if ('next' in deps) {
    const appDir = await hasPath(repoRoot, 'app')
    const srcAppDir = await hasPath(repoRoot, 'src', 'app')
    framework = (appDir || srcAppDir) ? 'nextjs-app-router' : 'nextjs-pages'
  } else if ('nuxt' in deps) {
    framework = 'nuxt'
  } else if ('expo' in deps || '@expo/cli' in deps || 'expo-router' in deps) {
    framework = 'expo'
  } else if ('@sveltejs/kit' in deps) {
    framework = 'sveltekit'
  } else if ('vite' in deps && ('react' in deps || '@types/react' in deps)) {
    framework = 'vite-react'
  }

  const appDirs = await detectMonorepoApps(repoRoot)
  const isMonorepo = appDirs.length > 1

  return {
    framework,
    hasSupabase: '@supabase/supabase-js' in deps || '@supabase/ssr' in deps,
    hasPrisma: '@prisma/client' in deps,
    hasDexie: 'dexie' in deps,
    isMonorepo,
    appDirs,
  }
}
