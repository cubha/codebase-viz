export interface LLMRouteEntry {
  path: string
  file: string
  mode: string
  components: string[]
}

export interface LLMTableEntry {
  name: string
  usedBy: string[]
}

export interface LLMAnalysisResult {
  framework: string
  routes: LLMRouteEntry[]
  tables: LLMTableEntry[]
  inferenceNotes: string[]
}

export type FrameworkKind =
  | 'nextjs-app-router'
  | 'nextjs-pages'
  | 'vite-react'
  | 'nuxt'
  | 'sveltekit'
  | 'expo'
  | 'unknown'
