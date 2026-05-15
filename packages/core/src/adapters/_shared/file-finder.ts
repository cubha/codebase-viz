import * as fs from 'node:fs/promises'
import * as path from 'node:path'

export const PY_EXCLUDE_DIRS = new Set(['__pycache__', '.git', 'node_modules', 'venv', '.venv', 'env'])
export const JAVA_EXCLUDE_DIRS = new Set(['.git', 'node_modules', 'target', 'build', '.gradle', 'test'])

export async function findFiles(
  dir: string,
  extension: string,
  excludeDirs: Set<string>,
): Promise<string[]> {
  const results: string[] = []
  async function recurse(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => null)
    if (entries === null) return
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) {
        if (!excludeDirs.has(entry.name)) await recurse(fullPath)
      } else if (entry.isFile() && entry.name.endsWith(extension)) {
        results.push(fullPath)
      }
    }
  }
  await recurse(dir)
  return results
}

export async function findPyFiles(repoRoot: string): Promise<string[]> {
  return findFiles(repoRoot, '.py', PY_EXCLUDE_DIRS)
}

export async function findJavaFiles(repoRoot: string): Promise<string[]> {
  return findFiles(repoRoot, '.java', JAVA_EXCLUDE_DIRS)
}
