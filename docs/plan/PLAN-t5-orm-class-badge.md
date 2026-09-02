# PLAN — Wave B T5 (재정의): Tab3 ERD에 ORM 클래스명 병기

## 요구사항 원문 (사용자 발화 + 선택)

> wave b 종결진행할게. 우선 t5관련해서 /braintrust 우선 진행해줘

braintrust 5렌즈 판정 후 AskUserQuestion으로 사용자가 **"재정의해서 구현 후 종결"** 을 선택.
선택지 원문: *"classDiagram 원안은 폐기하고, T5를 「Tab3 ERD에 ORM 클래스명 병기」로 재정의해 구현.
생산측 센티넬(4개 orm-parser) + `%% table:` 마커에 class: 추가 + 라벨/사이드바 렌더. IR 확장 0,
견적 ~15~20줄 + 테스트."*

## 이 재정의의 근거 (braintrust 5렌즈 실측)

- **원안(classDiagram) 폐기 확정** — 실물 산출 대조: `mini-spring-full-app` ERD가 엔티티 4·필드 16·
  관계선 4인데 classDiagram이 그릴 수 있는 것도 완전 동일. `ColumnDef`에 메서드·가시성·상속이 없어
  문법만 바뀐 재렌더. 중복 상대는 ERD가 아니라 **사이드바**(다이어그램=관계 / 사이드바=컬럼 분업).
- **"IR 확장 필요"는 거짓** — className은 이미 4개 어댑터가 `inferenceChain`에 기록한다.
- **가치는 실재** — className 잡힌 40/40이 tableName과 문자열이 다르고, 규칙으로 유도 불가능한 것이
  9/36(`DecoSheet→TB_HODS401`, `TransStmt→TWO_WINS_COM_WHOT_DTL`, `ProcCode→TWO_POWCD`).
- **현재 화면엔 0회 등장** — partner-mock ERD 렌더 본문 65라인에 클래스명 문자열 전무.

## 확정 제약

1. **IR 확장 금지** — `TableNode`에 필드 추가 금지(부활 금지 목록 등재됨).
2. **`inferenceChain` 산문 정규식 파싱 금지**(부활 금지 등재). 생산측에 **센티넬 원소**를 추가하고
   소비측은 접두사 완전일치로 읽는다. 선례 = `mermaid-renderer.ts:218`의 `'dynamic-segment-match'`
   완전일치. 사람이 읽는 기존 문장은 **그대로 둔다**(제거하지 않는다).
3. **마커 경로 재사용** — `erd/db-diagram.ts:59`의 `%% table:<name> path:<file>`에 `class:<Name>`을
   얹는다. `nodeMap`/`resolveBySuffix`는 건드리지 않는다(별건 결함).
4. **없으면 아예 렌더하지 않는다** — className 미포착 어댑터(typeorm/drizzle/prisma/supabase/
   flyway/mybatis)와 className===tableName인 경우 배지 자체를 만들지 않는다(Less is More,
   빈 배지·동일값 배지 금지).
   - **[구현 중 정정 — 2026-09-02]** "동일값"을 문자열 완전일치로만 구현했더니 스냅샷에서
     `%% table:users ... class:User`, `table:posts ... class:Post`가 나왔다. 문자열은 다르지만
     대소문자·복수형·snake_case로 **서로 유도되는 이름이라 정보가 0**이고, braintrust 실패모드 렌즈의
     실측(@Entity 36개 중 유도 불가능한 것은 9개, 나머지 27개가 이 부류)대로 **대부분의 행에 무정보
     배지가 붙는다**. 절대원칙 1의 "Noise is worse than silence"가 정확히 이 경우라, 판정을
     `isInformativeOrmClass()`로 승격해 **정규화 후 같아지면 싣지 않는다**(소문자화 + `_` 제거 +
     후행 `s` 제거). `DecoSheet↔TB_HODS401`·`CuttingPlan↔TWO_MOLD_CUTING_NRM`처럼 실제로 못 알아보는
     매핑만 남는다. 제약의 **취지는 그대로**이고 판정 기준만 좁혔다.
5. **Evidence-First** — 배지 출처는 `confidence: 'inferred'` 노드다. 사실처럼 단정하지 않는다.
6. **포맷 계약을 테스트로 고정** — 4개 orm-parser 테스트에 현재 `inferenceChain` 단언이 **0건**이라,
   센티넬 도입 시 테스트가 없으면 문구 변경만으로 verify.sh 초록불인 채 조용히 깨진다.

## SubTask 목록 (라우팅: 전량 [S] — 생산→emit→소비 직렬 체인, [P] 후보 0개)

- **ST1 [TDD]** 센티넬 생산 — `packages/types/src/ir.ts`(상수+헬퍼) + 4개 orm-parser
  - `ORM_CLASS_PREFIX = 'orm-class:'` 상수와 `readOrmClassName(node): string | undefined` 헬퍼를
    types에 둔다(core=생산자, renderer=소비자 둘 다 types에만 의존하므로 유일한 공통 조상).
    **IR 타입은 불변** — 상수/헬퍼 추가지 `TableNode` 필드 추가가 아니다.
  - `springboot`/`django`/`fastapi`/`flask` orm-parser가 `inferenceChain`에 `orm-class:<ClassName>`
    원소를 **추가**한다(기존 문장 유지).
  - 포맷 계약 테스트: 4개 어댑터 각각 + 헬퍼 단위 테스트(센티넬 없는 노드→undefined).

- **ST2 [TDD]** 마커 emit — `packages/renderer/src/erd/db-diagram.ts`
  - `%% table:<sid> path:<file>` 줄에 className이 있고 **tableName과 다를 때만** ` class:<Name>`을
    덧붙인다. 없거나 같으면 기존 줄 그대로(제약 4).
  - `path`가 없어 마커 자체가 안 나가는 기존 조건은 유지.

- **ST3** viewer 소비·렌더 — `packages/extension/media/viewer.html` (TDD 제외: UI)
  - `parseDbData`(863~) 마커 정규식에 `class:` 추가 → `tables[name].className`.
  - `buildSingleDbGraph`(995~) 노드 라벨에 병기 → 사용자가 `TB_HODS401`과 `DecoSheet`를 함께 본다.
  - `buildSidebar`(1220~)는 `%%` 줄을 skip하므로(1227) 마커를 별도 파싱해 카드 헤드에 병기.
  - 배지는 inferred 출처임이 드러나게 표기한다(제약 5).

- **ST4** i18n — `packages/extension/src/i18n/dict.ts`에 배지 툴팁 키 1개 4로케일(ko/en/ja/zh-cn).
  키 배치는 파일 규칙(그룹 내 UI 표시 순) 준수.

## 라우팅 판정

- 전제: git ✅ · verify.sh ✅(`--ts-only` 지원) · 독립 `[P]` 후보 0개 → **전량 `[S]` 인라인 순차**.

## DONE 조건

- `bash verify.sh --full` ALL PASS.
- `scripts/render-harness.mjs` 실렌더로 **partner-mock fixture에서 `DecoSheet`↔`TB_HODS401`이 실제
  화면에 보이는 것**을 스크린샷으로 확인(렌더러 텍스트 GREEN만으론 webview 재해석 결함을 못 잡는다 —
  D0 교훈).
- className 없는 fixture(supabase/mybatis 등)에서 배지가 **아예 안 뜨는 것**도 확인.

## 범위 밖 (건드리지 않음 — 전부 별건 기록됨)

`resolveBySuffix` 방향 결함(ERD declId가 IR sid보다 짧아 조회 실패) · Repository 유사 테이블 박스
37% · prisma `@@map` 미처리 · TypeORM/Drizzle className 미포착 보강 · UX-2 그룹 단위 청킹 ·
classDiagram(영구 폐기).
