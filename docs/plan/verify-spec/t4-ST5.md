### VERIFY-SPEC — SubTask ST5

- 기준선 요구사항: "i18n dict.ts에 tab.sequence 키 4로케일(ko/en/ja/zh-cn) 추가."
- 변경 파일: `packages/extension/src/i18n/dict.ts` (수정 — 4개 블록에 각 1줄 추가)
- 관찰 가능한 계약: `dictForLocale('ko'|'en'|'ja'|'zh-cn')['tab.sequence']`가 4개 로케일 모두
  비어있지 않은 문자열을 반환한다(ko:'시퀀스', en:'Sequence', ja:'シーケンス', zh-cn:'时序图').
- 구현 결정: 파일 상단 주석("추가 키는 알파벳 순으로 정렬해 유지")과 달리 `tab.*` 그룹은 실제로는
  viewer.html 탭 표시 순서(r→s→d)를 따르고 있어(dbScreen이 alphabetical상 rendering보다 앞이어야
  하지만 실제로는 뒤) 알파벳 순 대신 **기존 그룹의 실제 관례(탭 순서)를 따라** `tab.dbScreen` 바로
  다음에 `tab.sequence`를 추가했다 — 새 컨벤션을 만들지 않고 기존 파일이 실제로 하고 있는 방식을
  그대로 이었다.
- 인접 경계: `viewer.html`의 `data-i18n="tab.sequence"` (ST4에서 이미 추가) — 키 이름이 정확히
  일치해야 하며, 4개 로케일 중 하나라도 누락되면 `tr()`이 키 문자열 그대로("tab.sequence")를
  표시(fallback 자체는 죽지 않지만 미번역 노출).
- 미확인 사항: ja/zh-cn 번역("シーケンス"/"时序图")은 기존 파일 주석의 "1차 번역"(정확한 전문
  번역이 아닐 수 있음) 수준으로 처리했다 — 원어민 검수는 안 거쳤다(기존 다른 tab.* 키들과 동일한
  신뢰 수준).
