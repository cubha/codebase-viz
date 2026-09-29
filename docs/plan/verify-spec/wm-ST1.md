### VERIFY-SPEC — SubTask ST1 (Wave M)

- 기준선 요구사항: "T10 [⭐ Rate]·[🐛 Report Issue] 외부 링크. T13 ⭐ 대상 = Open VSX 단일(사용자 확정)."
- 변경 파일: `packages/extension/src/message-guard.ts` (+`message-guard.test.ts`)
- 관찰 가능한 계약: `resolveFeedbackUrl('rate')` = Open VSX 리뷰 URL, `('issue')` = GitHub issues/new,
  그 외(프로토타입 키·비문자열 포함) = `undefined`. `isAllowedSidebarMessageType('openFeedback')` = true.
- 구현 결정:
  - URL을 확장 측 상수표로 닫았다 — 웹뷰는 kind만 보낸다. 기존 `openExternal`(웹뷰가 임의 https URL 지정)
    경로를 재사용하지 않은 이유: 목적지가 고정인 기능에 개방형 경로를 넓힐 이유가 없음.
  - own-property 검사로 `__proto__`/`constructor`/`toString` 조회를 차단(resolveOpenNodeTarget과 동일 규약).
  - URL 하드코딩: publisher/extension id(`cubha.codebase-arch-viz`)·repo(`cubha/codebase-viz`)가
    package.json과 중복된다. package.json을 런타임에 읽지 않는 기존 구조라 상수로 둠(rename 시 동시 수정 필요).
- 인접 경계: 기존 `openExternal` 경로는 변경 없음(API 키 가이드가 계속 사용).
- 미확인 사항: (해소) `/extension/<ns>/<name>/reviews`는 SPA라 HTTP 200만으론 불충분 — Playwright 접근성
  트리로 `tab "Ratings & Reviews" [selected]` 상태로 열림을 실측 확인(2026-09-29).
