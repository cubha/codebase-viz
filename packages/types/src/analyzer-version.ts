// Provenance.analyzerVersion 기준값. cli/extension 모두 이 상수를 사용해야
// CLI 캐시가 extension에서 무효화되지 않는다 (cache key의 일부).
// **분석 결과물(graph/DiagramSet) shape나 내용이 바뀌면 반드시 갱신**한다.
// v1.2.46~v1.2.61 동안 갱신을 빠뜨려, DiagramSet에 nodeMap이 신설된 v1.2.61에서도 구버전 캐시가
// "유효" 판정을 받아 nodeMap 없는 다이어그램이 그대로 재생됐다(딥링크·hover 무반응의 2차 원인).
// v1.2.63: DiagramSet에 tab3Kind 필드 신설(D0) — isDiagramCache shape 가드로 이중화했지만 규율상
// 여기도 범프한다.
export const ANALYZER_VERSION = 'codebase-viz@1.2.63'
