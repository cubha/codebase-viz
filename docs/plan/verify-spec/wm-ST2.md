### VERIFY-SPEC — SubTask ST2 (Wave M)

- 기준선 요구사항: "T10 `vscode.env.openExternal`, 서버 불필요."
- 변경 파일: `packages/extension/src/sidebarProvider.ts` (+`sidebarProvider.test.ts`)
- 관찰 가능한 계약: `{type:'openFeedback', value:'rate'|'issue'}` 수신 시 해당 상수 URL로 `openExternal` 1회.
  value가 URL 문자열·미지 kind·undefined면 호출 0회.
- 구현 결정: `resolveFeedbackUrl` 결과가 undefined면 조용한 no-op(기존 openNode 실패 규약과 동일).
- 인접 경계: 허용 타입 게이트(`isAllowedSidebarMessageType`)를 먼저 통과해야 switch에 도달 — ST1에서 추가.
- 미확인 사항: `vscode.Uri.parse`가 `#`·쿼리 없는 두 URL을 변형 없이 넘기는지는 mock에서만 확인(실 VS Code 미확인).
