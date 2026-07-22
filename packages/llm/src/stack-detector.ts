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
const FRAMEWORK_PROFILES: Record<FrameworkKind, FrameworkProfile> = {
  // L3: routes + components + DB (all 3 tabs)
  'nextjs-app-router': { adapterId: 'nextjs-app-router', parsingLevel: 'L3', llmRecommended: false },
  // L2: routes + components or routes + DB
  'nuxt':              { adapterId: 'nuxt',              parsingLevel: 'L2', llmRecommended: false },
  'sveltekit':         { adapterId: 'sveltekit',         parsingLevel: 'L2', llmRecommended: false },
  'nestjs':            { adapterId: 'nestjs',            parsingLevel: 'L2', llmRecommended: false },
  'django':            { adapterId: 'django',            parsingLevel: 'L2', llmRecommended: false },
  'fastapi':           { adapterId: 'fastapi',           parsingLevel: 'L2', llmRecommended: false },
  'springboot':        { adapterId: 'springboot',        parsingLevel: 'L2', llmRecommended: false },
  'nextjs-pages':      { adapterId: 'nextjs-pages',      parsingLevel: 'L2', llmRecommended: false },
  'flask':             { adapterId: 'flask',             parsingLevel: 'L2', llmRecommended: false },
  'vue-spa':           { adapterId: 'vue-spa',           parsingLevel: 'L2', llmRecommended: false },
  'react-router':      { adapterId: 'react-router',      parsingLevel: 'L2', llmRecommended: false },
  'remix':             { adapterId: 'remix',             parsingLevel: 'L2', llmRecommended: false },
  'angular':           { adapterId: 'angular',           parsingLevel: 'L2', llmRecommended: false },
  // LLM-only (no static adapter — adapterId undefined)
  // expo·vite-react는 화면 프레임워크가 아닌 플랫폼/빌드 도구 — 실제 화면은 RN/React/Vue 등. 정적 어댑터 신설 부적합
  'expo':              {                                  parsingLevel: 'L1', llmRecommended: true  },
  'vite-react':        {                                  parsingLevel: 'L3', llmRecommended: true  },
  'flutter':           {                                  parsingLevel: 'L1', llmRecommended: true  },
  'unknown':           {                                  parsingLevel: 'L3', llmRecommended: true  },
}

// Higher score = preferred primary framework in a monorepo
function frameworkScore(fw: FrameworkKind): number {
  if (fw === 'unknown') return 0
  const profile = FRAMEWORK_PROFILES[fw]
  const levelScore = { L3: 300, L2: 200, L1: 100 }[profile.parsingLevel] ?? 0
  const adapterBonus = profile.adapterId !== undefined ? 10 : 0
  return levelScore + adapterBonus
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
    ...(pkg['dependencies'] as Record<string, string> | undefined),
    ...(pkg['devDependencies'] as Record<string, string> | undefined),
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

async function frameworkFromDeps(deps: Record<string, string>, dirPath: string): Promise<FrameworkKind> {
  if ('next' in deps) {
    const appDir = await hasPath(dirPath, 'app')
    const srcAppDir = await hasPath(dirPath, 'src', 'app')
    return (appDir || srcAppDir) ? 'nextjs-app-router' : 'nextjs-pages'
  }
  if ('nuxt' in deps) return 'nuxt'
  if ('expo' in deps || '@expo/cli' in deps || 'expo-router' in deps) return 'expo'
  if ('@sveltejs/kit' in deps) return 'sveltekit'
  if ('@nestjs/core' in deps || '@nestjs/common' in deps) return 'nestjs'
  if ('@remix-run/react' in deps) return 'remix'
  if ('react-router-dom' in deps) return 'react-router'
  if ('vite' in deps && ('react' in deps || '@types/react' in deps)) return 'vite-react'
  if ('@angular/core' in deps) return 'angular'
  if ('vue' in deps && !('nuxt' in deps)) return 'vue-spa'
  return 'unknown'
}

// Detects framework from a single directory (JS/Python/Java/Flutter).
async function frameworkFromDir(dirPath: string): Promise<FrameworkKind> {
  const pkg = await readJson(path.join(dirPath, 'package.json'))
  if (pkg !== null) {
    const fw = await frameworkFromDeps(getDeps(pkg), dirPath)
    if (fw !== 'unknown') return fw
  }

  const reqContent = await fs.readFile(path.join(dirPath, 'requirements.txt'), 'utf8').catch(() => '')
  if (reqContent) {
    const reqLower = reqContent.toLowerCase()
    if (reqLower.includes('fastapi')) return 'fastapi'
    if (reqLower.includes('flask')) return 'flask'
    if (reqLower.includes('django')) return 'django'
  }

  if (
    await hasPath(dirPath, 'pom.xml') ||
    await hasPath(dirPath, 'build.gradle') ||
    await hasPath(dirPath, 'build.gradle.kts')
  ) return 'springboot'

  const pubspec = await fs.readFile(path.join(dirPath, 'pubspec.yaml'), 'utf8').catch(() => '')
  if (pubspec.includes('sdk: flutter')) return 'flutter'

  return 'unknown'
}

// Returns the best (highest-score) framework found across a list of dirs.
async function bestFrameworkFromDirs(dirs: string[]): Promise<FrameworkKind> {
  let best: FrameworkKind = 'unknown'
  let bestScore = 0
  for (const dir of dirs) {
    const fw = await frameworkFromDir(dir)
    const score = frameworkScore(fw)
    if (score > bestScore) { best = fw; bestScore = score }
  }
  return best
}

async function detectMonorepoApps(repoRoot: string): Promise<string[]> {
  const dirs = new Set<string>()

  // Pattern 1: turborepo / lerna / nx style — look inside apps/, packages/, services/
  for (const candidate of ['apps', 'packages', 'services']) {
    const candidatePath = path.join(repoRoot, candidate)
    try {
      const entries = await fs.readdir(candidatePath, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const appPkg = await readJson(path.join(candidatePath, entry.name, 'package.json'))
        if (appPkg !== null) dirs.add(path.join(candidatePath, entry.name))
      }
    } catch {
      // directory doesn't exist
    }
  }

  // Pattern 2: multi-service repos — direct top-level service dirs with their own package.json.
  // Only applied when Pattern 1 found nothing, to avoid double-counting standard monorepos.
  if (dirs.size === 0) {
    for (const candidate of ['frontend', 'client', 'web', 'backend', 'server', 'api', 'mobile', 'app']) {
      const candidatePath = path.join(repoRoot, candidate)
      if (await readJson(path.join(candidatePath, 'package.json')) !== null) {
        dirs.add(candidatePath)
      }
    }
  }

  return [...dirs]
}

// Last-resort: scan every top-level directory for a recognizable framework.
async function detectFrameworkFromSubdirs(repoRoot: string): Promise<FrameworkKind> {
  try {
    const entries = await fs.readdir(repoRoot, { withFileTypes: true })
    const subdirs = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map(e => path.join(repoRoot, e.name))
    return bestFrameworkFromDirs(subdirs)
  } catch {
    return 'unknown'
  }
}

export async function detectStack(repoRoot: string): Promise<StackInfo> {
  const pkg = await readJson(path.join(repoRoot, 'package.json'))
  const deps = pkg !== null ? getDeps(pkg) : {}

  // Step 1: root package.json → JS/TS framework
  let framework: FrameworkKind = await frameworkFromDeps(deps, repoRoot)

  // Step 2: root non-JS files → Python / Java / Flutter framework
  if (framework === 'unknown') {
    const reqContent = await fs.readFile(path.join(repoRoot, 'requirements.txt'), 'utf8').catch(() => '')
    const pyprojectContent = await fs.readFile(path.join(repoRoot, 'pyproject.toml'), 'utf8').catch(() => '')
    const combined = (reqContent + pyprojectContent).toLowerCase()
    if (combined.includes('fastapi')) framework = 'fastapi'
    else if (combined.includes('flask')) framework = 'flask'
    else if (combined.includes('django') || await hasPath(repoRoot, 'manage.py')) framework = 'django'
    else if (
      await hasPath(repoRoot, 'pom.xml') ||
      await hasPath(repoRoot, 'build.gradle') ||
      await hasPath(repoRoot, 'build.gradle.kts')
    ) framework = 'springboot'
    else {
      const pubspec = await fs.readFile(path.join(repoRoot, 'pubspec.yaml'), 'utf8').catch(() => '')
      if (pubspec.includes('sdk: flutter')) framework = 'flutter'
    }
  }

  // Step 3: detect monorepo sub-apps (needed for both isMonorepo flag and fallback detection)
  const appDirs = await detectMonorepoApps(repoRoot)

  // Step 4: monorepo fallback — pick best framework across known sub-apps
  if (framework === 'unknown' && appDirs.length > 0) {
    framework = await bestFrameworkFromDirs(appDirs)
  }

  // Step 5: last resort — scan all top-level dirs
  if (framework === 'unknown') {
    framework = await detectFrameworkFromSubdirs(repoRoot)
  }

  const isMonorepo = appDirs.length > 1
  const profile = FRAMEWORK_PROFILES[framework]

  // ORM detection — Python
  const reqContentForOrm = await fs.readFile(path.join(repoRoot, 'requirements.txt'), 'utf8').catch(() => '')
  const pyprojectContent = await fs.readFile(path.join(repoRoot, 'pyproject.toml'), 'utf8').catch(() => '')
  const hasSQLAlchemy = reqContentForOrm.toLowerCase().includes('sqlalchemy') || pyprojectContent.toLowerCase().includes('sqlalchemy')

  // ORM detection — Spring
  const buildGradleContent = await fs.readFile(path.join(repoRoot, 'build.gradle'), 'utf8').catch(() => '')
  const buildGradleKtsContent = await fs.readFile(path.join(repoRoot, 'build.gradle.kts'), 'utf8').catch(() => '')
  const pomContent = await fs.readFile(path.join(repoRoot, 'pom.xml'), 'utf8').catch(() => '')
  const hasSpringDataJpa = [buildGradleContent, buildGradleKtsContent, pomContent].some(c =>
    c.includes('spring-data-jpa') || c.includes('spring-boot-starter-data-jpa')
  )

  return {
    framework,
    hasSupabase: '@supabase/supabase-js' in deps || '@supabase/ssr' in deps,
    hasPrisma: '@prisma/client' in deps,
    hasDexie: 'dexie' in deps,
    hasDrizzle: 'drizzle-orm' in deps,
    hasTypeOrm: 'typeorm' in deps || '@typeorm/core' in deps,
    hasSQLAlchemy,
    hasDjangoORM: framework === 'django',
    hasSpringDataJpa,
    isMonorepo,
    appDirs,
    ...(profile.adapterId !== undefined ? { adapterId: profile.adapterId } : {}),
    parsingLevel: profile.parsingLevel,
    llmRecommended: profile.llmRecommended,
  }
}
