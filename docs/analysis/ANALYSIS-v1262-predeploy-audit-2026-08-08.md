# v1.2.62 배포 전 감사 보고서

> 분석일: 2026-08-08
> 프로젝트: codebase-viz — v1.2.62 후보 (Wave A 딥링크·hover·검색 결함 수정)
> 분석 관점: 미커밋 변경 24파일 중심 — nodeMap 사이드채널/마커 아키텍처, viewer.html 검색·하이라이트, 캐시 무효화 정책
> 수행 방식: 병렬 에이전트 4종(구조·아키텍처·품질·보안)을 기동했으나 **전부 세션 한도로 조기 종료** → 인라인 실측 감사로 대체. 아래 판정은 전부 실행 결과 기반이며, 미검증 항목은 명시했다.

---

## 1. 변경 개요

### 배경 — v1.2.61이 배포된 상태에서 무엇이 죽어 있었나

| 증상(사용자 보고) | 근본 원인 | 실측 |
|---|---|---|
| 노드 클릭 딥링크 무반응 | `buildNodeMap` 키가 bare `sanitizeId(node.id)`인데 빌더는 합성 id(`T1_*`·`pkg_*`)와 접두사 id(`leaf_`/`file_`/`pageleaf_`/`di_x__`)를 emit | Tab1 히트 0/5, Tab2 1/5 |
| 검색 오탐 | `fuzzyScore`가 임의 subsequence 매칭 | `user` → `/dashboard/settings/profile-editor` 매치 |
| 매칭/dim 대비 부족 | 미매칭 dim만 있고 매칭 쪽 긍정 표시 없음 + 위 오탐으로 dim 자체가 무력화 | — |
| (2차) 구버전 캐시 재생 | `ANALYZER_VERSION`이 v1.2.46에 정지 → nodeMap 없는 캐시가 "유효" 판정 | — |

### 변경 파일 (24개, 미커밋)

| 레이어 | 파일 | 성격 |
|---|---|---|
| types | `analyzer-version.ts` | 1.2.46 → 1.2.62 |
| renderer | `helpers/node-map.ts` | 키 정합화 · 최장 suffix 역해석 · 마커 채널 |
| renderer | `mermaid-renderer.ts` | 3개 반환 경로 전부 strip |
| renderer | `fe/tab1-tree.ts`, `be/leaf.ts`, `be/pkg-tree.ts`, `be/tab2.ts` | 대표 라우트 마커 emit |
| renderer | `_shared/wrap-fallback.ts` | 청킹 임계를 strip 후 길이로 판정 |
| extension | `media/viewer.html` | 3-tier 검색 · 하이라이트 · cluster dim · 매치 카운트 |
| extension | `i18n/dict.ts` | `search.matchCount`/`noMatch` (4 locale) |
| extension | `diagram-cache.ts` | nodeMap shape 가드 |
| 테스트 | 유닛 6파일 + Playwright 2파일(1 신규) | 회귀 가드 |

---

## 2. 아키텍처 평가

### 2-1. `%% nodemap:` 주석 마커 채널

빌더가 합성 노드 id ↔ IR 노드 매핑을 다이어그램 텍스트 **주석에 in-band로** 실어 보내고, `buildDiagrams`가 nodeMap 추출 후 strip해서 반환한다.

**채택 근거**: 대안(빌더 시그니처를 바꿔 매핑을 out-param 반환)은 청킹 헬퍼 다수를 관통해야 해서 침습적. `erd/db-diagram.ts:51`의 `%% table:` 선례가 이미 있어 신규 패턴이 아니다. IR 확장 0, 빌더 시그니처 변경 0.

**평가**

| 항목 | 판정 | 근거 |
|---|---|---|
| IR 불변 유지 | ✅ | `IRGraph` 무변경, `DiagramSet` 산출물만 확장 |
| 청킹 통과 | ✅ | 마커는 청크 내부에 남고 strip은 마지막에 1회 |
| 출력 오염 | ✅ | 3개 반환 경로(`buildDiagrams`/`renderMermaid`/`buildCombinedDiagram`) 전부 strip · 실측 잔존 0 |
| 소비자 누락 | ✅ | grep 전수 — 빌더 출력 소비자는 위 3개뿐. LLM·CLI 패키지에 다이어그램 텍스트 소비 경로 없음 |
| **in-band 채널 위험** | 🔴→✅ | **감사 중 실제 주입 결함 발견·수정** (§3-1) |

**남는 구조적 약점(수용)**: in-band 채널은 "텍스트가 곧 프로토콜"이라 항상 이스케이프 규율에 의존한다. §3-1 수정으로 값 자체를 percent-encoding에 가둬 이스케이프 누락 **가능성을 제거**했지만, 새 빌더가 `nodeMapMarker`를 우회해 직접 `%% nodemap:` 문자열을 만들면 다시 열린다. 현재는 그런 호출부가 없다(전부 `nodeMapMarker` 경유).

### 2-2. `_` 경계 최장 suffix 역해석

`resolveBySuffix`(node-map.ts)는 접두사 목록을 하드코딩하지 않고, `_` 경계에서 **가장 긴** suffix가 sid와 일치하는지로 역해석한다.

- **강점**: 새 빌더가 임의 접두사를 붙여도 자동 대응. 하드코딩 목록은 조용히 다시 깨지는 구조였다.
- **오매칭 방어**: 최장 우선이라 `file_component_app_page_tsx_page`에서 짧은 `page`가 먼저 걸리는 사고를 막는다(전용 테스트 있음).
- **잔여 위험**: 서로 다른 두 노드의 sid가 suffix 관계일 때 이론적 모호성. 실측 4개 fixture에서 **유령키 0건** — 후보 토큰이 IR 노드로 해석돼야만 키가 되므로 라벨 단어는 애초에 통과하지 못한다.

### 2-3. "대표 라우트" 근사

폴더/패키지 집계 박스는 대응 소스 파일이 1:1로 없어, 하위 라우트 중 하나(최단 경로, tie는 id 사전순)를 대표로 골라 딥링크한다.

- **Evidence-First 충돌 여부**: 충돌하지 않는다. nodeMap 엔트리는 실재 IR 노드의 `provenance.file/line`과 `confidence`를 그대로 싣는다(전용 테스트). 없는 노드를 만들어내지 않으며, 마커가 가리키는 id가 그래프에 없으면 **조용히 무시**한다(무반응 > 잘못된 점프).
- **사용자 기대와의 간극**: 폴더 박스를 클릭하면 "그 폴더 전체"가 아니라 대표 파일 1개가 열린다. hover tooltip이 어느 파일인지 먼저 보여주므로 오인 소지는 낮다. 다만 **BE Tab1과 Tab2가 같은 패키지 박스에 대해 다른 컨트롤러를 가리킬 수 있다** — Tab2 트리는 라우트가 아닌 컨트롤러를 매달아(`routes: []`) 파일 경로 기준으로 폴백하기 때문. 주석에 명시함.

### 2-4. 모듈 의존성

신규 의존: `_shared/wrap-fallback.ts` → `helpers/node-map.ts`, `be/pkg-tree.ts` → `helpers/node-map.ts`, `fe/tab1-tree.ts`·`be/leaf.ts` → `helpers/node-map.ts`.
`helpers/node-map.ts`는 `./ids.js` + `@codebase-viz/types`만 의존 → **순환 없음**. helpers가 최하위 레이어라 레이어 역전도 없다. `tsc --build` PASS로 확인.

---

## 3. 코드 품질 · 보안

### 3-1. 🔴 [수정 완료] 마커를 통한 mermaid 구문 주입

**심각도: HIGH** — 이번 변경이 새로 만든 공격면. 감사 중 발견하여 수정했다.

`nodeMapMarker`가 IR 노드 id를 이스케이프 없이 삽입했다. IR 노드 id는 분석 대상 리포의 **파일 경로 + 라우트 경로**로 조립되는 신뢰 불가 값이다.

**공격 시나리오(실측 재현)**: 악성 리포가 파일명에 개행을 포함시킨다.

```
app/evil\nEVIL_NODE["pwned"]\n/page.tsx
```

마커가 3개 물리 라인으로 쪼개지고, `stripNodeMapMarkers`(`.`는 개행 미매치)는 첫 줄만 제거 → 나머지가 **생 mermaid 소스로 잔존**:

```
"  %% nodemap:T1_evil=route:app/evil"     ← strip됨
"EVIL_NODE[\"pwned\"]"                     ← 남음 = 노드 선언으로 렌더
"/page.tsx:page"                           ← 남음
```

**수정**: 마커 값을 `encodeURIComponent`로 인코딩해 `[A-Za-z0-9%._~!*'()-]` 안에 가둔다. 마커가 **구조적으로** 단일 라인·단일 토큰이 되어 이스케이프 누락 가능성 자체가 사라진다. 파싱 측은 `decodeURIComponent`(실패 시 조용히 무시). 정규식도 `(.+)$` → `(\S+)[ \t]*$`로 조임.

**RED→GREEN 확인**: 회귀 테스트 3건을 먼저 작성해 2건 FAIL 확인 후 수정 → 전부 GREEN.

**수정 후 실측 (5종 공격 벡터 전부 차단)**

| 벡터 | 주입 라인 | 마커 잔존 | 위조 키 |
|---|---|---|---|
| 개행 삽입 | 0 | ✗ | ✗ |
| CR 삽입 | 0 | ✗ | ✗ |
| 마커 위조(`%% nodemap:VICTIM=…`) | 0 | ✗ | ✗ |
| `click … "javascript:…"` 주입 | 0 | ✗ | ✗ |
| `classDef` 주입 | 0 | ✗ | ✗ |

> 이 결함은 v1.2.60에서 security-auditor가 ship 직전 잡아낸 mermaid 라벨 이스케이프 누락과 **동일 클래스**다. 새 채널을 만들면 기존 이스케이프 자산이 자동으로 적용되지 않는다는 것이 반복 확인됐다.

### 3-2. 정규식 안전성 — 이상 없음

| 검사 | 결과 |
|---|---|
| 모듈 레벨 `/g` 정규식 재진입(`MARKER_RE.lastIndex`) | ✅ 1회/2회/멀티텍스트 호출 결과 동일 |
| `stripNodeMapMarkers` ReDoS | ✅ 단일 100KB 라인 0ms · 5,000줄 1ms (선형) |
| `fuzzyScore`/`wordInitials`/`substringScore` ReDoS | ✅ 200KB 텍스트 0~9ms |
| `clusterMembers` 소스 파싱 정규식 | ✅ greedy `.+` 없음, 문자클래스 한정 |

### 3-3. 웹뷰 XSS — 이상 없음

- 툴팁 `innerHTML` 삽입 경로의 모든 동적 값이 `esc()` 경유 (미이스케이프 삽입 0건).
- `handleOpenNode`는 웹뷰에서 **sanitized id 문자열만** 받고, own-property 가드 + `resolveWithinRoot`로 root 이탈을 차단한다. `__proto__`/`constructor` 회귀 테스트 존재(`webview.test.ts:169`).
- nodeMap 키 종류가 늘었지만(`pkg_`/`T1_`/`leaf_`) 조회 방식은 불변 — 공격면 확대 없음.
- CSP nonce 정책·postMessage 화이트리스트에 변경 없음.

### 3-4. 성능

| 항목 | 실측 | 판정 |
|---|---|---|
| `shouldChunk`가 매 호출 strip 수행 | 1,356KB 텍스트 0.2ms/call | ✅ 무시 가능 |
| 마커로 인한 텍스트 증가 | 최대 Δ7,900자 = 청킹 임계(5,000,000)의 **0.158%** | ✅ 게이트 반전 없음(4 fixture 전부) |
| `collectSubtreeRoutes`/`collectSubtreeFiles` 재귀 | 패키지 노드마다 서브트리 재순회 = O(depth × files) | 🟡 mini-spring-large(50노드)에서 체감 없음. 수천 노드 규모는 미검증 |

### 3-5. 잔여 기술 부채

| # | 항목 | 심각도 | 위치 | 설명 |
|---|---|---|---|---|
| 1 | BE Tab1/Tab2 대표 노드 불일치 | 🟡 | `be/pkg-tree.ts` `representativeFileNodeId` | 같은 패키지 박스가 탭마다 다른 컨트롤러로 점프 가능. 같은 패키지 내 인접 파일이라 영향은 작음. 주석에 명시함 |
| 2 | gbc 바인딩이 `describe > it` 전체 문자열 | 🟢 | `.gbc/spec.md` | describe 이름을 바꾸면 해당 케이스가 조용히 unverifiable로 강등 |
| 3 | 인프라 장식 박스 딥링크 불가 | 🟢 | `fe/tab1.ts:169,170,211` | `PG_SB`·`SB_AUTH`·`API_GATEWAY`는 `metadata.hasSupabase` 같은 불리언으로 하드코딩 emit. **대응 IR 노드·파일·라인이 없어 고칠 대상이 아님** |
| 4 | 대규모 그래프 재귀 비용 미검증 | 🟢 | `be/pkg-tree.ts` | §3-4 |
| 5 | 매칭 하이라이트가 stroke 색을 못 바꿈 | 🟢 | `viewer.html` | mermaid가 classDef를 inline style로 박아 stylesheet가 못 이김. 색은 렌더링 모드 정보라 덮지 않는 편이 맞다고 판단 → 굵기 + glow로 대체(스크린샷 실측 확인) |

---

## 4. 검증 현황

| 게이트 | 결과 |
|---|---|
| `verify.sh` (tsc + oxlint + vitest + contributes ID) | ✅ ALL PASS |
| Playwright E2E | ✅ 42 passed |
| `gbc verify` (spec ↔ 테스트 대조) | ✅ 22/22 verified |
| 마커 주입 5종 벡터 | ✅ 전부 차단 |

### 딥링크 커버리지 실측 (클릭 대상 `.node` 기준)

| fixture | Tab1 | Tab2 |
|---|---|---|
| mini-spring-partner-mock | 19/19 (수정 전 7/19) | 67/67 (55/67) |
| mini-spring-large | 50/50 | 50/50 |
| mini-react-router-wina | 21/21 | 45/45 |
| mini-react-partner-mock | 3/4 | 19/19 (7/19) |
| mini-next-app | 3/5 | 5/5 |

미매핑 잔여는 전부 부채 #3(인프라 장식 박스)이다.

### 검증 사각지대 — 이번 사이클의 핵심 교훈

v1.2.61은 Playwright 4스펙 + vitest 전부 GREEN 상태로 배포됐는데 기능이 **100% 죽어 있었다**. 스펙이 태운 것은 손으로 쓴 `graph TD\n <sid>["..."]` 하니스뿐이라, 실제 빌더가 만드는 id 형태를 한 번도 지나지 않았기 때문이다.

이번에 추가한 두 스펙이 그 계층을 메운다:
- `packages/renderer/src/nodemap-coverage.test.ts` — 실제 `buildDiagrams` 출력의 선언 id ↔ nodeMap 대조
- `tests/playwright/node-deeplink-real-output.spec.mjs` — IR 그래프 → 빌더 → 렌더 → 클릭 전 구간

> **하니스 스펙은 계약(정규식·id 형식) 고정용, 커버리지 스펙은 결함 탐지용이다. 전자가 후자를 대신하지 못한다.**

---

## 5. 스택 최신성

| 기술 | 현재 | 최신 | 상태 |
|---|---|---|---|
| Node engines | >=22 | 22 LTS | ✅ |
| TypeScript | ^5.5 | 7.0.2 | 🟡 메이저 2단계 뒤. 5.x는 여전히 지원되나 마이그레이션 검토 대상(별도 작업단위) |
| vitest | ^4.0 | 4.1.10 | ✅ |
| ts-morph | ^28.0 | 28.0.0 | ✅ 최신 |
| oxlint | ^1.74 | 1.77.0 | ✅ 범위 내 |
| esbuild | ^0.24 | 0.28.1 | 🟡 마이너 4단계 뒤 |
| @vscode/vsce | ^3.0 | 3.9.2 | ✅ 범위 내 |
| mermaid (번들) | 11.16.0 | 11.16.1 | ✅ 패치 1단계 |

> `viewer.html:7`의 CDN `<script>` 태그는 브라우저 하니스용 플레이스홀더다 — 확장은 `webview.ts:193,228`에서 로컬 `media/mermaid.min.js`의 webview URI로 치환한다(CSP 준수).

---

## 6. 개선 로드맵

### 즉시 (배포 전)
- [x] 마커 주입 차단 (§3-1) — **완료**
- [ ] README + `packages/extension/package.json` version 1.2.61→1.2.62 + CHANGELOG 선갱신 (프로젝트 절대원칙)

### 단기 (1~2주)
- [ ] 부채 #1 — BE Tab2 대표 선정을 라우트 우선으로 통일하거나, 불일치를 명시적 설계로 문서화
- [ ] 마커 emit을 `nodeMapMarker` 경유로 강제하는 린트 규칙 또는 테스트(직접 문자열 조립 금지)
- [ ] esbuild·mermaid 패치 업데이트 + 회귀 렌더 확인

### 중장기 (1개월+)
- [ ] 부채 #4 — 수천 노드 규모 BE 그래프로 재귀 비용 실측, 필요 시 서브트리 라우트 메모이제이션
- [ ] TypeScript 7 마이그레이션 타당성 검토 (별도 작업단위)
- [ ] in-band 마커 채널 → 빌더 구조적 반환값으로 전환 검토 (청킹 헬퍼 리팩터링과 묶어서)

---

## 7. 배포 판정

**조건부 GO.** §3-1의 HIGH 결함은 감사 중 발견·수정되어 5종 벡터 전부 차단을 실측 확인했고, 전 게이트가 PASS다. 남은 부채는 전부 🟡/🟢이며 배포 차단 사유가 아니다.

배포 전 남은 필수 작업은 **README + version + CHANGELOG 선갱신** 하나다(프로젝트 절대원칙 — `feedback_release_readme_marketplace_first`).

### 배포 후 사용자 확인 시 주의
- 설치된 v1.2.61 VSIX에서는 변경분이 보이지 않는다 — 재패키징·재설치 또는 F5 개발 호스트 필요.
- `ANALYZER_VERSION` 1.2.62 범프로 기존 캐시가 전부 무효화되어 **첫 실행은 전체 재분석**이다(느린 것이지 멈춘 것이 아님).

---

## 8. 감사 방법 및 한계

- 계획된 병렬 에이전트 4종(구조 탐색·아키텍처·코드 품질·보안)은 **전부 세션 한도로 조기 종료**되어, 인라인 실측 감사로 대체했다.
- 따라서 이 보고서는 **실행 가능한 검증에 편중**되어 있다: 주입 벡터 재현, ReDoS 타이밍, 커버리지 계측, 정규식 상태 검사, 의존성 조회.
- **덜 다뤄진 영역**(다음 감사 대상): 변경 범위 밖 기존 코드의 전면 품질 리뷰, 대규모 그래프 부하 테스트, 웹뷰 접근성(a11y), i18n 4개 로케일 실제 렌더 확인.

---

> 이 보고서는 Claude Code `/analyze` 스킬로 생성되었습니다.
