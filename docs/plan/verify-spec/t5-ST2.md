### VERIFY-SPEC — SubTask ST2 [TDD]

- 기준선 요구사항: "`erd/db-diagram.ts:59`의 `%% table:<name> path:<file>`에 `class:<Name>`을 얹는다.
  `nodeMap`/`resolveBySuffix`는 건드리지 않는다" + 제약 4(없거나 같으면 렌더 안 함).
- 변경 파일: `packages/renderer/src/erd/db-diagram.ts` · `packages/renderer/src/erd/db-diagram.test.ts`
- 관찰 가능한 계약:
  - `readOrmClassName(t) !== undefined && !== t.name` 일 때만 ` class:<sanitizeId(name)>`를 덧붙인다.
  - 클래스명 없음 / **정규화 후 테이블명과 같음** → 마커에 `class:`가 **아예 없다**.
    판정은 `isInformativeOrmClass(ormClass, tableName)`(export) — 소문자화 + `_` 제거 + 후행 `s` 제거
    후 비교한다. `User↔users`·`Post↔posts`·`AuditLog↔audit_logs`는 억제, `DecoSheet↔TB_HODS401`·
    `CuttingPlan↔TWO_MOLD_CUTING_NRM`·`ProcCode↔TWO_POWCD`는 통과. [PLAN 정정 반영 — 최초엔
    문자열 완전일치였고, 스냅샷에서 무정보 배지가 대량 발견돼 좁혔다.]
  - 기존 `path:` 필드를 대체하지 않고 뒤에 덧붙인다(순서: `table: → path: → class:`).
  - 마커는 mermaid 주석(`%%`)이라 **렌더 본문에는 클래스명이 등장하지 않는다** — 별도 테스트로 고정.
  - `path`가 없어 마커 자체를 안 내보내던 기존 조건은 그대로.
- 구현 결정:
  - 클래스명에도 `sanitizeId`를 적용했다. 마커는 viewer가 `(\w+)`로 파싱하므로 `[A-Za-z0-9_]` 밖의
    문자가 들어오면 파싱이 잘린다. 부수 효과로 HTML/mermaid 라벨 주입 벡터도 원천 차단된다
    (v1.2.60 라벨 이스케이프 누락 전례).
  - `nodeMap`/`resolveBySuffix`는 손대지 않았다 — ERD declId가 IR sid보다 짧아 조회가 실패하는 결함은
    실재하지만 PLAN 범위 밖(별건). 마커 경로는 그 결함과 무관하게 이미 작동한다.
- 인접 경계: `stripNodeMapMarkers`(`%% nodemap:`만 제거)는 `%% table:` 줄을 건드리지 않으므로
  CLI `.md` 산출물에도 이 마커가 그대로 남는다 — 기존 `path:` 필드와 동일한 취급이라 신규 노출 아님.
- 미확인 사항:
  - 정규화 규칙(후행 `s` 1개만 제거)은 불규칙 복수(`Person↔people`)·접두사 컨벤션(`tbl_user`)을
    못 거른다 — 그런 경우 배지가 뜬다. 과억제보다 과표시가 안전하다고 판단했으나 실측 근거는 없다.
  - CLI `.md`를 사람이 읽을 때 `class:` 필드가 노이즈로 보일 여지가 있다(주석이라 mermaid 렌더에는
    영향 없음). 기존 `path:`가 이미 같은 성격이라 별도 처리하지 않았다.
  - 클래스명에 비ASCII가 들어가는 스택(예: 한글 클래스명)에서 `sanitizeId`가 전부 `_`로 바꿔
    무의미한 배지가 될 수 있다 — 현 4개 어댑터 fixture엔 해당 사례가 없어 실측 못 했다.
