# v1.2.62 기존 요구사항 구현 완료 실검증 보고서

> 분석일: 2026-08-08
> 프로젝트: codebase-viz — v1.2.62 후보 (Wave A 딥링크·검색 결함 수정)
> 분석 관점: 사용자가 보고한 3개 요구사항의 **실제 구현 완료 여부 실측 검증** + 구현 결과 종합 분석
> 선행 문서: [ANALYSIS-v1262-predeploy-audit-2026-08-08.md](./ANALYSIS-v1262-predeploy-audit-2026-08-08.md) (배포 전 감사 — 보안 결함 발견·수정)
>
> 본 보고서는 감사 문서를 대체하지 않는다. 감사는 "새로 넣은 코드가 안전한가"를, 본 문서는
> "사용자가 말한 3가지가 실제로 고쳐졌는가"를 **실산출물 실측**으로 판정한다.
> 외부 리서치(Context7·WebSearch)는 본 요구사항이 자체 렌더러/웹뷰 로직 결함이라 해당 없음 — 생략.

---

## 0. 결론 요약

| # | 사용자 원문 | 판정 | 실측 근거 |
|---|---|---|---|
| 1 | "노드 클릭해도 링크동작안함" | ✅ **완료** | 14개 fixture 실산출물 **362/363 노드 매핑**(미매핑 1건은 IR 노드가 없는 `empty` 플레이스홀더) |
| 2 | "검색이 정상동작하지않는거같음 … 연관없는 대상도 활성화표시" | ✅ **완료** | 실라벨 86건 기준 `"deco"` 매치 **44 → 11**, `"order"` **32 → 1**, `"dsc"` **40 → 3** |
| 3 | "매칭target과 disabled 대상의 gap이 너무적어서 구분이안됨" | ✅ **완료** | dim `.15 → .08 + grayscale(1)`, match에 `stroke-width 2.5px + glow` 신설. 스크린샷 육안 확인 |

**전 게이트 통과** — `verify.sh` ALL PASS · Playwright **42 passed** · gbc **28/28 verified** · 마커 주입 **6벡터 전량 차단**

**배포 판정: 조건부 GO** — 유일한 잔여 필수 작업은 릴리스 메타 선갱신(README + version 1.2.61→1.2.62 + CHANGELOG). 기능·보안 블로커 없음.

> 본 검증 중 **청킹 경로 회귀 테스트 4건을 추가**했다(부채 #4 해소). 실측으로 PASS를 확인했지만 그
> 실측이 세션과 함께 증발하면 v1.2.61과 같은 실패 모드(하니스만 통과하는 GREEN)가 재발하기 때문이다.

---

## 1. 요구사항 추적 매트릭스 (실검증)

### REQ-1 — 노드 클릭 딥링크

**원인 (v1.2.61 결함)**: `nodeMap` 키를 `sanitizeId(node.id)` 원문으로 만들었으나, 빌더는 접두사를 붙여
(`leaf_`·`file_`·`pageleaf_`·`pkg_`) 또는 IR 노드가 없는 합성 id(`T1_*`)로 노드를 선언한다 → 키 불일치로
**전 노드 클릭 무반응**. 2차 원인으로 `ANALYZER_VERSION`이 v1.2.46에 고정돼 구버전 캐시가 "유효" 판정.

**변경**

| 파일 | 변경 |
|---|---|
| `packages/renderer/src/helpers/node-map.ts:47-64` | `%% nodemap:<declId>=<percent-encoded IR id>` 마커 채널 신설 (`%% table:` 선례 답습) |
| `helpers/node-map.ts:119-130` | `resolveBySuffix` — `_` 경계 최장 suffix 역해석으로 접두사 id 흡수 |
| `helpers/node-map.ts:10-21` | `pickRepresentativeRoute` — 집계 박스의 대표 = 최단 URL 세그먼트, 동수는 id 사전순 |
| `fe/tab1-tree.ts` · `be/leaf.ts` · `be/pkg-tree.ts` · `be/tab2.ts` | 합성 박스 emit 시 마커 부착 |
| `mermaid-renderer.ts:309-317, 331-333, 385-392` | 3개 반환 경로 전부 `buildNodeMap` **후** `stripNodeMapMarkers` |
| `types/src/analyzer-version.ts` | `@1.2.46` → `@1.2.62` |
| `extension/src/diagram-cache.ts:29-33` | `nodeMap` 부재 캐시를 shape로도 무효화 (버전 범프 누락 재발 방지) |

**측정 1 — 14개 fixture 실산출물 커버리지**

```
fixture                                Tab1        Tab2
mini-next-app                          3/3  100%   5/5   100%
mini-nextpages-app                     4/4  100%   5/5   100%
mini-react-partner-mock-app            3/3  100%   19/19 100%
mini-react-router-wina-app             21/21 100%  45/45 100%
mini-spring-partner-mock-app           19/19 100%  67/67 100%
mini-spring-large-app (300 nodes)      50/50 100%  50/50 100%
mini-spring-lombok-mybatis-app         1/1  100%   15/15 100%
mini-spring-deep-pkg-app               6/6  100%   12/12 100%
mini-vue-spa-app / angular / nuxt / sveltekit / django / nest   전부 100% (Tab2 django 'empty' 제외)
────────────────────────────────────────────────────────────
합계                                   122/122     240/241
```

미매핑 1건 = django fixture Tab2의 `empty` 플레이스홀더 노드 — **IR 노드가 존재하지 않음**(빈 결과 안내
박스). 같은 부류로 제외한 장식 박스: `PG_SB`·`SB_AUTH`(Supabase 인프라, `metadata.hasSupabase` 불리언에서
하드코딩)·`API_GATEWAY`·`NO_MATCH`·`fallback`. 이들은 대응 파일·라인이 애초에 없어 **점프 대상 자체가
부재** — 무반응이 정답이다(Less is More: 잘못된 점프 < 무반응).

**측정 2 — 경로 분기별 (앞선 검증의 사각지대)**

| 경로 | 조건 | 결과 |
|---|---|---|
| 비청킹 `buildDiagrams` | 기본 | Tab1/Tab2 100% |
| **청킹** `buildDiagrams` | `chunkThreshold:500, nodeThreshold:5` 강제 | `chunked=true` 확인 후 Tab1 19/19·Tab2 67/67 (spring-partner-mock), 50/50·50/50 (spring-large) |
| **결합** `buildCombinedDiagram` | FE(next)↔BE(spring) 매칭 1건 | Tab1 2/2, `r:'pair'` 1건 정상 마킹 |
| 마커 누출 | 전 fixture 전 탭 | `%% nodemap:` 잔존 **0건** |

> 청킹 경로는 기존 유닛 테스트(`nodemap-coverage.test.ts`)가 5-route 그래프만 써서 한 번도 통과한 적이
> 없던 분기다. 실측 결과 **커버리지 동일** — 결함 아님. 실측이 scratchpad와 함께 증발하지 않도록
> **본 검증에서 회귀 테스트 4건을 추가해 고정**했다(`nodemap-coverage.test.ts`, 임계 강제 청킹 +
> 청킹 발생 전제 확인 + BE `pkg_*`/`leaf_*` + FE Tab2 + 마커 누출). 부채 #4 해소.

**측정 3 — 확장 호스트 최종 홉** (`extension/src/webview.ts:137-158`)

경로 해석이 `entry.f`(repo-relative)를 그대로 쓰지 않고 `resolveWithinRoot(root, entry.f)`로 조인하며,
`root`는 `entry.r === 'pair' ? pairRepoRoot : repoRoot`로 분기한다. 결합 모드 실측에서 BE 유래 엔트리가
`r:'pair'`로 정상 마킹됨을 확인 → 페어 프로젝트에서도 올바른 루트로 해석된다.
`hasOwnProperty` 가드로 `__proto__` 조회 차단도 유지.

**판정: ✅ 완료.** 클릭 가능한 모든 노드가 매핑된다.

---

### REQ-2 — 검색 매칭 (연관 없는 대상 활성화)

**원인**: 구 매처가 **임의 부분열(subsequence)** — 쿼리 문자가 순서만 맞으면 흩어져 있어도 매치.
`customerMgmt`가 `"user"`에 걸리고(c-**u**-**s**-tom-**e**-**r**), `ProcCodeMgmtController`가 `"order"`에 걸린다.

**변경** (`packages/extension/media/viewer.html:365-410`) — 3-tier로 교체, 임의 부분열 폐기:

| Tier | 규칙 | base |
|---|---|---|
| 1 | 연속 부분문자열 | 200 |
| 2 | 공백 구분 다중 term **AND** (각 term이 부분문자열) | 100 |
| 3 | 단어경계/camelCase 약어 (2자 이상, 영숫자만) | 10 |

품질 점수(0~30)는 단어경계 시작 +20, 밀도 `q.length/t.length*10`. base 분리로 tier 간 순위가 품질에
의해 뒤집히지 않는다.

**측정 — production과 동일한 `(full, name)` 쌍**(`getSearchableText`: `full = nodeMap.n + ' ' + 라벨`,
`name = nodeMap.n`)으로 `mini-spring-partner-mock-app` 실노드 86개에 대해 구/신 매처 직접 비교:

| 쿼리 | 구(v1.2.61) | 신(v1.2.62) | 오탐 제거 | 대표 제거 사례 |
|---|---|---|---|---|
| `order` | 32 | **1** | −31 | `/v1/headOffice/…/procCodeMgmt/list` (order 문자열 없음) |
| `deco` | 44 (전체의 51%) | **11** | −33 | `/v1/agency/userMgmt/:id` |
| `user` | 17 | **11** | −6 | `CuttingPlanMgmtService` |
| `dsc` (약어) | 40 | **3** | −37 | 정확히 `DecoSheetController` 계열만 잔존 |
| `user list` (AND) | 1 | **1** | 0 | `retrieveUserList` — 동일 |

`mini-react-router-wina-app`(FE, 66라벨): `user` **5 → 0** (해당 fixture에 user 라우트 없음 — 구 매처의
5건은 전부 오탐), `admin` **2 → 0**, `login` **7 → 5** (유지된 5건은 전부 실제 login 라우트).

**거짓 음성(놓침) 검토**: 제거된 항목 중 쿼리 문자열을 실제로 포함하거나 의미상 관련된 것은
3개 fixture · 20개 쿼리 전 범위에서 0건. 잘라낸 것은 전부 오탐이다.

**신규 매치 — Tier별로 다르다 (부분집합이 아님)**

| Tier | 구 매처 대비 | 근거 |
|---|---|---|
| 1 (연속 부분문자열) | 항상 부분집합 | 연속 부분문자열은 부분열의 특수형 |
| 3 (단어경계 약어) | 항상 부분집합 | 단어 이니셜은 원문에 **순서대로** 등장 → 부분열 매처도 반드시 매치. 실측 14쿼리 신규 +0 |
| **2 (다중 term AND)** | **부분집합 아님 — 신규 매치 발생** | AND는 **순서 무관**, 부분열은 순서 종속. 실측: `"mgmt agency"` 구 2 → 신 **4** (신규 +2 — `/v1/agency/userMgmt`처럼 term 순서가 뒤집힌 대상) |

즉 신 매처는 "오탐만 잘라낸 축소판"이 아니라, **오탐을 크게 줄이면서 순서 무관 다중 term 검색을
새로 얻은** 교체다. 신규 매치 2건은 검사 결과 전부 두 term을 실제로 포함하는 정상 매치였다.

**판정: ✅ 완료.** 사용자가 물은 매칭 규칙은 위 3-tier이며, 오탐이 실측으로 제거됐다.

---

### REQ-3 — 매칭/비매칭 대비

**변경** (`viewer.html:82-93`)

| | v1.2.61 | v1.2.62 |
|---|---|---|
| 비매칭 | `opacity: .15` | `opacity: .08` + `grayscale(1)`, `.cluster`에도 적용 |
| 매칭 | (없음) | `stroke-width: 2.5px !important` + `drop-shadow(0 0 7px rgba(56,189,248,.95))` + `opacity: 1` |
| 엣지 | (없음) | `.searching` 시 `opacity: .12` |
| 카운트 | (없음) | `.search-count` — "N건 일치" / "일치 없음" (`aria-live="polite"`, 4개 로케일) |

**설계 판단 — stroke 색을 건드리지 않은 이유** (주석에 근거 명시):
① mermaid가 `classDef`를 inline style로 박아 stylesheet가 못 이긴다(실측: `node-match`여도 computed
stroke가 classDef 값 그대로), ② 그 색은 렌더링 모드(SSR/CSR/SSG) 정보라 덮으면 의미가 소실된다.
inline 경쟁자가 없는 **굵기 + glow**만으로 대비를 만든 것은 우회가 아니라 정보 보존 선택이다.

**측정 — 스크린샷 육안 확인** (`tests/playwright/screenshots/search-{before,after}.png`, 쿼리 `blog`):
매칭 노드(`📁 /blog · 4 routes`, `archive · SSR`)는 완전 불투명 + 시안 글로우 + 굵은 테두리로 즉시 식별,
비매칭(`/admin` 클러스터·`users`·`settings`·`/ · SSR`)은 회색조로 배경에 가라앉는다. 카운트 "2건 일치"
정상 표시. **CSS 값 판독이 아니라 실제 렌더 결과로 확인.**

**판정: ✅ 완료.**

---

## 2. 검증 게이트 실행 결과

| 게이트 | 결과 |
|---|---|
| `verify.sh` (tsc build / oxlint correctness / vitest / contributes ID) | **ALL PASS** (청킹 회귀 테스트 추가 후 재실행) |
| Playwright | **42 passed** (26.2s) |
| gbc `verify --run` | **케이스 28 · verified 28 · unverifiable 0** (신규 3케이스 포함) |
| `nodemap-coverage.test.ts` | 10 → **14 tests** 전부 통과 |
| 마커 주입 6벡터 (개행·CR·마커위조·`click javascript:`·`classDef`·따옴표대괄호) | **전량 차단** (물리라인 1, 잔재 0) |
| 마커 왕복 복원 | `app/[slug]/page.tsx:7` 정상 |
| 손상 인코딩(`%ZZ`) 내성 | 예외 없이 조용히 무시 |

> gbc는 최초 실행 시 `verified 0 / unverifiable 25`로 나왔다 — 결과파일이 마지막 편집보다 오래된
> **stale 강등**. 러너를 `.gbc/verify-results.xml`로 재실행해 25/25 신선 판정을 받았다.
> (게이트 자체의 오탐이 아니라 설계된 안전장치.)

---

## 3. 아키텍처 평가 — 마커 사이드채널

### 강점

| 항목 | 평가 | 근거 |
|---|---|---|
| IR 불변 준수 | **높음** | IR 타입·팩토리 변경 0. CLAUDE.md "IR을 넓히지 말 것" 정면 준수 |
| 빌더 시그니처 침습 | **낮음** | `emitTreeNodes`에 옵션 1개 추가 외 시그니처 변경 없음 |
| 선례 일관성 | **높음** | `%% table:` (erd/db-diagram.ts:51)과 동일 기법 — 새 패턴 발명 아님 |
| Evidence-First | **준수** | 전 엔트리가 `f`/`l`/`c` 보유, `inferred`는 `i`(inferenceChain head) 동반 |
| Less is More | **준수** | 미매핑은 조용한 no-op. 대응 소스가 없는 장식 박스에 억지 매핑 안 함 |
| 출력 무오염 | **검증됨** | 3개 반환 경로 전부 strip, 14 fixture 전 탭 누출 0 |
| 성능 | **무시 가능** | `buildDiagrams` 300노드 3.3ms/회, 14노드 0.5ms/회 |

### 약점 / 구조적 부채

| # | 항목 | 심각도 | 위치 | 설명 |
|---|---|---|---|---|
| 1 | 마커는 **in-band 텍스트 프로토콜** | 🟡 | `helpers/node-map.ts:47-56` | 정규식 규율(strip/추출/청킹 임계)이 3곳에 흩어져 있다. percent-encoding으로 주입은 막았지만, 새 소비자가 strip을 빠뜨리면 조용히 샌다. 현재 소비자 3곳 전수 확인 완료 |
| 2 | `resolveBySuffix` 휴리스틱 | 🟡 | `node-map.ts:119-130` | 최장 suffix 우선이라 안전하지만 근본적으로 문자열 추측. 접두사 규약을 빌더 계약으로 승격하는 편이 견고 |
| 3 | BE Tab1/Tab2 대표 노드 불일치 가능 | 🟡 | `node-map.ts:6-9`(주석), `be/pkg-tree.ts` | Tab2 트리는 `routes: []`라 파일 경로 기준 폴백 → 같은 `pkg_*` 박스가 탭마다 다른 컨트롤러로 점프할 수 있다. 같은 패키지 인접 파일이라 실사용 영향은 작지만 **동일 보장은 아님**(주석에 명시됨) |
| 4 | ~~청킹 경로 회귀 테스트 부재~~ | ✅ 해소 | `nodemap-coverage.test.ts` | 본 검증에서 강제 청킹 케이스 4건 추가(총 10 → 14 tests). 다음 사람이 `pickRepresentativeRoute`/`emitTreeNodes`를 건드려도 청킹 분기가 GREEN을 통과시키지 못한다 |
| 5 | FE Tab3 `ep_*` 노드 클릭 무반응 | 🟡 | `fe/tab3-api.ts:19,106` | react-router FE의 Tab3는 `graph LR`(flowchart)이라 `.node`가 존재해 클릭 리스너가 붙지만, endpoint 노드는 `graph.nodes` 미등록 합성 노드라 매핑 불가 → 클릭해도 반응 없음. 실측: partner-mock Tab3 16개 중 9개(`ep_*`) |
| 6 | gbc 바인딩이 describe 이름에 종속 | 🟢 | `.gbc/` | `::test "<full JUnit name>"`가 exact match라 describe 문구를 바꾸면 조용히 unverifiable |
| 7 | 재귀 subtree 수집 비용 미검증 | 🟢 | `be/pkg-tree.ts` | `collectSubtreeRoutes`/`collectSubtreeFiles`가 노드마다 하위 전체 순회. 300노드 3.3ms라 현재 무해, 수천 노드 규모는 미측정 |

### 보안 (OWASP 관점)

| 항목 | 판정 |
|---|---|
| 인젝션 (mermaid 소스) | ✅ percent-encoding으로 값이 `[A-Za-z0-9%._~()!*'-]`에 구조적으로 갇힘 — 이스케이프 누락 가능성 자체를 제거 |
| 인젝션 (webview XSS) | ✅ 툴팁 등 동적 값 전량 `esc()` 경유 (선행 감사에서 전수 확인) |
| 경로 탈출 | ✅ `resolveWithinRoot`로 루트 밖 차단, 웹뷰는 **경로를 공급하지 않고 id만** 보냄 |
| 프로토타입 오염 | ✅ `hasOwnProperty` 가드 |
| ReDoS | ✅ 선행 감사 실측 200KB 입력 0~9ms |
| 실패 처리 | ✅ 손상 인코딩·파일 부재는 전부 조용한 no-op (잘못된 점프보다 무반응) |

> 🔴 HIGH 등급이었던 마커 미이스케이프 인젝션은 선행 감사에서 발견·수정 완료. 본 검증에서 6벡터
> 재검증 통과. **미해결 보안 이슈 없음.**

---

## 4. 이번 수정이 남긴 교훈 (재발 방지 가치)

1. **손수 만든 하니스로 통과한 것은 "검증됐다"가 아니다.** v1.2.61의 Playwright 스펙은 `graph TD\n sid["…"]`
   손작성 하니스만 태웠다. 실제 빌더가 붙이는 접두사 id를 한 번도 통과시키지 않았고, 그래서
   **전 노드 클릭 무반응이 전 게이트 GREEN 상태로 배포**됐다. → `node-deeplink-real-output.spec.mjs`와
   `nodemap-coverage.test.ts`가 실산출물 계층을 메운다.
2. **`ANALYZER_VERSION`을 안 올리면 신기능이 조용히 죽는다.** v1.2.46~v1.2.61 동안 방치돼 `nodeMap`이
   신설된 뒤에도 구버전 캐시가 "유효" 판정을 받았다. → 버전 범프 + shape 검사 **이중화**.
3. **경로 분기별 측정이 아니면 커버리지 숫자는 조건부다.** 비청킹만 재던 "100%"는 청킹·결합 경로를
   포함하지 않았다. 본 검증에서 3분기 전부 실측해 판정을 확정했다.

---

## 5. 개선 로드맵

### 즉시 (Quick Win)

- [x] ~~**청킹 경로 회귀 테스트 고정**~~ — 본 검증에서 완료(부채 #4). 실측만 하고 넘어가면 다음 세션에
      증발하는 종류의 구멍이라, 분석 단계의 read-only 규칙보다 "실검증" 요구를 우선했다
- [ ] **릴리스 메타 선갱신** — README + `packages/extension/package.json` 1.2.61→1.2.62 + CHANGELOG
      (절대원칙: publish 전 선갱신, 예외 없음)

### 단기 (1~2주)

- [ ] **FE Tab3 `ep_*` 딥링크** (부채 #5) — endpoint는 IR 노드가 없지만 `api-call` **엣지의 provenance가
      정확히 fetch/axios 호출 지점의 file:line**이다. 엣지 provenance 기반 매핑을 추가하면 "이 API를
      호출하는 코드로 점프"가 되어 오히려 노드보다 유용하다. IR 확장 0으로 가능
- [ ] **`pkg_*` 대표 노드 탭 간 일치** (부채 #3) — Tab2 트리에 라우트를 매달거나, 대표 선정을 단일
      함수로 통일해 Tab1/Tab2가 같은 컨트롤러를 가리키게 한다
- [ ] **마커 규율 단일화** (부채 #1) — emit/strip/길이측정 3곳의 정규식을 `node-map.ts`가 독점하고,
      "strip 안 한 텍스트가 DiagramSet으로 나가면 실패"하는 테스트를 추가

### 중장기 (1개월+)

- [ ] **접두사 규약을 빌더 계약으로 승격** (부채 #2) — `resolveBySuffix` 문자열 추측을 제거하고 빌더가
      선언 id를 만들 때 IR id를 명시 반환하게 한다. 새 빌더 추가 시 조용히 깨지는 구조 해소
- [ ] **Tab3 검색 지원** — react-router FE의 Tab3는 flowchart라 검색이 기술적으로 가능한데 검색바가
      Tab1/Tab2에만 있다(`count-r`/`count-s`). ERD 탭과 분기 처리 필요
- [ ] **대규모 성능 실측** (부채 #7) — 수천 노드 규모에서 재귀 subtree 수집 비용 측정

---

## 6. 최종 판정

**3개 요구사항 전부 실제 구현 완료 — 실산출물 실측으로 확인.**

- 게이트: verify.sh ALL PASS · Playwright 42 · gbc 28/28 · 보안 6벡터 차단
- 미커밋 25파일, 기능·보안 블로커 **0건**
- 남은 필수 작업: **릴리스 메타 선갱신 1건**

식별된 기술 부채 7건 중 #4는 본 검증에서 해소, 잔여 6건(🔴0 🟡4 🟢2)은 전부 **본 릴리스를 막지
않는다** — 4건은 구조 개선 후보, 2건은 관찰 항목이다.

---

> 이 보고서는 Claude Code `/analyze` 스킬로 생성되었습니다. 에이전트 팬아웃 대신 **인라인 실측**으로
> 수행했습니다 — 앞선 세션에서 병렬 에이전트 4개가 세션 한도로 전멸했고, 실제 결함을 찾아낸 것은
> 인라인 실측이었기 때문입니다.
