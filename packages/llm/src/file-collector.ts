import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { FrameworkKind } from './schema.js'
import type { StackInfo } from './stack-detector.js'

const MAX_CHARS = 200_000
const MAX_CHARS_PER_FILE = 5000
const PER_APP_BUDGET = 40_000  // monorepo: max chars per app

interface CollectStrategy {
  entryGlobs: string[]
  routerConfigs: string[]
  sourceRoots: string[]
  maxFilesPerDir: number
}

function getStrategy(framework: FrameworkKind): CollectStrategy {
  switch (framework) {
    case 'nextjs-app-router':
      return {
        entryGlobs: ['app/**/page.tsx', 'src/app/**/page.tsx'],
        routerConfigs: ['next.config.ts', 'next.config.js', 'next.config.mjs'],
        sourceRoots: ['app', 'src/app', 'components', 'src/components', 'lib', 'src/lib'],
        maxFilesPerDir: 10,
      }
    case 'nextjs-pages':
      return {
        entryGlobs: ['pages/**/*.tsx', 'src/pages/**/*.tsx'],
        routerConfigs: ['next.config.ts', 'next.config.js'],
        sourceRoots: ['pages', 'src/pages', 'components', 'lib'],
        maxFilesPerDir: 10,
      }
    case 'vite-react':
      return {
        entryGlobs: ['src/App.tsx', 'src/main.tsx', 'src/routes/**/*.tsx', 'src/pages/**/*.tsx'],
        routerConfigs: ['vite.config.ts', 'vite.config.js'],
        sourceRoots: ['src'],
        maxFilesPerDir: 15,
      }
    case 'nuxt':
      return {
        entryGlobs: ['pages/**/*.vue', 'components/**/*.vue'],
        routerConfigs: ['nuxt.config.ts', 'nuxt.config.js'],
        sourceRoots: ['pages', 'layouts', 'components', 'composables'],
        maxFilesPerDir: 10,
      }
    case 'expo':
      return {
        entryGlobs: ['app/**/*.tsx', 'app/(tabs)/**/*.tsx'],
        routerConfigs: ['app.json', 'expo.json', 'app.config.ts'],
        sourceRoots: ['app', 'src/app', 'src/screens'],
        maxFilesPerDir: 10,
      }
    case 'nestjs':
      return {
        entryGlobs: ['src/app.module.ts', 'src/modules/**/*.controller.ts', 'src/modules/**/*.entity.ts'],
        routerConfigs: ['src/app.module.ts', 'src/main.ts'],
        sourceRoots: ['src/modules', 'src/shared'],
        maxFilesPerDir: 8,
      }
    default:
      return {
        entryGlobs: ['src/**/*.tsx', 'src/**/*.ts'],
        routerConfigs: [],
        sourceRoots: ['src'],
        maxFilesPerDir: 20,
      }
  }
}

async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, 'utf8')
  } catch {
    return null
  }
}

const SKIP_DIRS = new Set(['node_modules', '.next', 'dist', 'build', '.git', '.turbo', 'out'])

async function walkDir(dir: string, extensions: string[], maxFiles: number): Promise<string[]> {
  const result: string[] = []
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (result.length >= maxFiles) break
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        const nested = await walkDir(path.join(dir, entry.name), extensions, maxFiles - result.length)
        result.push(...nested)
      } else if (extensions.some(ext => entry.name.endsWith(ext))) {
        result.push(path.join(dir, entry.name))
      }
    }
  } catch { /* directory doesn't exist */ }
  return result
}

async function walkDirForEntries(dir: string, fileNames: string[], maxFiles: number): Promise<string[]> {
  const result: string[] = []
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (result.length >= maxFiles) break
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue
        const nested = await walkDirForEntries(path.join(dir, entry.name), fileNames, maxFiles - result.length)
        result.push(...nested)
      } else if (fileNames.includes(entry.name)) {
        result.push(path.join(dir, entry.name))
      }
    }
  } catch { /* directory doesn't exist */ }
  return result
}

async function detectAppFramework(appDir: string): Promise<FrameworkKind> {
  try {
    const raw = await fs.readFile(path.join(appDir, 'package.json'), 'utf8')
    const pkg = JSON.parse(raw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    const deps = { ...pkg.dependencies, ...pkg.devDependencies }
    if ('next' in deps) {
      const hasSrcApp = await fs.access(path.join(appDir, 'src', 'app')).then(() => true).catch(() => false)
      const hasApp = await fs.access(path.join(appDir, 'app')).then(() => true).catch(() => false)
      return (hasSrcApp || hasApp) ? 'nextjs-app-router' : 'nextjs-pages'
    }
    if ('expo' in deps || 'expo-router' in deps) return 'expo'
    if ('vite' in deps && 'react' in deps) return 'vite-react'
    if ('@nestjs/core' in deps || '@nestjs/common' in deps) return 'nestjs'
    if ('nuxt' in deps) return 'nuxt'
    if ('@sveltejs/kit' in deps) return 'sveltekit'
  } catch { /* ignore */ }
  return 'unknown'
}

async function collectFromApp(
  appDir: string,
  repoRoot: string,
  framework: FrameworkKind,
  budgetChars: number,
  collected: Record<string, string>,
  label: string,
): Promise<number> {
  const strategy = getStrategy(framework)
  let usedChars = 0

  const addFile = async (filePath: string): Promise<void> => {
    if (usedChars >= budgetChars) return
    const repoRelPath = path.relative(repoRoot, filePath)
    if (repoRelPath in collected) return
    const content = await readFileSafe(filePath)
    if (content === null) return
    const truncated = content.slice(0, MAX_CHARS_PER_FILE)
    // Prefix with app label so LLM understands which app this file belongs to
    collected[`[${label}] ${repoRelPath}`] = truncated
    usedChars += truncated.length
  }

  // package.json + router configs
  await addFile(path.join(appDir, 'package.json'))
  for (const config of strategy.routerConfigs) {
    await addFile(path.join(appDir, config))
  }

  if (framework === 'nestjs') {
    // NestJS: prioritize app.module.ts + controller files + key entity files
    // NestJS: app.module.ts first, then controllers + entities
    const nestPriority = await walkDirForEntries(path.join(appDir, 'src'), ['app.module.ts', 'main.ts'], 3)
    for (const f of nestPriority) {
      if (usedChars >= budgetChars) break
      await addFile(f)
    }
    const nestAllTs = await walkDir(path.join(appDir, 'src'), ['.ts'], strategy.maxFilesPerDir * 3)
    // Prioritize: controllers > modules > entities > others
    const nestSorted = nestAllTs.sort((a, b) => {
      const priority = (f: string) => f.endsWith('.controller.ts') ? 0 : f.endsWith('.module.ts') ? 1 : f.endsWith('.entity.ts') ? 2 : 3
      return priority(a) - priority(b)
    })
    for (const f of nestSorted) {
      if (usedChars >= budgetChars) break
      await addFile(f)
    }
  } else {
    // Frontend apps: page files first, then components
    const entryFileNames = ['page.tsx', 'page.ts', 'layout.tsx', 'App.tsx', 'app.tsx', 'index.tsx', '_layout.tsx']
    for (const srcRoot of strategy.sourceRoots.slice(0, 2)) {
      if (usedChars >= budgetChars) break
      const entryFiles = await walkDirForEntries(path.join(appDir, srcRoot), entryFileNames, 30)
      for (const f of entryFiles) {
        if (usedChars >= budgetChars) break
        await addFile(f)
      }
    }
    for (const srcRoot of strategy.sourceRoots) {
      if (usedChars >= budgetChars) break
      const files = await walkDir(path.join(appDir, srcRoot), ['.tsx', '.ts', '.vue', '.svelte'], strategy.maxFilesPerDir)
      for (const f of files) {
        if (usedChars >= budgetChars) break
        await addFile(f)
      }
    }
  }

  return usedChars
}

export async function collectFiles(
  repoRoot: string,
  stackOrFramework: StackInfo | FrameworkKind,
): Promise<Record<string, string>> {
  const stack: StackInfo = typeof stackOrFramework === 'string'
    ? {
        framework: stackOrFramework,
        hasSupabase: false,
        hasPrisma: false,
        hasDexie: false,
        hasDrizzle: false,
        hasTypeOrm: false,
        hasSQLAlchemy: false,
        hasDjangoORM: false,
        hasSpringDataJpa: false,
        isMonorepo: false,
        appDirs: [],
        parsingLevel: 'L3',
        llmRecommended: true,
      }
    : stackOrFramework

  const collected: Record<string, string> = {}
  let totalChars = 0

  if (stack.isMonorepo && stack.appDirs.length > 0) {
    // Monorepo: collect from each app with per-app budget
    for (const appDir of stack.appDirs) {
      if (totalChars >= MAX_CHARS) break
      const appName = path.basename(appDir)
      const appFramework = await detectAppFramework(appDir)
      const remainingBudget = Math.min(PER_APP_BUDGET, MAX_CHARS - totalChars)
      const used = await collectFromApp(appDir, repoRoot, appFramework, remainingBudget, collected, appName)
      totalChars += used
    }
    // Also add root package.json and pnpm-workspace.yaml for monorepo context
    const addRoot = async (file: string) => {
      const content = await readFileSafe(path.join(repoRoot, file))
      if (content && !(`[root] ${file}` in collected)) {
        collected[`[root] ${file}`] = content.slice(0, MAX_CHARS_PER_FILE)
        totalChars += collected[`[root] ${file}`]!.length
      }
    }
    await addRoot('package.json')
    await addRoot('pnpm-workspace.yaml')
    await addRoot('turbo.json')
  } else {
    // Single app: existing strategy
    const strategy = getStrategy(stack.framework)

    const addFile = async (filePath: string): Promise<void> => {
      if (totalChars >= MAX_CHARS) return
      const repoRelPath = path.relative(repoRoot, filePath)
      if (repoRelPath in collected) return
      const content = await readFileSafe(filePath)
      if (content === null) return
      const truncated = content.slice(0, MAX_CHARS_PER_FILE)
      collected[repoRelPath] = truncated
      totalChars += truncated.length
    }

    for (const config of strategy.routerConfigs) await addFile(path.join(repoRoot, config))
    await addFile(path.join(repoRoot, 'package.json'))

    const entryFileNames = ['page.tsx', 'page.ts', 'layout.tsx', 'App.tsx', 'app.tsx', 'index.tsx']
    for (const srcRoot of strategy.sourceRoots.slice(0, 2)) {
      if (totalChars >= MAX_CHARS) break
      const entryFiles = await walkDirForEntries(path.join(repoRoot, srcRoot), entryFileNames, 30)
      for (const f of entryFiles) {
        if (totalChars >= MAX_CHARS) break
        await addFile(f)
      }
    }

    for (const srcRoot of strategy.sourceRoots) {
      if (totalChars >= MAX_CHARS) break
      const files = await walkDir(path.join(repoRoot, srcRoot), ['.tsx', '.ts', '.vue', '.svelte'], strategy.maxFilesPerDir)
      for (const f of files) {
        if (totalChars >= MAX_CHARS) break
        await addFile(f)
      }
    }
  }

  return collected
}
