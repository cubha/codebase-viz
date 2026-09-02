// Provenance.analyzerVersion 기준값. cli/extension 모두 이 상수를 사용해야
// CLI 캐시가 extension에서 무효화되지 않는다 (cache key의 일부).
// **분석 결과물(graph/DiagramSet) shape나 내용이 바뀌면 반드시 갱신**한다.
// v1.2.46~v1.2.61 동안 갱신을 빠뜨려, DiagramSet에 nodeMap이 신설된 v1.2.61에서도 구버전 캐시가
// "유효" 판정을 받아 nodeMap 없는 다이어그램이 그대로 재생됐다(딥링크·hover 무반응의 2차 원인).
// v1.2.63: DiagramSet에 tab3Kind 필드 신설(D0) — isDiagramCache shape 가드로 이중화했지만 규율상
// 여기도 범프한다.
// v1.2.65: RR 딥링크 결함 수정으로 **shape는 그대로인 채 내용만** 바뀌었다(route/component
// provenance 좌표 · nodeMap 라우트 엔트리의 f·l). isDiagramCache의 shape 가드는 nodeMap·tab3Kind
// 존재만 보므로 구캐시를 걸러내지 못한다 — 이 상수 범프가 **유일한** 무효화 수단이다. 안 하면
// 사용자는 고친 뒤에도 낡은 캐시로 map 지점에 계속 착지한다.
// T4(Wave B): DiagramSet.sequence 필드 신설은 **의도적으로 이 규율의 예외**다 — nodeMap·tab3Kind처럼
// 범프하면 그 순간 존재하는 모든 pair 캐시(sequence 없이 저장된 것 포함해 단일모드 캐시까지)가
// 전량 무효화된다. sequence는 옵셔널이고 isDiagramCache 필수 shape에도 넣지 않았으므로, 구캐시는
// 그냥 그 필드가 없는 채로 유효하게 로드되고 새 Sequence 탭은 "no data"로 정직하게 빈 채 뜬다
// (webview.ts META.isPair가 "페어 분석이었다"는 사실 자체는 계속 정확히 알려준다). 재분석해야
// sequence가 채워진다 — 이건 버그가 아니라 없던 다이어그램을 그리려면 당연히 재계산이 필요하다는
// 뜻이라, 전체 무효화라는 더 비싼 대가를 치를 이유가 없다.
// T4 후속(청킹): sequence를 participant 예산으로 청킹한 변경은 **내용만 바뀐 변경**이라 원래는
// v1.2.65 선례대로 범프가 유일한 무효화 수단이다. 여기선 범프하지 않는데, 이유는 규율의 예외가
// 아니라 **모집단이 없어서**다 — 청킹 안 된 sequence를 emit한 빌드는 한 번도 릴리스된 적이 없고
// (T4 전체가 이 릴리스에 처음 나간다) 그런 텍스트를 담은 캐시는 존재할 수 없다. 다음에 sequence
// **내용**이 바뀌면 그때는 위 v1.2.65 규칙이 그대로 적용된다.
// T5(2026-09-02): 4개 ORM 파서가 TableNode의 `inferenceChain`에 `orm-class:` 센티넬 원소를 추가한다 —
// **그래프 내용 자체가 바뀌는 변경**이라 v1.2.65 규칙이 그대로 적용된다. T4 sequence 때와 달리 여기선
// 예외가 성립하지 않는다: 센티넬 없는 캐시가 **이미 현장에 존재**하고(v1.2.66까지 배포됨), 그 캐시로는
// Tab3 클래스명 배지가 조용히 안 뜬다. shape 가드(isDiagramCache)는 IRGraph 내부 배열 내용을 보지
// 않으므로 이 상수 범프가 유일한 무효화 수단이다.
export const ANALYZER_VERSION = 'codebase-viz@1.2.67'
