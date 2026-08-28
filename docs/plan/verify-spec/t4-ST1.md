### VERIFY-SPEC — SubTask ST1

- 기준선 요구사항: "buildSequenceDiagram() 신규 — 체인: FE컴포넌트 →(fe-be-call)→ BE라우트 →(handles)→
  Controller →(calls N-ary 재귀)→ Service/Repository →(queries)→ Table 체인을 mermaid
  sequenceDiagram으로 emit. participant 별칭 = sanitizeId(node.id). buildCombinedDiagram이 이미
  계산한 drawableEdges를 재사용 — 신규 임계 계산 금지. escapeSequenceLabel 신규."
- 변경 파일:
  - `packages/renderer/src/sequence/sequence-diagram.ts` (신규)
  - `packages/renderer/src/sequence/sequence-diagram.test.ts` (신규, TDD RED→GREEN)
  - `packages/renderer/src/helpers/label-escape.ts` (수정 — `escapeSequenceLabel` 추가)
- 관찰 가능한 계약: `buildSequenceDiagram(feGraph, beGraph, drawableEdges)` 호출 시, drawableEdges의
  각 fe-be-call 엣지에 대해 FE ComponentNode → BE RouteNode → (handles 있으면) Controller →
  (calls 재귀) → (queries 있으면) Table 순서로 `sequenceDiagram` 텍스트를 emit한다. 모든 participant
  alias는 `sanitizeId(node.id)`와 정확히 일치(딥링크 자동 편입 전제). `confidence==='inferred'`인
  엣지는 `-->>` (점선), 아니면 `->>` (실선). 순환 calls 그래프에서도 depth 6 가드로 종료한다.
- 구현 결정:
  - handles 엣지가 route당 여러 개(fan-in)인 극단 케이스는 edges 배열 순서상 첫 번째만 대표로 쓴다
    (파서 출력 순 = 결정론적이지만, "왜 이 컨트롤러가 대표인지"에 대한 별도 표시는 없음).
  - 같은 controller가 여러 FE 호출 경로에서 재방문되면(서로 다른 drawableEdge) 체인이 중복
    emit될 수 있다 — visited set을 top-level edge마다 새로 만들기 때문(의도적: 각 FE 호출을
    독립된 시퀀스로 보여주는 게 사용자에게 더 유용하다고 판단, 단 대형 그래프에서 메시지 수가
    늘어날 수 있음 — 이번 범위에서 dedup 안 함).
  - queries 엣지는 calls 체인의 "모든" 방문 노드에서 확인(Repository뿐 아니라 Service가 직접
    querying해도 emit) — Spring 관례상 대개 Repository지만 IR 자체는 이를 강제하지 않으므로
    일반화했다.
- 인접 경계: `buildCombinedDiagram`(ST2가 호출) / IR `EdgeKind`(handles/calls/queries/fe-be-call,
  신규 kind 없음) / `sanitizeId`·`buildNodeMap`의 suffix 역해석(딥링크 자동 편입 전제 — 접두사 없이
  그대로 써야 함, ST1에서 검증 완료).
- 미확인 사항: 실제 Spring DI 그래프에서 controller→service가 N-ary fan-out(여러 서비스 동시 주입)일
  때 시퀀스 다이어그램이 시각적으로 읽기 좋은지는 실 데이터(mini-spring-* fixture)로 아직 확인 안 함
  — 합성 유닛테스트로만 검증됐다.

### 후속 변경 (2026-08-28, R-ADD-2 청킹)

- 변경: `buildSequenceDiagram`이 단일 문자열이 아니라 **청크 목록**(`joinChunks`)을 반환한다.
  청크당 participant ≤ 12(`MAX_PARTICIPANTS_PER_CHUNK`), 체인은 청크 경계에서 쪼개지지 않는다.
- 관찰 가능한 계약(스트레스 테스트로 기계 강제 — `mermaid-renderer.stress.test.ts`):
  - 모든 청크의 participant 수 ≤ 12 (100 라우트 / 1200 crossEdge 두 스케일).
  - 모든 청크의 첫 줄이 `SEQUENCE_INIT`(`mirrorActors:false` 포함), 둘째 줄이 `sequenceDiagram`.
  - 모든 메시지의 양끝 participant가 같은 청크에 선언돼 있다(체인 분절 0).
  - 전체 청크의 fe-be-call 메시지 수 = `drawableEdges` 수 (누락 0).
- 실렌더: 100 라우트 → 50 rows, 전 행 다크테마·판독 가능(`render-harness.mjs` 스크린샷).
- 미확인 사항: 1200 crossEdge를 **실제 사용자 레포**에서 관측한 적은 없다 — 합성 fixture 기준이다.
  또한 동일 BE 라우트의 DI 체인이 FE 호출자마다 반복되는 증폭은 이번 범위 밖(R-ADD-2 후속 항목).
