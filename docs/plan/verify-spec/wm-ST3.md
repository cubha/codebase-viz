### VERIFY-SPEC — SubTask ST3 (Wave M)

- 기준선 요구사항: "사이드바 피드백 버튼 [⭐ Rate] / [🐛 Report Issue]."
- 변경 파일: `packages/extension/src/sidebarProvider.ts`(HTML·리스너), `packages/extension/src/i18n/dict.ts`
- 관찰 가능한 계약: 사이드바 최하단(언어 섹션 뒤 `<hr>` 다음)에 Feedback 라벨 + `button.secondary` 2개.
  클릭 시 `openFeedback` 메시지(`rate`/`issue`) 송신. i18n 키 3개(`sidebar.feedback`/`btnRate`/`btnReportIssue`)가
  4로케일 전부에 `sidebar.langAuto` 바로 뒤로 존재.
- 구현 결정:
  - 신규 CSS 0 — 기존 `button.secondary` 재사용. CSP 규약대로 addEventListener(inline 핸들러 없음).
  - 버튼 라벨에 "Open VSX"를 명시 — 어느 마켓으로 가는지 클릭 전에 알 수 있게.
  - 이모지(⭐🐛)는 로드맵 원문 표기를 따름. 기존 버튼도 ▶·⊞·🔑·✕ 아이콘 접두를 쓰므로 일관.
- 인접 경계: `refreshLocale()`이 HTML을 재생성하므로 언어 전환 시 버튼 라벨도 갱신된다.
- 미확인 사항: 실제 VS Code 호스트가 아닌, 생성 HTML에 VS Code 다크 테마 변수를 주입한 브라우저 렌더로만
  시각 확인(300px 폭, 레이아웃 정상). ja/zh 문구는 1차 번역.
