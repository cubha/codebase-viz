// ELK opt-in 폐기. v1.2.45 ELK INCLUDE_CHILDREN은 모든 level X축 강제로
// 규칙 B(leaf cluster 내부 Y축) 위반. webview console에서 ELK loader 메시지 미확인. dagre로 복귀.
// 규칙 A(sibling X축)는 buildNestedSubgraphLines + leaf 합성 노드 패턴(#16·#17)으로 dagre에서 직접 강제.
export const RENDERING_INIT = `%%{init:{'theme':'base','themeVariables':{'background':'#060810','primaryColor':'#0c1a30','primaryTextColor':'#7dd3fc','primaryBorderColor':'#0e3a6e','edgeLabelBackground':'#0c1a30','lineColor':'#334155','secondaryColor':'#0f172a','clusterBkg':'#060c18','clusterBorder':'#1e3a5f','fontFamily':'JetBrains Mono','fontSize':'14'}}}%%`

// BE 전용 init — flowchart.nodeSpacing/rankSpacing 축소로 DI 체인 간격 조밀화. FE 다이어그램은 RENDERING_INIT 유지.
// Y축(rankSpacing) 1/3 축소. visible edge 영역(Tab2 DI 체인)은 정상 반영,
// invisible `~~~` link 영역(Tab1 endpoints)은 dagre가 별도 처리하므로 endpoints emit 로직에서 visible edge로 전환됨.
export const BE_RENDERING_INIT = `%%{init:{'theme':'base','themeVariables':{'background':'#060810','primaryColor':'#0c1a30','primaryTextColor':'#7dd3fc','primaryBorderColor':'#0e3a6e','edgeLabelBackground':'#0c1a30','lineColor':'#334155','secondaryColor':'#0f172a','clusterBkg':'#060c18','clusterBorder':'#1e3a5f','fontFamily':'JetBrains Mono','fontSize':'14'},'flowchart':{'nodeSpacing':25,'rankSpacing':8,'padding':4}}}%%`

// FE Tab2 트리 전용 init (v1.2.53) — 평탄 subgraph + visible `pkg --> leaf` edge 구조라
// flowchart.rankSpacing가 정상 반영된다(BE Tab2 DI 체인과 동일 구조 선례). 기본 rankSpacing(≈50)이
// 도메인 트리 깊이마다 Y축 연결선을 과도하게 늘리고 레이어별 길이를 들쭉날쭉하게 만들던 문제를
// rankSpacing 축소로 표준화한다. multiline leaf(📄 파일명)도 겹치지 않는 최소 간격으로 조정.
// Tab1(nested wrapper + 외부 edge + `~~~`)은 spacing 옵션이 무시되는 케이스라 RENDERING_INIT 유지
// (feedback_mermaid_nested_subgraph_spacing). nodeSpacing은 형제 X축 가독성 위해 기본 근처 유지.
export const FE_TREE_INIT = `%%{init:{'theme':'base','themeVariables':{'background':'#060810','primaryColor':'#0c1a30','primaryTextColor':'#7dd3fc','primaryBorderColor':'#0e3a6e','edgeLabelBackground':'#0c1a30','lineColor':'#334155','secondaryColor':'#0f172a','clusterBkg':'#060c18','clusterBorder':'#1e3a5f','fontFamily':'JetBrains Mono','fontSize':'14'},'flowchart':{'nodeSpacing':40,'rankSpacing':24,'padding':8}}}%%`

export const CLASS_DEFS = [
  `  classDef ssr fill:#0d1a0d,stroke:#16a34a,color:#86efac`,
  // K3(BE-DIAGRAM-STANDARD v1.2): BE Controller는 FE ssr(초록, SSR 라우트)과 색 재사용 시
  // Fullstack pair-analysis 결합 다이어그램에서 두 의미가 뒤섞일 위험이 있어 전용 색으로 분리.
  `  classDef ctrl fill:#042f2e,stroke:#0d9488,color:#5eead4`,
  `  classDef csr fill:#2d1200,stroke:#c2410c,color:#fb923c`,
  `  classDef ssg fill:#1a0d1a,stroke:#7c3aed,color:#c4b5fd`,
  `  classDef isr fill:#1a1a0d,stroke:#ca8a04,color:#fde047`,
  `  classDef ppr fill:#0d1a2d,stroke:#2563eb,color:#93c5fd`,
  `  classDef unk fill:#1a1a1a,stroke:#6b7280,color:#9ca3af`,
  `  classDef pkg fill:#0c1018,stroke:#475569,color:#cbd5e1`,
  // C3(BE-DIAGRAM-STANDARD v1.2): 외부 시스템(@FeignClient 등) — cross-pkg muted(점선)와 달리
  // 실제 존재가 확인된 노드라 실선으로 구분.
  `  classDef ext fill:#2d1a06,stroke:#d97706,color:#fcd34d`,
  `  classDef muted fill:#0a0d14,stroke:#374151,color:#64748b,stroke-dasharray: 3 3`,
  `  classDef hdr fill:#06080f,stroke:#1e3a5f,color:#7dd3fc`,
].join('\n')

export const DB_DIAGRAM_INIT = `%%{init:{'theme':'base','themeVariables':{'background':'#060810','primaryColor':'#2a4055','primaryTextColor':'#f8fafc','primaryBorderColor':'#1e4060','lineColor':'#f59e0b','secondaryColor':'#0f172a','tertiaryColor':'#1a0a20','attributeBackgroundColorEven':'#ffffff','attributeBackgroundColorOdd':'#f1f5f9','textColor':'#1e293b','nodeBorder':'#1e4060','clusterBkg':'#0a0e1a','fontFamily':'JetBrains Mono','fontSize':'14'}}}%%`

// T4 시퀀스 탭 전용 init — mermaid sequenceDiagram 기본값은 (a) themeVariables가 flowchart/erDiagram과
// 이름 체계가 달라(actorBkg/signalColor/labelBoxBkgColor 등) 다른 탭의 *_INIT을 재사용할 수 없고,
// (b) `mirrorActors:true`가 기본이라 참가자 박스가 위/아래로 중복 배치돼 가운데 화살표·라벨이
// 좁은 띠에 몰리고, init을 아예 안 주면 mermaid 기본 회색 화살표/라벨이 이 앱의 어두운 배경에
// 묻힌다(사용자 실측 지적). `mirrorActors:false`로 하단 중복 제거 + `showSequenceNumbers:true`로
// 체인이 길어질 때 순서 추적 가능하게 함(candidate B, 사용자 선택).
export const SEQUENCE_INIT = `%%{init:{'theme':'base','themeVariables':{'background':'#060810','actorBkg':'#0c1a30','actorTextColor':'#e2e8f0','actorBorder':'#1e3a5f','actorLineColor':'#334155','signalColor':'#7dd3fc','signalTextColor':'#e2e8f0','labelBoxBkgColor':'#0c1a30','labelBoxBorderColor':'#1e3a5f','labelTextColor':'#e2e8f0','loopTextColor':'#94a3b8','noteBkgColor':'#1a1a0d','noteBorderColor':'#ca8a04','noteTextColor':'#fde047','activationBkgColor':'#0d9488','activationBorderColor':'#5eead4','sequenceNumberColor':'#060810','fontFamily':'JetBrains Mono','fontSize':'14'},'sequence':{'mirrorActors':false,'showSequenceNumbers':true}}}%%`
