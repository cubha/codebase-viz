# PLAN — Wave M: 사이드바 피드백 버튼 (T10 + T13)

## 사용자 요구사항 원문

- "Wave M 진행 /sh-dev-loop --tdd --auto"
- Wave M 로드맵 원문(메모리 `project_v120_migration.md`):
  - **T10** 사이드바 피드백 버튼 — [⭐ Rate] → MS Marketplace / [🐛 Report Issue] → GitHub Issues.
    `vscode.env.openExternal`, 서버 불필요.
  - **T13** T10 ⭐ URL 결정 — 권장 MS Marketplace 단일(Open VSX는 리뷰 UX 미성숙). 구현 직전 confirm.
  - **T8** GIF 재촬영은 최후.
- T13 확인 결과(사용자): "open vsx 마켓은 별로야?" → 실측 제시(Open VSX 다운로드 15,431·리뷰 1건 /
  MS 1,215·install 89) → "단일이 좋을거같은데 Open VSX가 다운로드수가많아서 그러는거임"
- T8: "이번엔 제외"

## 확정 제약·결정

- **⭐ Rate 대상 = Open VSX 단일**: `https://open-vsx.org/extension/cubha/codebase-arch-viz/reviews`
  (T13 원안의 MS Marketplace 단일을 사용자 결정으로 대체. 호스트별 분기안은 기각 — 사용자가 단일 선호)
- **🐛 Report Issue** = `https://github.com/cubha/codebase-viz/issues/new`
- **T8 GIF 재촬영 제외**(이번 사이클 범위 밖)
- URL은 **확장 측 상수**로 둔다. webview는 종류(`'rate' | 'issue'`)만 보내고 확장이 URL을 결정 —
  webview가 목적지를 고를 수 없게 한다(기존 openNode의 "webview는 id만 보낸다" 규약과 동일).
- 서버·텔레메트리 없음.

## SubTask

| ID | 라우팅 | TDD | 내용 | 파일 |
|---|---|---|---|---|
| ST1 | [S] | [TDD] | `resolveFeedbackUrl(kind: unknown): string \| undefined` 순수 함수 + `openFeedback`을 허용 메시지 타입에 추가 | `packages/extension/src/message-guard.ts` (+test) |
| ST2 | [S] | [TDD] | `SidebarProvider`가 `openFeedback` 메시지를 받아 `resolveFeedbackUrl` 결과만 `vscode.env.openExternal`로 연다. 알 수 없는 kind는 no-op | `packages/extension/src/sidebarProvider.ts` (+test) |
| ST3 | [S] | — (UI) | 사이드바 하단 Feedback 섹션: [⭐ Rate on Open VSX] / [🐛 Report Issue] 버튼 2개, 기존 `button.secondary` 스타일 재사용, CSP 규약(addEventListener, inline 핸들러 금지) 준수. i18n 4로케일 키 추가 | `sidebarProvider.ts`, `i18n/dict.ts` |

라우팅: 전량 [S] (독립 [P] 후보 < 4).

## UI 설계 명세

- 위치: 언어 섹션 다음 `<hr>` 뒤 마지막 섹션(부가 기능이라 핵심 액션보다 아래).
- 구성: `.label`(Feedback) + `button.secondary` 2개 세로 배치 — 기존 버튼과 동일 폭/스타일, 신규 CSS 0.
- 디자인 토큰 Ground Truth(DESIGN-TOKENS.md) 없음 → VS Code 테마 변수(`--vscode-button-secondary*`) 재사용.
