import type { IRGraphMetadata } from '@codebase-viz/types'

export interface InfraInfo {
  hasNextjs: boolean
  hasVite: boolean
  hasExpo: boolean
  hasReactRouter: boolean
  hasVueSpa: boolean
  hasAngular: boolean
  hasSupabase: boolean
  hasDexie: boolean
  hasPrisma: boolean
  hasFirebase: boolean
}

export function metadataToInfra(meta?: IRGraphMetadata): InfraInfo {
  if (meta === undefined) {
    return { hasNextjs: false, hasVite: false, hasExpo: false, hasReactRouter: false, hasVueSpa: false, hasAngular: false, hasSupabase: false, hasDexie: false, hasPrisma: false, hasFirebase: false }
  }
  const fw = meta.framework.toLowerCase()
  return {
    hasNextjs: fw === 'nextjs-app-router' || fw === 'nextjs-pages' || fw.startsWith('next'),
    hasVite: fw === 'vite-react',
    hasExpo: fw === 'expo',
    hasReactRouter: fw === 'react-router',
    hasVueSpa: fw === 'vue-spa',
    hasAngular: fw === 'angular',
    hasSupabase: meta.hasSupabase,
    hasDexie: meta.hasDexie,
    hasPrisma: meta.hasPrisma,
    hasFirebase: meta.hasFirebase,
  }
}

// file-based 라우팅 어댑터(파일 경로 = URL 또는 파일 위치에 URL 의미 인코딩)
// Tab2에 라우트 → 디렉터리·파일명 노드 패턴을 적용할 수 있는 어댑터 화이트리스트.
// config-based(react-router/vue-spa/angular)는 라우트=명시 매핑이지만
// v1.2.44에서 component 참조 추적으로 filePath를 컴포넌트 파일로 치환하여 동일 패턴 적용.
export function isFileTreeTab2Eligible(meta?: IRGraphMetadata): boolean {
  if (meta === undefined) return false
  const fw = meta.framework.toLowerCase()
  return fw === 'nextjs-app-router' || fw === 'nextjs-pages' || fw === 'nuxt' ||
    fw === 'sveltekit' || fw === 'remix' || fw === 'react-router' ||
    fw === 'vue-spa' || fw === 'angular'
}
