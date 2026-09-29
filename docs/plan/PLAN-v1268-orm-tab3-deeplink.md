# PLAN — v1.2.68 묶음: ORM 파서 정확성 + Tab3 딥링크 전건

(같은 릴리스로 함께 배포: `PLAN-wave-m-feedback-buttons.md`의 Wave M T10/T13)

## 사용자 요구사항 원문

- "#2 ~ #5 항목 중 함께 배포가능한 대상은 한번에 올리고싶은데 우선 최신구현현황 기준으로 실제 로드맵 메모리
  비교해서 최종결정내용과 어긋나는내용, 이전결정 잔재 체크 후 실제 로드맵만 올려봐"
- "현행과 어긋나는 부분은 전부 최신화해서 반영하고 Tab3 딥링크 전건까지 이번에 함께 배포하도록할게.
  우선 구현부터 /sh-dev-loop --tdd --auto 진행 후 실기검증 및 /verify-impl 진행해"
- 권장 묶음(사용자 수용): Wave M + **Prisma `@@map`** + **TypeORM/Drizzle/Prisma 센티넬** + **Tab3 딥링크**

## 확정 제약·결정

- IR 타입 확장 금지(CLAUDE.md). 클래스명은 기존 `ORM_CLASS_PREFIX`(`orm-class:`) 센티넬 규약으로만 싣는다 —
  **센티넬은 `inferenceChain` 배열 뒤**(`[0]`은 hover 툴팁에 그대로 노출되므로 센티넬 금지).
- Tab3 딥링크는 v62-D2(`resolveBySuffix` 휴리스틱 재설계, 영구 제외)를 **다시 열지 않는다**. ERD 빌더가
  기존 `%% nodemap:` 마커(`nodeMapMarker`)로 선언 id → IR id를 명시하는 **ERD 전용 경로**로 해결.
- 배지 억제 기준(`isInformativeOrmClass`)은 그대로 — 센티넬만 싣고 표시 여부는 기존 규칙이 판정.
- 그래프 내용이 바뀌는 변경이라 `ANALYZER_VERSION` 범프 필수(v1.2.65 규칙, 현장 캐시 존재).
- 제외: 시퀀스 탭 2건, ERD Repository 박스 유지 여부, RF-D3/D5/R1 구조 정리, Tab3 erd 모드 검색 활성화,
  Tab3 사이드바 테이블 클릭 점프(딥링크 대상은 다이어그램 노드).

## SubTask

| ID | 라우팅 | TDD | 내용 | 파일 |
|---|---|---|---|---|
| ST1 | [S] | [TDD] | Prisma: 모델 `@@map("x")` → 테이블명 x(노드 id도 테이블명 기준, JPA와 동일), 필드 `@map("y")` → 컬럼명 y(같은 "틀린 이름 노출" 결함 클래스라 함께), `orm-class:<Model>` 센티넬 | `packages/core/src/db/prisma-parser.ts` (+test) |
| ST2 | [S] | [TDD] | TypeORM: `orm-class:<ClassName>` 센티넬 + 관계 FK `references.table`을 클래스명이 아닌 **대상 엔티티의 테이블명**으로 해석(현재 클래스명이 들어가 ERD FK 선이 드롭됨 — 테스트로 실증 후 수정) | `packages/core/src/db/typeorm-parser.ts` (+test) |
| ST3 | [S] | [TDD] | Drizzle: `orm-class:<변수명>` 센티넬(`export const users = pgTable('tb_user', …)`) | `packages/core/src/db/drizzle-parser.ts` (+test) |
| ST4 | [S] | — | `ANALYZER_VERSION` 범프 + 사유 주석 | `packages/types/src/analyzer-version.ts` |
| ST5 | [S] | [TDD] | ERD(`buildDbScreenDiagram` erd 경로)가 테이블·소스 프록시(라우트/컴포넌트/Repository) 선언마다 `%% nodemap:<declId>=<IR id>` 마커 emit → `buildNodeMap`이 Tab3 노드를 해석. 청킹 폴백 경로 포함 | `packages/renderer/src/erd/db-diagram.ts` (+test) |
| ST6 | [S] | — (E2E) | viewer.html 거짓 주석 3곳 정정("Tab3는 erDiagram이라 .node 없음") + Playwright 실출력 E2E(Tab3 erd 모드 테이블·소스 박스 hover 툴팁·클릭 openNode) | `packages/extension/media/viewer.html`, `tests/playwright/` |

라우팅: 전량 [S] (독립 [P] 후보 < 4, ST5→ST6 의존).

### Phase 3 FIX로 추가된 범위 (scope-critic 판정 반영, 2026-09-29)

| ID | 근거 | 내용 | 파일 |
|---|---|---|---|
| F1 | ST1 critic(yes) → 추적 결과 파일명 휴리스틱 회귀 실재 | Prisma `@@map` 테이블도 모델명(센티넬)으로 파일명 매칭 유지. Prisma 외 ORM은 클래스명 키를 열지 않음 | `packages/core/src/adapters/_shared/mapper-utils.ts` |
| F2 | ST3 critic(yes) — 무정보 배지 | `isInformativeOrmClass` 정규화에 `table` 접미사 제거 추가(`usersTable ⌗ users` 억제) | `packages/renderer/src/erd/db-diagram.ts` |
| F3 | ST3 critic(yes) — 같은 결함 클래스 단편 수정 | Drizzle 컬럼명 = 빌더 루트 호출 첫 인자(DB 이름), 없으면 TS 키 | `packages/core/src/db/drizzle-parser.ts` |
| F4 | F3와 같은 기준 적용 | TypeORM `@Column({ name })` DB 이름 | `packages/core/src/db/typeorm-parser.ts` |
| F6 | 실기검증(CLI 실분석 mini-nest-app) | Tab3 소스 라벨이 테이블 선언 id와 겹치면 테이블 마커 우선(오점프 방지) | `packages/renderer/src/erd/db-diagram.ts` |
| F5 | ST1 미확인 사항 실측 | Prisma `@map(name:)` 키-값 형태 테스트 고정 | `prisma-parser.test.ts` |

## UI 설계

신규 UI 없음 — 기존 T1/T2 hover 툴팁·클릭 펄스를 Tab3 erd 모드 노드에 그대로 적용.
