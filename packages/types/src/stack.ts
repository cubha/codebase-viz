export type ParsingLevel = 'L1' | 'L2' | 'L3'

export type FrameworkKind =
  | 'nextjs-app-router'
  | 'nextjs-pages'
  | 'vite-react'
  | 'nuxt'
  | 'sveltekit'
  | 'expo'
  | 'nestjs'
  | 'django'
  | 'fastapi'
  | 'flask'
  | 'springboot'
  | 'vue-spa'
  | 'remix'
  | 'angular'
  | 'unknown'

export interface StackInfo {
  framework: FrameworkKind
  hasSupabase: boolean
  hasPrisma: boolean
  hasDexie: boolean
  hasDrizzle: boolean
  hasTypeOrm: boolean
  hasSQLAlchemy: boolean
  hasDjangoORM: boolean
  hasSpringDataJpa: boolean
  isMonorepo: boolean
  appDirs: string[]
  adapterId?: string          // undefined → no static adapter; LLM-only
  parsingLevel: ParsingLevel
  llmRecommended: boolean
}
