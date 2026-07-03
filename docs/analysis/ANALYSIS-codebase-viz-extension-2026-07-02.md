# codebase-viz VS Code 익스텐션 코드레벨 분석 보고서

> 분석일: 2026-07-02
> 프로젝트: codebase-viz (VS Code 익스텐션 codebase-arch-viz v1.2.57 + CLI/코어 모노레포)
> 분석 관점: 취약점 / 잠재오류 / 성능개선 / 보완사항 일체 탐색 — 다음 버전 마이그레이션 계획 수립 목적
> 분석 방법: 에이전트 3종 병렬 코드 탐색(구조·아키텍처·품질) + 외부 리서치 1종 + 핵심 발견 직접 교차검증

---

## 1. 프로젝트 개요

### 목적 및 핵심 가치
멀티스택 코드베이스(13개 프레임워크 어댑터)를 정적 분석해 3축 아키텍처 다이어그램(라우트 계층·컴포넌트 트리·DB 스키마 ERD)을 Mermaid로 생성하는 CLI + VS Code 익스텐션. FE↔BE cross-project 분석 지원. 핵심 차별점은 **Evidence-First**(모든 노드/엣지에 provenance+confidence, `inferred`는 `inferenceChain` 타입 강제) — LLM-only 경쟁 도구(Swark 등)의 환각·비결정성 대비 우위.

### 기술 스택
| 분류 | 기술 | 버전 | 비고 |
|---|---|---|---|
| 런타임 | Node.js | 20+ | engines 기준. **Node 20 LTS는 2026-04 EOL 경과** |
| 언어 | TypeScript | ^5.5 | strict + exactOptionalPropertyTypes + noUncheckedIndexedAccess, NodeNext |
| AST 분석 | ts-morph | ^23 | 최신 v28. TS7(Go) Compiler API 호환 미해결(dsherret/ts-morph#1621) |
| 다국어 파싱 | web-tree-sitter | ^0.20.8 | Java/Python WASM |
| LLM | ai(Vercel AI SDK) ^6 + @ai-sdk/* ^3 | | Anthropic/Google/OpenAI, zod ^4 검증 |
| 렌더 | mermaid | @11 (로컬 번들 media/mermaid.min.js) | 최신 v11.13+. viewer.html의 CDN 참조는 주입 시 로컬로 치환 |
| 테스트 | vitest ^2 / playwright ^1.60 | | vitest 최신 메이저는 4.x (Node 22.12+ 요구) |
| 빌드/배포 | esbuild ^0.24 / vsce ^3 / ovsx ^0.9 | | cjs 번들, node20 타겟 |

### 현재 완성도
- 어댑터 13종(FE 8 + BE 5) + DB 파서 5종(prisma/drizzle/typeorm/flyway/supabase) 완비, fixture 38종.
- 테스트 817+ PASS, verify.sh(tsc --build + vitest) 게이트 운영. FE/BE 다이어그램 표준 문서(단일진실) 수립.
- v1.2.57 배포 완료(VS Code Marketplace + Open VSX). 성숙기 제품.

---

## 2. 아키텍처 분석

### 구조 개요
```
types (의존 0) ← llm ← core ← ┐
       ↖ renderer (types만)   ├─ cli / extension (최종 소비자)
```
- **types**: IR 타입·팩토리·타입가드. Evidence-First가 discriminated union으로 컴파일 타임 강제됨.
- **core**: IAdapter 13종(Strategy) + AdapterRegistry + `_shared/` 공유 유틸 + `pipeline.ts`(buildIRGraph — CLI/extension 공통 오케스트레이션).
- **renderer**: IRGraph → Mermaid 문자열 순수 변환 레이어. **core에 의존하지 않음**(핵심 설계 강점).
- **extension**: activate/analyzer/webview(CodebaseVizPanel)/sidebar/panel + viewer.html(1038줄) + i18n 4개 언어.

### 데이터 흐름
`detectStack → adapter.analyze → createIRGraph → [LLM: collectFiles → analyzeWithLLM → convertToIR → verifyNodes → corroborateBackends → mergeGraphs] → buildDiagrams → webview HTML 주입(window.__CODESIGHT_* 전역) → mermaid.render`

### 평가
| 항목 | 평가 | 근거 |
|---|---|---|
| 레이어 분리 | 높음 | renderer↛core 단방향, pipeline.ts 공통화로 CLI/extension 중복 0 |
| 패턴 일관성 | 높음 | Strategy/Factory/Registry/Discriminated Union 일관 적용, 컨벤션 위반 0건(전수 확인) |
| 확장성 | 높음 | 새 스택 = IAdapter 구현 1개 추가 |
| 테스트 가능성 | 보통 | core/renderer는 우수(800+), **extension 레이어는 테스트 2파일뿐** |

### 아키텍처 약점
1. **캐시 이중 구조 충돌**: `extension.ts::writeCache`(DiagramSet)와 `analyzer.ts::saveCachedGraph`(IRGraph)가 **동일 파일 `.codebase-viz/cache.json`에 서로 다른 JSON 구조로 접근** — 암묵적 덮어쓰기 의존, 잠재오류원.
2. `mermaid-renderer.ts`(472줄)에 FE Tab1 로직(FW_CONFIGS 107줄 + buildRenderingDiagram 130줄)이 미분리 잔존 — v1.2.47 모듈 분리의 마지막 잔여물.
3. `llmOptions.provider` 기본값('anthropic')이 client.ts와 extension.ts 두 곳에서 중복 처리.
4. `llmRecommended` 가드가 pipeline.ts와 analyzer.ts 양쪽에 중복 존재.

---

## 3. 코드 품질

### 강점
- CLAUDE.md 컨벤션 전수 준수: `.js` 확장자 import·`inferenceChain` 필수·makeNodeId 결정론 — 위반 0건.
- `child_process`/shell exec 사용 없음(명령 인젝션 표면 0).
- SecretStorage 기반 API 키 관리, 청킹·content-visibility 등 대형 레포 렌더 성능 장치 기수립.

### 취약점 및 기술 부채 (심각도순)

| # | 항목 | 심각도 | 위치 | 설명 |
|---|---|---|---|---|
| SEC-1 | **XSS: DB 사이드바 innerHTML 미이스케이프** | 🔴 | viewer.html:866-882 | 파싱된 테이블명/컬럼명/FK명/라우트명을 이스케이프 없이 innerHTML 조립. 분석 대상 레포의 악성 식별자(`@Entity("<script>…")`)가 실행 가능. panelProvider.ts:151에 `esc()`가 이미 있으나 이 경로만 누락 |
| SEC-2 | XSS: buildErrorHtml 미이스케이프 | 🔴 | webview.ts:205 | `<pre>${message}</pre>` — LLM API 에러 body 등 외부 유래 문자열 직접 삽입 |
| SEC-3 | script 브레이크아웃: JSON.stringify 인라인 주입 | 🔴 | webview.ts:172-178, 237 | `</script>` 미이스케이프. projectName(디렉토리명)·다이어그램 문자열이 `<script>` 블록을 탈출 가능. `<` 치환 필요 |
| SEC-4 | mermaid `securityLevel:'loose'` | 🔴 | viewer.html:288, webview.ts:239 | 노드 레이블 HTML 해석 허용 — 파싱 데이터가 레이블이므로 XSS 증폭. `htmlLabels:false`와 조합돼 있으나 'antiscript'/'strict' 전환 검토 필요 |
| SEC-7 | **CSP 취약: `script-src 'unsafe-inline' 'unsafe-eval'`** | 🔴 | webview.ts:171 | nonce 없음. SEC-1~4가 실제 실행으로 이어지는 것을 CSP가 막지 못하는 구조(직접 검증 확인). VS Code 권장은 nonce 기반 script-src |
| SEC-5 | XSS: buildFallbackHtml projectName | 🟡 | webview.ts:225 | fallback 경로 한정 |
| SEC-6 | postMessage 값 미검증 + openExternal 프로토콜 미제한 | 🟡 | sidebarProvider.ts:67-88 | `msg.value` 타입/화이트리스트 미검사, `javascript:` URI 통과 가능. XSS 침해 시 2차 경로 |
| PERF-1 | extension host 동기 fs I/O | 🟡 | extension.ts:113-143 | readCache/writeCache가 sync API — UI 스레드 블로킹(analyzer.ts는 fs/promises 정상 사용) |
| ERR-1 | LLM 에러 무구분 재시도 + 첫 오류 소실 | 🟡 | llm/client.ts:143-147 | 401/404/429도 재시도, 원인 진단 지연 |
| ARCH-1 | cache.json 이중 구조 공유 | 🟡 | extension.ts ↔ analyzer.ts | §2 약점 1 참조 |
| DEBT-1 | `__CODESIGHT_*` webview 전역 5종 잔존 | 🟡 | webview.ts:173-177 (+viewer.html 참조부) | v1.2.56 브랜드 제거에서 누락(내부 변수라 sed 타겟에서 빠짐) |
| DEBT-2 | `CODESIGHT_API_KEY` env var + 에러 문구 | 🟡 | cli/src/index.ts:37,49 | CLI 잔재. 사용자 노출 문자열 |
| DEBT-3 | `Code<em>Sight</em>` 로고 문자열 | 🟢 | webview.ts:225 | fallback HTML 한정 |
| DEBT-4 | .vsix ~60개 + .gif-tmp PNG 100+장 git 트래킹 | 🟢 | packages/extension/ | 레포 비대. .gitignore 정비 필요 |
| DEBT-5 | ESLint/Prettier 부재 | 🟢 | 루트 | TS strict + verify.sh만이 게이트. oxlint 등 저비용 도입 후보 |
| TEST-1 | extension 레이어 테스트 공백 | 🟡 | webview.ts, sidebarProvider.ts, panelProvider.ts, extension.ts | 테스트 2파일뿐. HTML 빌더는 순수 함수라 즉시 테스트 가능 — SEC 수정과 묶으면 회귀 방지 |

### 보안 종합
개별 XSS(SEC-1~5)는 "분석 대상 레포가 악의적"이라는 전제가 필요하지만, 이 도구의 사용 시나리오가 **타인의 코드베이스를 열어 분석하는 것**이므로 위협 모델상 유효하다. 특히 SEC-7(CSP)이 마지막 방어선을 무력화하고 있어, **CSP nonce 강화 + 이스케이프 일괄 적용 + postMessage 검증**을 한 세트로 처리해야 실효가 있다. 2025-26 마켓플레이스 정책 강화(멀웨어 스캔·시크릿 스캔) 흐름상 보안 위생은 마켓 신뢰도와도 직결.

---

## 4. 기술 트렌드 대비

### 스택 최신성
| 기술 | 현재 | 최신 | 상태 |
|---|---|---|---|
| Node.js | 20 | 22 LTS (24 LTS 진입) | 🔴 20은 2026-04 EOL — 22 전환 적기 |
| TypeScript | 5.5 | 6.0 (7.0-Go RC) | ⚠️ NodeNext+strict라 6.0 부담 낮음. 7.0은 ts-morph 호환 관망 |
| vitest | 2.x | 4.1.x | ⚠️ 4는 Node 22.12+ 요구 — Node 전환과 동반 |
| ts-morph | 23 | 28 | ⚠️ 업데이트 권장. 장기: TS7 시대 Compiler API 재편 리스크 |
| mermaid | 11 (번들 시점 고정) | 11.13+ | ⚠️ per-subgraph direction fix 반영 — **nested LR `~~~` 우회 전제 재실측 가치** |
| esbuild | 0.24 | — | ✅ 유지 |

### 대안 기술 검토
- **ast-grep/tree-sitter 하이브리드**: 타입 정보 불필요한 패턴 추출(라우트/데코레이터 스캔)은 ast-grep로 오프로딩, ts-morph는 심볼 해석 전용 — 2026 베스트 프랙티스. 대형 레포 성능 여지. (이미 Java/Python은 tree-sitter — 아키텍처 정합적 확장)
- **경쟁 구도**: LLM-only(Swark) vs 정적 그래프(dependency-cruiser/skott). codebase-viz의 정적-우선+LLM-보조 포지션은 트렌드 부합 — 유지.

---

## 5. 개선 로드맵

### 즉시 개선 (Quick Win) — 보안 패치 릴리스 후보
- [ ] SEC-1~5 이스케이프 일괄 적용(공유 `esc()` + JSON `<` 치환) + SEC-7 CSP nonce 강화 + SEC-4 securityLevel 상향 검토
- [ ] SEC-6 postMessage 화이트리스트 검증 + openExternal https 제한
- [ ] DEBT-1~3 codesight 잔재 3건 제거(`__CODESIGHT_*`→`__CODEBASE_VIZ_*`, `CODEBASE_VIZ_API_KEY`(구명 fallback), 로고)
- [ ] PERF-1 fs/promises 전환, ERR-1 에러 분류(4xx 즉시 표면화)
- [ ] TEST-1 일부: HTML 빌더 이스케이프 단위 테스트(보안 수정 회귀 게이트)

### 단기 개선 (1~2주)
- [ ] ARCH-1 캐시 파일 분리(`cache-diagrams.json` / `cache-graph.json`) + 마이그레이션 처리
- [ ] Node 22 LTS + vitest 4 동반 업그레이드(engines, esbuild target, CI)
- [ ] mermaid 최신(11.13+) 번들 갱신 + nested subgraph direction fix 재실측 → `~~~` 우회 단순화 여부 판정
- [ ] DEBT-4 .vsix/.gif-tmp git 트래킹 제거, DEBT-5 oxlint 도입 검토
- [ ] mermaid-renderer.ts FE Tab1 로직 `fe/tab1.ts` 분리(모듈 분리 완결)

### 중장기 개선 (1개월+)
- [ ] ts-morph 23→28 업그레이드 + TS 6.0 평가(TS7/tsgo·ts-morph#1621 모니터링)
- [ ] ast-grep 하이브리드 PoC — TS 계열 어댑터의 패턴 추출 오프로딩(대형 레포 성능)
- [ ] extension 레이어 테스트 커버리지 확충(sidebarProvider/panelProvider 메시지 핸들러)
- [ ] v1.3.x BE Adapter Phase 2(기존 로드맵) 합류

---

## 6. 리서치 출처
- TS 6.0/7.0: devblogs.microsoft.com/typescript, visualstudiomagazine.com (TS 7.0 Beta)
- ts-morph/대안: github.com/dsherret/ts-morph/issues/1621, ast-grep.github.io/advanced/tool-comparison.html, github.com/oxc-project/oxc
- Mermaid: github.com/mermaid-js/mermaid/releases (v11.13), issue #6785 (nested direction)
- VS Code 보안: code.visualstudio.com/docs/configure/extensions/extension-runtime-security, MS "Security and Trust in Visual Studio Marketplace", cycode.com/blog/exposing-vscode-secrets
- vitest 4 / Node LTS: vitest.dev/guide/migration.html, vitest.dev/blog/vitest-4
- 도구 트렌드: github.com/swark-io/swark, repowise.dev 비교, skott(dev.to)

---

> 이 보고서는 Claude Code `/analyze` 스킬로 자동 생성되었습니다.
