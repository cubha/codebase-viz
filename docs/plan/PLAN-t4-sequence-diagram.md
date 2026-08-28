# PLAN — Wave B T4: 시퀀스 다이어그램 (재개)

## 요구사항 원문 (사용자 발화 그대로)

> Wave B, T4재개 작업 진행할게.
> /sh-dev-loop --tdd --auto 진행해

선행 세션(2026-08-18)에서 확정된 계획을 그대로 재개한다는 의미 — 아래 SubTask 명세는
`memory/project_wave_b_t4_plan.md` + `.gbc/spec.md`에 등록된 원안을 승계한다(코드 변경 0 상태에서
중단). T5(classDiagram)는 이번 범위에 **포함하지 않는다** — 데이터 증분 0(Less is More 위반)으로
이미 재설계 대상 분리 확정.

## 확정 제약 (CLAUDE.md + 로드맵 Why 승계)

- IR(`packages/types/src/ir.ts`) 확장 금지 — `EdgeKind`·노드 타입 신규 추가 없음.
- Evidence-First: 시퀀스 다이어그램의 모든 participant/message는 기존 IR 노드/엣지의
  provenance·confidence를 그대로 계승한다(신규 추정 로직 없음).
- `buildCombinedDiagram`이 이미 계산한 `drawableEdges`(matched-only)를 재사용 — 신규 임계 계산 금지
  (v1.2.49 freeze 재발 방지 근거).
- `sequence` 필드는 `isDiagramCache` **필수 shape에 넣지 않는다**(구 pair 캐시 전량 무효화 방지 —
  nodeMap·tab3Kind와 동일한 선례).
- participant 별칭 = `sanitizeId(node.id)` — `buildNodeMap`의 `collectDeclaredIds`/`resolveBySuffix`가
  suffix 없는 정확한 sid를 우선 매칭하므로 접두사 없이 그대로 써야 딥링크가 별도 배선 없이 붙는다.
- 페어 분석(FE+BE 동시) 전용 — 단일 모드(`buildDiagrams`)는 `sequence: undefined` 유지, CLI 미노출.

## SubTask 목록 (라우팅: 전량 [S] — 5개 전부 앞 단계 산출물에 의존하는 직렬 체인이라 병렬 후보 미달(4개 미만) + 의존 관계 명확)

- **ST1 [TDD]** `buildSequenceDiagram()` 신규 — `packages/renderer/src/sequence/sequence-diagram.ts`
  (+ `sequence-diagram.test.ts`)
  - 체인: FE ComponentNode →(`fe-be-call`, matched만)→ BE RouteNode →(`handles`)→ Controller
    →(`calls`, N-ary 재귀)→ Service/Repository →(`queries`)→ Table
  - mermaid `sequenceDiagram` 문법으로 emit. participant 별칭 = `sanitizeId(node.id)`.
  - `escapeSequenceLabel` 신규 (`packages/renderer/src/helpers/label-escape.ts`에 추가) —
    `:`가 메시지 구분자라 기존 `escapePlainLabel`로는 불충분.
  - 입력: FE graph, BE graph, `drawableEdges`(이미 계산된 matched-only fe-be-call). 신규 필터링
    로직 추가 금지, 있는 걸 그대로 소비.
  - 페어 아니면(BE 비었거나 drawableEdges 0건) 호출자(ST2)가 애초에 `sequence` 필드를 emit하지
    않는다 — 이 함수 내부에서 "unavailable" placeholder를 만들지 않는다(Less is More).

- **ST2 [TDD]** `DiagramSet.sequence?: string` 필드 신설 + `buildCombinedDiagram` 배선
  (`packages/renderer/src/mermaid-renderer.ts`)
  - `buildDiagrams`(단일모드)는 이 필드를 절대 채우지 않음 → CLI(`renderMermaid`) 미노출 그대로 유지.
  - `drawableEdges.length === 0`이면 `sequence: undefined`(안내 placeholder도 만들지 않음 — 이미
    같은 상황에서 `NO_MATCH` 안내가 rendering 탭에 있으므로 중복 안내 불필요).
  - `combined-diagram.test.ts`에 케이스 추가.

- **ST3 [TDD]** 캐시·메타 가드 — `packages/extension/src/diagram-cache.ts`(또는 동일 책임 파일) +
  `webview.ts` META
  - `sequence`는 `isDiagramCache` **필수 shape에서 제외**(옵셔널 취급) — 넣으면 구버전 캐시 전량
    무효화(nodeMap·tab3Kind 도입 시 실제로 겪은 실패 재발).
  - `webview.ts` META에 `isPair: boolean` 추가 — `sequence !== undefined`가 아니라 원래 분석이
    페어였는지를 명시해, webview가 "단일모드라 원래 없음"과 "페어인데 구버전 캐시라 없음"을
    구분해 정직하게 안내한다(침묵 실패 금지 원칙).
  - `packages/types/src/analyzer-version.ts`에 이번 shape 변경 사실을 주석으로 기록
    (nodeMap/tab3Kind 선례 — 캐시 무효화 규율).

- **ST4** `viewer.html` 4번째 탭 (`data-t="q"`, sequence)
  - 기존 `r`/`s`/`d` 탭 DOM 패턴 재사용 → zoom/fit/pan 로직 무료 상속. 검색(D8)은 sequenceDiagram이
    `.actor`/message 텍스트 구조가 달라 이번 범위에서 **적용하지 않음**(명시 제외, UX 후속 후보).
  - `META.isPair === false`(단일 분석)면 탭 자체를 숨긴다(`display:none`, 기본값).
  - **[구현 중 정정]** `isPair === true`인데 `sequence` 없음인 경우 별도 "재분석 필요" 문구를
    새로 만들지 않는다 — 이 상태는 (a) BE 미인식 (b) 매칭 crossEdge 0건 (c) 구버전 캐시 세 원인이
    모두 `sequence === undefined`로 동일하게 관측되어 코드로 구분할 수 없다(ST3에서 `isPair`를
    "분석 시점에 pairRepoRoot가 지정됐는가"로만 정의했기 때문). 원인을 구분할 수 없는데 "재분석
    필요"라고 특정하면 (a)(b) 케이스에서 거짓 안내가 된다 — 대신 다른 탭과 동일한 기존
    `status.noData`("No data") 범용 안내를 그대로 재사용한다(신규 문구·신규 상태 분기 추가 없음).
  - **DONE 조건**: `scripts/render-harness.mjs` + Playwright 스크린샷 실렌더 확인(D0 교훈 — 렌더러
    unit test GREEN만으론 webview 재해석 결함을 구조적으로 못 잡음). export 경로(MD/온디맨드 SVG)는
    sequence 탭이 CLI 미노출이라 **범위 밖**(애초에 export 대상 아님) — 확인 불필요.
  - TDD 제외 대상(UI/webview, tdd-gate 절대제외 목록) — test-after + 위 DONE 조건으로 검증.

- **ST5** i18n — `packages/extension/src/i18n/dict.ts`에 `tab.sequence` 키 4로케일(ko/en/ja/zh-cn)
  추가, 알파벳 순 유지 컨벤션 준수. TDD 대상 아님(데이터 추가).

## 라우팅 판정

- 전제: git ✅ · verify.sh ✅(--ts-only 지원 프로브 확인) · 독립 `[P]` 후보 0개(전부 이전 SubTask
  산출물에 의존) → **전량 `[S]` 인라인 순차**.

## 미확인 사항 (선반영)

- Playwright MCP가 이번 세션 연결 끊김 상태(`chrome-devtools`/`playwright` MCP 78개 서버 dropped) —
  ST4 DONE 조건의 스크린샷 검증은 MCP 재연결 실패 시 `render-harness.mjs` HTML 산출물의 정적 확인
  (`.actor`/`.messageText` 존재 등 DOM 마커)으로 대체하고, 그 사실을 VERIFY-SPEC에 명시한다.

## 요구사항 추가 (구현 후 확정 — 2026-08-26, 사용자 실측 지적 + 시안 선택)

초기 구현 완료 후 사용자가 실렌더를 보고 결함을 지적했다(원문):

> sequence 가 이상한데? 위아래로 동일한게 2개배치되어잇고 흐름이 그 사이로 표현되는데
> 잘보이지도않아. 개선시안먼저뽑아봐

- **R-ADD-1**: mermaid `sequenceDiagram` 기본값 결함 2건 해소.
  (a) `mirrorActors:true` 기본값 → participant 박스가 상·하 중복 배치.
  (b) init 미지정 → mermaid 기본 회색 화살표/라벨이 이 앱 다크 배경(#060810)에 묻힘.
- **처리**: baseline/A/B/C 4개 시안을 `scripts/render-harness.mjs` 실렌더 스크린샷으로 비교 제시 →
  사용자가 **시안 B** 선택(AskUserQuestion). 다크테마 themeVariables +
  `mirrorActors:false` + `showSequenceNumbers:true`.
- **반영**: `SEQUENCE_INIT` 상수를 `packages/renderer/src/helpers/constants.ts`에 신설하고
  `buildSequenceDiagram()` 출력 첫 줄에 emit. 기존 `RENDERING_INIT`/`BE_RENDERING_INIT`/
  `FE_TREE_INIT`/`DB_DIAGRAM_INIT` 컨벤션(`db-diagram.ts:54`의 `[DB_DIAGRAM_INIT,'erDiagram']`
  패턴)을 그대로 승계 — 신규 패턴 도입 아님.
- **제약 유지**: IR 비확장·Evidence-First·drawableEdges 재사용 전부 그대로. 렌더 표현 계층만 변경.

## 요구사항 추가 2 (2026-08-28, /verify-impl 잔여한계 개선)

/verify-impl 리포트의 "미확인 한계 2건"을 사용자가 "가능하면 개선"으로 지시 → 둘 다 실측 후 개선.

- **R-ADD-2**: 시퀀스 탭 대형 입력 판독불가. PLAN 원안은 "sequence 전용 chunking 없음"을 범위 밖으로
  뒀으나, 실측 결과 **이론적 우려가 아니라 재현되는 결함**이었다 — 100 라우트(participant 501)에서
  fit 배율이 1/60로 떨어져 탭이 사실상 백지(render-harness 스크린샷). 범위 밖 판단의 전제(대형에서
  "이론상 가능성")가 틀렸으므로 원안을 정정한다.
  - **처방**: `buildSequenceDiagram`이 청크당 participant ≤ 12로 쪼개 `joinChunks`로 emit.
    viewer는 무변경 — `cnav-q`·`splitChunks`·`ROW_ST[t]`가 이미 탭 범용이라 emit측만 고치면 된다.
  - **체인 완결성 우선**: 체인을 먼저 버퍼링(`commitChain`)해 현재 청크에 합쳤을 때 예산을 넘는지
    보고 배치한다. 사후 판정이면 청크가 예산을 넘긴 채 확정된다(실측 13/12).
  - **모든 청크에 `SEQUENCE_INIT`**: `splitChunks`가 청크마다 독립 `mermaid.render`를 돌리므로
    첫 청크에만 붙이면 2번째 행부터 기본 테마(밝은 배경·mirrorActors)로 되돌아간다 — R-ADD-1이
    행마다 부활하는 결함. 스트레스 테스트로 기계 강제.
  - **실측**: 20→1200 crossEdge 전 구간에서 청크당 participant ≤ 12 유지, 400 청크(최대 케이스)도
    row-grid 렌더 3초 내 완료(freeze 없음). 청크 수는 설계상 O(crossEdges)이며 상한을 두지 않는다 —
    상한을 두면 데이터를 버려야 하고, 실측상 버릴 이유가 없다.
  - **범위 밖(후속)**: 같은 BE 라우트를 여러 FE 컴포넌트가 호출할 때 DI 체인이 호출자마다 반복
    emit되는 증폭(`visited` Set이 crossEdge마다 새로 생성). 백지 결함의 원인이 아니고(1 FE/라우트
    케이스도 501 participant) 별도 설계 판단이 필요해 분리한다.

- **R-ADD-3**: `dict.ts:2` "추가 키는 알파벳 순" 주석이 실제와 불일치. `legend.*`·`db.view.*`·
  `status.*`·`tab.*` 어느 그룹도 알파벳순인 적이 없고 전부 UI 표시 순이다 — 어긋난 쪽이 산문이라
  4로케일 재정렬(viewer.html 탭 순서와의 대응이 깨지는 순수 churn) 대신 **주석을 실제 규칙으로
  교정**했다.
