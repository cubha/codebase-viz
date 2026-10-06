# PLAN — v1.2.69: 결함 일괄 수정 + viewer UX 3건 + GIF 재촬영

## 사용자 요구사항 원문

- "A1. di를 따로그리는게아니라 endpoint는 하나로두되 각 호출부에서 해당 root로 연결되도록 그림"
- "A2. 보여지지않는내용이고 사이드이펙트 없다면 제거."
- "착수전확인해야하는 보류대상은 착수전에 직접실측확인하고 메모리에 갱신"
- "재촬영도 해야지;; 1268 ->1269 버전업데이트 시 ui상 바뀌는거 없으면 미리촬영. (아니면 구현종료후촬영)
  /sh-dev-loop --tdd --auto 진행해. Angular forChild 등 결함은 없어야하는거니까.. 결함내용도 이번에 같이
  수정해줘 제발 이월없이"
- UX 범위 질문 답: **"3건 모두 포함"** — 제시안: UX-2 화면 맞춤 시 글자가 읽히는 최소 배율 하한(넘치는 부분은
  팬/스크롤) · UX-1 범례 접기 토글 + 줄 단위 모드에서 콘텐츠를 범례 아래로 내림 · UX-3 줄 단위 모드
  '전체보기'를 폭 맞춤으로 통일. GIF는 구현 후 촬영.

## 범위 판정 기준

**결함 = 지원한다고 한 입력에서 기존 코드가 틀린/누락된 출력을 낸다.** 이번에 전부 수정한다.
새 어댑터·새 기능이 있어야 해결되는 것은 결함이 아니며 아래 「제외」에 사유를 적는다(이월 아님).

## 확정 제약·결정

- IR 타입 확장 금지. NodeId는 `makeNodeId` 결정론 유지 — **같은 NodeId 2개 금지**(CLAUDE.md 규칙).
- 그래프 내용 변경(Angular·TypeORM·Flyway·ERD) → `ANALYZER_VERSION` 범프.
- UX-3 주의: row-mode `fitS=1.0`은 v1.2.1(T-FIX-3)에서 **의도적으로** 고정됐다 — 폭 맞춤이 975라우트·33청크
  BE에서 판독 불가 수준으로 줄였기 때문. 따라서 "폭 맞춤 통일"은 **가독 하한(floor)과 함께**만 성립한다.
  UX-2와 UX-3를 **하나의 fit 정책**으로 통일: `scale = max(min(fit, 1), READABLE_FLOOR)` — 단일/줄 단위
  모드가 같은 규칙을 쓴다. 하한에 걸리면 콘텐츠 시작점(상단)이 보이게 정렬하고 나머지는 팬/스크롤.
- 결함마다 되돌림 실험(구현 제거 시 테스트 FAIL) 수행 — 허수 테스트 차단.

## SubTask

| ID | TDD | 내용 | 파일 |
|---|---|---|---|
| ST1 | [TDD] | **A1** 시퀀스: crossEdge를 BE endpoint(route) 단위로 묶어 각 FE 호출부 화살표는 모두 그리고 route→Controller→DI 체인은 endpoint당 1회. 그룹 하나 = 체인 하나로 청크 예산 판정 | `renderer/src/sequence/sequence-diagram.ts` (+test) |
| ST2 | [TDD] | 시퀀스 입력 누락: `buildCombinedDiagram`이 시퀀스에 `drawableEdges`(FE 부모 라우트 있는 것만)를 넘겨 matched 65 중 57만 그림 — 시퀀스는 FE 컴포넌트에서 시작하므로 부모 라우트 제약 불필요 → `matchedEdges` 전달(신규 매칭 계산 없음, v1.2.49 freeze 조건 무관) | `renderer/src/mermaid-renderer.ts` (+test) |
| ST3 | [TDD] | **A2** ERD: queries 엣지 없는 BE Repository 고아 프록시 제거(queries 있는 Repository는 유지). 테스트 `mermaid-renderer.test.ts:308`은 명세 변경으로 수정. BE 표준 §4 갱신 | `renderer/src/erd/db-diagram.ts`, `docs/design/BE-DIAGRAM-STANDARD.md` |
| ST4 | [TDD] | Angular 라우트 결함 4종: ① NgModule 클래스 `loadChildren(m => m.XModule)`이 그 모듈의 `RouterModule.forChild(...)`로 해석 안 돼 부모 prefix 소실 ② lazy 하위가 forChild 단독 처리와 이중 등록(무접두 중복) ③ `/admin/` 후행 슬래시 ④ lazy 경로에 componentSpec/loadComponent 미전달 ⑤ `rawPathMap`·`componentSpecMap`이 fullPath 키라 같은 path(`''`+outlet 등) 덮어쓰기 → 컴포넌트 소실·**동일 NodeId 2개** | `core/src/adapters/angular/parsers/route-parser.ts` (+test) |
| ST5 | [TDD] | Tab2 `pathToDisplayRoute`가 같은 path의 **정적 파서 라우트까지** 하나로 합쳐 소실 — 원래 의도(LLM 중복을 정적 라우트로 흡수)만 남기고 정적 라우트는 id별 유지 | `renderer/src/mermaid-renderer.ts` (+test) |
| ST6 | [TDD] | TypeORM 관계 FK: `@JoinColumn({ name })` DB 컬럼명 반영 · `referencedColumnName` 반영 · `@OneToOne`은 `@JoinColumn` 있는 소유측만 FK 컬럼(역방향에 가짜 FK 생성 결함) | `core/src/db/typeorm-parser.ts` (+test) |
| ST7 | [TDD] | Flyway: ① 파일을 **버전 순** 정렬(readdir 순 아님) ② `ALTER TABLE` ADD [COLUMN] / DROP [COLUMN] / RENAME COLUMN a TO b / ADD [CONSTRAINT x] FOREIGN KEY ③ CREATE TABLE의 인라인 `REFERENCES t(c)`·테이블 레벨 `FOREIGN KEY (c) REFERENCES t(c)` → `references`(현재 FK 전량 무시). 그 외 ALTER 구문(타입 변경·인덱스 등)은 무시 | `core/src/db/flyway-parser.ts` (+test) |
| ST8 | — | `ANALYZER_VERSION` 범프 + 사유 | `types/src/analyzer-version.ts` |
| ST9 | — (UI/E2E) | **UX-2+UX-3** 통일 fit 정책: 단일 모드 `fitToView`·줄 단위 `fitRowSvgsInitial`/reset이 같은 `fit=max(min(폭·높이 맞춤,1), floor)` 사용. 하한에 걸린 단일 모드는 상단 정렬 | `extension/media/viewer.html`, `tests/playwright/` |
| ST10 | — (UI/E2E) | **UX-1** 범례 접기 토글(헤더 클릭, 상태 localStorage 아님 — webview state) + 줄 단위 모드에서 grid 상단 여백을 범례·청크 칩 하단까지 확보해 첫 줄과 겹치지 않음. i18n 4로케일 | `viewer.html`, `extension/src/i18n/dict.ts`, `tests/playwright/` |
| ST11 | — | 전 fixture 스냅샷 갱신(typecheck 선행) — 변경 diff가 위 결함 수정으로만 설명되는지 검토 | `packages/cli/src/__snapshots__` 등 |
| ST12 | — | GIF 재촬영(구현 후): `demo-tab-switch.gif`·`demo-db-toggle.gif`(현재 구 브랜드 "CodeSight"·UX 결함 노출) + `screenshot-sidebar.png`(피드백 버튼 반영). extension dist 재빌드 후 촬영 | `packages/extension/media/` |

라우팅: 전량 [S] — ST4/5/6/7/3이 같은 `all-fixtures` 스냅샷·`ANALYZER_VERSION`을 공유해 독립 아님.

### Phase 3 FIX로 추가된 범위 (scope-critic 판정 반영, 2026-10-06)

| ID | 근거 | 내용 | 파일 |
|---|---|---|---|
| F1 | ST2 critic(yes) | 매칭 호출이 있지만 FE 부모 라우트가 없어 Tab1에 못 그리는 경우 "매칭 없음" 대신 "Sequence 탭에서 확인" 안내(Sequence 탭과 모순 제거). DiagramSet.sequence 주석 정정 | `renderer/src/mermaid-renderer.ts` |
| F2 | ST4 critic(정확성 gap) | 같은 "라우트 소실" 계열: `provideRouter([...X_ROUTES, …])` spread 펼침 · `loadChildren: () => import('./x')`(then 없음)·`.then(m => m.default)` 기본 export 해석 | `core/.../angular/parsers/route-parser.ts` |
| F3 | ST7 critic(yes) | ERD가 그리는 컬럼 이름·타입·NULL을 바꾸는 ALTER도 반영: Postgres `ALTER COLUMN c [SET DATA] TYPE t`·`SET/DROP NOT NULL`, MySQL `MODIFY [COLUMN]`·`CHANGE [COLUMN] old new` | `core/src/db/flyway-parser.ts` |

ST4 상세(기준선 보강 — 같은 "틀린 라우트 출력" 결함 계열로 함께 처리): ⑥ 컴포넌트 없는 컨테이너(children/loadChildren)는
자식에 기본 outlet `path:''`가 있으면 따로 내지 않음(같은 URL 이중 등록 — ② 계열) ⑦ `redirectTo` 전용 항목은 페이지가 아니므로 라우트로 내지 않음.
ST7 경계 갱신: "그 외 ALTER(타입 변경·인덱스 등)는 무시" → 타입·NULL 변경은 F3로 반영, 인덱스·UNIQUE·CHECK·기본값만 무시.

## 제외 (결함 아님 — 기능 신설, 이월 아님)

- Expo/expo-router 어댑터 · 듀얼 플랫폼 레인 — 어댑터 신설.
- Nest BE의 handles/calls/queries 엣지 생성 — 현재 Spring만 지원하는 기능의 확장.
- CLI pair 플래그(RF-R1) · 레버3 가상화(렌더 후 스크롤 정상 실측) · RF-D3/D5.
- partner-mock 페어 매칭 0건 — FE `/api` vs BE `/v1` gateway rewrite를 의도적으로 재현한 fixture이며
  테스트 주석에 명시돼 있고(진짜 증거는 `TWA_CONTRACT_MST` 단언), 매칭 경로는 별도 테스트가 검증.
  gateway prefix 매핑은 신규 기능.
- TypeORM `@JoinColumn` 없는 `@ManyToOne` 기본 FK 이름은 NamingStrategy 의존이라 정적으로 확정 불가 —
  현행(프로퍼티명) 유지(Evidence-First).

## UI 설계

- 디자인 토큰 Ground Truth 없음 → viewer.html 기존 CSS 변수·`.legend` 스타일 재사용, 신규 색 0.
- 범례 토글: 범례 상단에 작은 헤더 행(“Legend ▾/▸”) — 클릭/Enter/Space로 접힘, `aria-expanded`.
- READABLE_FLOOR: mermaid 기본 폰트 14~16px 기준 실효 ≥ 9px → floor ≈ 0.6 (실측으로 확정).
