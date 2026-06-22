import type { IRBackendService } from '@codebase-viz/types'

// LLM이 산출한 backendServices는 100% 추론 결과다. 상세 백엔드 블록(framework·modules·dbType)을
// 렌더하려면 수집된 fileContents에 실제 서버 코드 증거가 있어야 한다 (Evidence-First, 절대원칙 2).
// collectFiles는 .java/.py를 수집하지 않으므로 Spring/Django 환각은 증거 불가 → 자동 드롭.
// FE-only 레포의 api-call edge는 "백엔드 존재"만 증명하지 "framework=express+모듈"을 증명하지 못하므로
// 게이트 신호가 아니다 — 그 경우는 renderer가 별도 External REST API gateway 분기로 처리한다.
//
// tight 마커 (false-positive 회피 — false positive는 환각 유지이므로 noise=worse):
//   1) 수집된 package.json에 서버 프레임워크 deps
//   2) NestJS 서버 소스 파일 키 (.controller.ts) — Angular(.component.ts)/React와 비충돌
//   * app.module.ts/.service.ts는 Angular FE와 충돌하므로 신호에서 제외.
const SERVER_DEP_RE =
  /"(?:@nestjs\/(?:core|common)|express|fastify|@fastify\/[\w-]+|koa|@hapi\/hapi|@adonisjs\/core|@feathersjs\/feathers)"\s*:/

function hasServerEvidence(fileContents: Record<string, string>): boolean {
  for (const [key, content] of Object.entries(fileContents)) {
    if (key.endsWith('.controller.ts')) return true
    if (key.endsWith('package.json') && SERVER_DEP_RE.test(content)) return true
  }
  return false
}

export function corroborateBackends(
  backends: IRBackendService[],
  fileContents: Record<string, string>,
): IRBackendService[] {
  if (backends.length === 0) return []
  return hasServerEvidence(fileContents) ? backends : []
}
