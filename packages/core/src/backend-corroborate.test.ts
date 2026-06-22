import { describe, it, expect } from 'vitest'
import type { IRBackendService } from '@codebase-viz/types'
import { corroborateBackends } from './backend-corroborate.js'

const SVC: IRBackendService = {
  name: 'Partner API',
  framework: 'express',
  modules: ['UserModule', 'OrderModule'],
  dbType: 'postgresql',
}

// react-router FE-only 레포 수집물: FE 소스 + react/axios package.json. 서버 소스 0.
const FE_ONLY: Record<string, string> = {
  'package.json': JSON.stringify({
    dependencies: { react: '^18.2.0', 'react-router-dom': '^6.22.0', axios: '^1.7.0' },
  }),
  'src/router.tsx': 'export const router = createBrowserRouter([])',
  'src/pages/Home.tsx': 'export default function Home() { return null }',
}

describe('corroborateBackends (v1.2.54 Fix2 — Design B: BE-files-only 게이트)', () => {
  it('backends가 비어있으면 빈 배열', () => {
    expect(corroborateBackends([], FE_ONLY)).toEqual([])
  })

  it('FE-only 레포(서버 증거 0)에서 LLM backendServices는 드롭한다 (환각 차단)', () => {
    // WINA / partner-mock 케이스: axios api-call은 있어도 백엔드 소스가 수집물에 없음.
    // api-call edge는 게이트 대상 아님 → renderer가 별도 generic gateway로 처리.
    expect(corroborateBackends([SVC], FE_ONLY)).toEqual([])
  })

  it('수집된 package.json에 @nestjs/core deps가 있으면 유지', () => {
    const fc: Record<string, string> = {
      '[root] package.json': JSON.stringify({ dependencies: { '@nestjs/core': '^10.0.0' } }),
      '[api] src/main.ts': 'bootstrap()',
    }
    expect(corroborateBackends([SVC], fc)).toEqual([SVC])
  })

  it('수집된 package.json에 express deps가 있으면 유지 (monorepo BE 보존)', () => {
    const fc: Record<string, string> = {
      '[root] package.json': JSON.stringify({ dependencies: { express: '^4.19.0' } }),
    }
    expect(corroborateBackends([SVC], fc)).toEqual([SVC])
  })

  it('NestJS 서버 소스 파일(.controller.ts) 키가 있으면 유지', () => {
    const fc: Record<string, string> = {
      '[api] src/modules/user/user.controller.ts': '@Controller()',
    }
    expect(corroborateBackends([SVC], fc)).toEqual([SVC])
  })

  it('Angular FE(app.module.ts·.component.ts, 서버 dep 없음)는 false-positive 없이 드롭', () => {
    // tight 마커: app.module.ts/.service.ts는 Angular FE와 충돌하므로 게이트 신호에서 제외.
    const fc: Record<string, string> = {
      'package.json': JSON.stringify({ dependencies: { '@angular/core': '^18.0.0' } }),
      'src/app/app.module.ts': '@NgModule({})',
      'src/app/home/home.component.ts': '@Component({})',
    }
    expect(corroborateBackends([SVC], fc)).toEqual([])
  })
})
