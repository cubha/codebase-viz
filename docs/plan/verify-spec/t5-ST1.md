### VERIFY-SPEC — SubTask ST1 [TDD]

- 기준선 요구사항: "생산측(4개 orm-parser)에 구조화된 **센티넬 원소**를 추가한다 — 기존 사람이 읽는
  문장은 그대로 두고 `orm-class:<ClassName>` 원소를 배열에 하나 더 넣는다. 소비측은 그 접두사로
  완전일치 조회한다." + "포맷 계약을 테스트로 고정"(제약 6).
- 변경 파일: `packages/types/src/ir.ts`(상수·헬퍼 신규) · `packages/types/src/orm-class.test.ts`(신규) ·
  `packages/core/src/adapters/{springboot,django,fastapi,flask}/parsers/orm-parser.ts`(+테스트 4개)
- 관찰 가능한 계약:
  - `ORM_CLASS_PREFIX === 'orm-class:'`, `readOrmClassName(node)`는 `confidence==='inferred'`가 아니면
    `undefined`(타입상 `inferenceChain`이 존재하지 않는 분기).
  - 접두사 **완전일치**만 인정 — `'xorm-class:X'`·`'class:X'`는 무시. 산문 문장만 있으면 `undefined`.
  - 빈 클래스명(`'orm-class:'`)은 `undefined` — 빈 배지를 만들지 않는다.
  - 센티넬이 여러 개면 첫 번째(결정론).
  - 4개 어댑터 각각: 클래스명≠테이블명일 때 `readOrmClassName`으로 복원 가능하고, **기존 산문 원소가
    함께 남아 있다**(대체 아님).
- 구현 결정:
  - 상수·헬퍼의 집을 `@codebase-viz/types`로 잡았다 — core(생산자)와 renderer(소비자)가 둘 다
    types에만 의존하는 유일한 공통 조상이라서다. `TableNode` 필드는 건드리지 않았으므로 IR 비확장
    규칙(부활 금지 등재)에 걸리지 않는다.
  - RED 유효성 확인: 최초 실행 실패 사유가 `readOrmClassName is not a function`(구현 누락)임을
    확인하고 구현했다. import 오타·setup 에러가 아니다.
- 인접 경계: `inferenceChain`을 읽는 기존 소비 지점 2곳(`mermaid-renderer.ts`의
  `'dynamic-segment-match'` 완전일치, `node-map.ts`의 `inferenceChain[0]` 불투명 통과) — 둘 다
  **배열에 원소가 추가돼도 동작이 바뀌지 않는다**(전자는 완전일치 검색, 후자는 [0]만 사용하며
  센티넬은 뒤에 붙는다). 실제로 기존 테스트 전량 GREEN.
- **VERIFY 반영(scope-critic)**:
  - `ANALYZER_VERSION`을 `codebase-viz@1.2.67`로 범프했다. `inferenceChain` 배열 내용이 바뀌는
    **그래프 내용 변경**이라 v1.2.65 규칙이 적용된다 — T4 sequence의 비범프 예외는 "그 텍스트를 emit한
    빌드가 릴리스된 적 없음"이 근거였는데, 여기선 센티넬 없는 캐시가 이미 현장에 있다(v1.2.66까지 배포).
  - `inferenceChain[0]`이 센티넬이 **아님**을 4개 어댑터 테스트에 단언으로 고정했다. `node-map.ts:122`가
    [0]을 hover 툴팁에 그대로 싣기 때문에, 센티넬이 앞에 오면 `orm-class:X`가 사용자에게 노출된다.
    이전엔 구현 관례일 뿐 코드 강제가 없었다.
- 미확인 사항:
  - `node-map.ts:122`가 `inferenceChain[0]`을 툴팁에 싣는데, 센티넬을 **뒤에** 붙였으므로 툴팁 문구는
    안 바뀐다. 다만 향후 누군가 센티넬을 배열 앞에 넣으면 툴팁에 `orm-class:X`가 노출된다 — 순서
    의존이 코드로 강제돼 있지 않다(테스트는 "산문 원소가 함께 존재한다"까지만 고정).
  - TypeORM/Drizzle은 클래스/변수명을 쥐고도 안 넣는다(범위 밖, 별건 기록). 즉 센티넬 커버리지는
    현재 4개 어댑터뿐이다.
