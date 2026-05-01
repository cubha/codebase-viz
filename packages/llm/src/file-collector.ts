import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { FrameworkKind } from './schema.js'

const MAX_CHARS = 200_000 // ~60K tokens at ~3 chars/token

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
        entryGlobs: ['app/**/page.tsx', 'app/**/layout.tsx', 'src/app/**/page.tsx', 'src/app/**/layout.tsx'],
        routerConfigs: ['next.config.ts', 'next.config.js', 'next.config.mjs'],
        sourceRoots: ['app', 'src/app', 'components', 'src/components', 'lib', 'src/lib'],
        maxFilesPerDir: 10,
      }
    case 'nextjs-pages':
      return {
        entryGlobs: ['pages/**/*.tsx', 'pages/**/*.ts', 'src/pages/**/*.tsx'],
        routerConfigs: ['next.config.ts', 'next.config.js'],
        sourceRoots: ['pages', 'src/pages', 'components', 'lib'],
        maxFilesPerDir: 10,
      }
    case 'vite-react':
      return {
        entryGlobs: ['src/App.tsx', 'src/main.tsx', 'src/routes/**/*.tsx', 'src/pages/**/*.tsx'],
        routerConfigs: ['vite.config.ts', 'vite.config.js', 'src/router.tsx', 'src/routes.tsx'],
        sourceRoots: ['src'],
        maxFilesPerDir: 15,
      }
    case 'nuxt':
      return {
        entryGlobs: ['pages/**/*.vue', 'layouts/**/*.vue', 'components/**/*.vue'],
        routerConfigs: ['nuxt.config.ts', 'nuxt.config.js'],
        sourceRoots: ['pages', 'layouts', 'components', 'composables'],
        maxFilesPerDir: 10,
      }
    case 'expo':
      return {
        entryGlobs: ['app/**/*.tsx', 'app/(tabs)/**/*.tsx', 'src/app/**/*.tsx'],
        routerConfigs: ['app.json', 'expo.json', 'app.config.ts'],
        sourceRoots: ['app', 'src/app', 'src/screens', 'src/navigation'],
        maxFilesPerDir: 10,
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
    const content = await fs.readFile(filePath, 'utf8')
    return content
  } catch {
    return null
  }
}

async function walkDir(
  dir: string,
  extensions: string[],
  maxFiles: number,
): Promise<string[]> {
  const result: string[] = []
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (result.length >= maxFiles) break
      if (entry.isDirectory()) {
        if (['node_modules', '.next', 'dist', 'build', '.git'].includes(entry.name)) continue
        const nested = await walkDir(path.join(dir, entry.name), extensions, maxFiles - result.length)
        result.push(...nested)
      } else if (extensions.some(ext => entry.name.endsWith(ext))) {
        result.push(path.join(dir, entry.name))
      }
    }
  } catch {
    // directory doesn't exist
  }
  return result
}

export async function collectFiles(
  repoRoot: string,
  framework: FrameworkKind,
): Promise<Record<string, string>> {
  const strategy = getStrategy(framework)
  const collected: Record<string, string> = {}
  let totalChars = 0

  const addFile = async (filePath: string): Promise<void> => {
    if (totalChars >= MAX_CHARS) return
    const repoRelPath = path.relative(repoRoot, filePath)
    if (repoRelPath in collected) return
    const content = await readFileSafe(filePath)
    if (content === null) return
    const truncated = content.slice(0, 8000) // max 8K chars per file
    collected[repoRelPath] = truncated
    totalChars += truncated.length
  }

  // Router configs first
  for (const config of strategy.routerConfigs) {
    await addFile(path.join(repoRoot, config))
  }

  // package.json always
  await addFile(path.join(repoRoot, 'package.json'))

  // Source roots
  for (const srcRoot of strategy.sourceRoots) {
    if (totalChars >= MAX_CHARS) break
    const files = await walkDir(
      path.join(repoRoot, srcRoot),
      ['.tsx', '.ts', '.vue', '.svelte'],
      strategy.maxFilesPerDir,
    )
    for (const f of files) {
      if (totalChars >= MAX_CHARS) break
      await addFile(f)
    }
  }

  return collected
}
