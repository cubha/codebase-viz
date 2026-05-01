import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { IRNode } from '@codebase-viz/types'

export interface VerificationResult {
  verified: IRNode[]
  failed: Array<{ node: IRNode; reason: string }>
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

export async function verifyNodes(
  nodes: IRNode[],
  repoRoot: string,
): Promise<VerificationResult> {
  const verified: IRNode[] = []
  const failed: Array<{ node: IRNode; reason: string }> = []

  for (const node of nodes) {
    if (node.kind === 'route') {
      const filePath = path.join(repoRoot, node.filePath)
      const exists = await fileExists(filePath)
      if (exists) {
        verified.push(node)
      } else {
        failed.push({ node, reason: `File not found: ${node.filePath}` })
      }
    } else {
      // component and table nodes: pass through without file check
      // (component paths from LLM are inferred and may not exist on disk)
      verified.push(node)
    }
  }

  return { verified, failed }
}
