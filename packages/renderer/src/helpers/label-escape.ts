// mermaid 라벨 안 동적 텍스트 이스케이프. 클래스명·경로·MyBatis statement id 등 분석 대상
// 리포가 통제하는 문자열이 라벨로 유입되므로 신뢰 불가 입력으로 취급한다.

// markdown-string 라벨(["`...`"])용. viewer는 htmlLabels:false(SVG 텍스트)라 markdown 문자열로
// bold가 렌더되며, URL 경로의 `_`/`*`/`` ` ``가 italic/bold/code로 오해석되지 않도록 백슬래시
// escape. 추가 방어: 줄바꿈은 공백으로(라벨 행 오염 차단), `"`는 `'`로 치환(라벨 닫힘 토큰 `"]`
// 조기 종료 차단).
export function escapeMd(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').replace(/"/g, "'").replace(/([\\`*_])/g, '\\$1')
}

// plain quoted 라벨(["..."])용. markdown-string이 아니라 `_`/`*`는 그대로 렌더되므로 백슬래시
// 이스케이프를 하면 백슬래시가 눈에 보인다 — 라벨 탈출 벡터(개행·`"]` 조기 종료)만 차단한다.
export function escapePlainLabel(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').replace(/"/g, "'")
}

// sequenceDiagram `participant X as Label`·`A->>B: message` 라인용. `:`가 참가자 alias 구분자·
// 메시지 구분자로 쓰여 escapePlainLabel(개행·`"`만 방어)로는 불충분 — 원본 `:`가 라벨에 남으면
// "participant sid as My: Label"처럼 파서가 라벨을 조기 절단한다.
export function escapeSequenceLabel(s: string): string {
  return s.replace(/[\r\n]+/g, ' ').replace(/:/g, ' -').replace(/"/g, "'")
}
