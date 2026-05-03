import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { FrameworkKind, StackInfo, ParsingLevel } from '@codebase-viz/types'

export type { StackInfo } from '@codebase-viz/types'

interface FrameworkProfile {
  adapterId?: string          // undefined → no static adapter; LLM-only
  parsingLevel: ParsingLevel
  llmRecommended: boolean     // true if static adapter is missing or partial
}

// Single source of truth for framework → adapter mapping.
// Add a new entry whenever a new IAdapter is registered (Phase B/C/D).
const FRAMEWORK_PROFILES: Record<FrameworkKind, FrameworkProfile> = {
  'nextjs-app-router': { adapterId: 'nextjs-app-router', parsingLevel: 'L1', llmRecommended: false },
  'nextjs-pages':      { adapterId: 'nextjs-pages',      parsingLevel: 'L1', llmRecommended: false },
  'nuxt':              { adapterId: 'nuxt',              parsingLevel: 'L1', llmRecommended: false },
  'sveltekit':         { adapterId: 'sveltekit',         parsingLevel: 'L1', llmRecommended: false },
  'expo':              { adapterId: 'expo',              parsingLevel: 'L1', llmRecommended: true  },
  'vite-react':        { adapterId: 'vite-react',        parsingLevel: 'L2', llmRecommended: true  },
  'nestjs':            { adapterId: 'nestjs',            parsingLevel: 'L2', llmRecommended: false },
  'django':            { adapterId: 'django',            parsingLevel: 'L1', llmRecommended: false },
  'fastapi':           { adapterId: 'fastapi',           parsingLevel: 'L2', llmRecommended: false },
  'flask':             { adapterId: 'flask',             parsingLevel: 'L2', llmRecommended: false },
  'springboot':        { adapterId: 'springboot',        parsingLevel: 'L2', llmRecommended: false },
  'vue-spa':           { adapterId: 'vue-spa',           parsingLevel: 'L2', llmRecommended: false },
  'remix':             { adapterId: 'remix',             parsingLevel: 'L1', llmRecommended: false },
  'angular':           { adapterId: 'angular',           parsingLevel: 'L2', llmRecommended: false },
  'unknown':           {                                  parsingLevel: 'L3', llmRecommended: true  },
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
  } else if ('@nestjs/core' in deps || '@nestjs/common' in deps) {
    framework = 'nestjs'
  } else if ('@remix-run/react' in deps || ('react-router' in deps && !('next' in deps))) {
    framework = 'remix'
  } else if ('@angular/core' in deps) {
    framework = 'angular'
  } else if ('vue' in deps && !('nuxt' in deps)) {
    framework = 'vue-spa'
  } else {
    const reqContent = await fs.readFile(path.join(repoRoot, 'requirements.txt'), 'utf8').catch(() => '')
    const reqLower = reqContent.toLowerCase()
    if (reqLower.includes('fastapi')) {
      framework = 'fastapi'
    } else if (reqLower.includes('flask')) {
      framework = 'flask'
    } else if (reqLower.includes('django') || await hasPath(repoRoot, 'manage.py')) {
      framework = 'django'
    } else if (await hasPath(repoRoot, 'pom.xml') || await hasPath(repoRoot, 'build.gradle') || await hasPath(repoRoot, 'build.gradle.kts')) {
      framework = 'springboot'
    }
  }

  const appDirs = await detectMonorepoApps(repoRoot)
  const isMonorepo = appDirs.length > 1

  const profile = FRAMEWORK_PROFILES[framework]

  return {
    framework,
    hasSupabase: '@supabase/supabase-js' in deps || '@supabase/ssr' in deps,
    hasPrisma: '@prisma/client' in deps,
    hasDexie: 'dexie' in deps,
    isMonorepo,
    appDirs,
    ...(profile.adapterId !== undefined ? { adapterId: profile.adapterId } : {}),
    parsingLevel: profile.parsingLevel,
    llmRecommended: profile.llmRecommended,
  }
}
