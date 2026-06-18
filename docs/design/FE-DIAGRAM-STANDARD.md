# FE Diagram Standard (v1.2)

작성: 2026-05-20 · v1.2.44 진입 직전 표준 amendment 포함
v1.2 개정: 2026-06-12 (v1.2.50) — React Router(config-based)에서 컴포넌트 `src/pages/<도메인>` 깊은 구조일 때 Tab2를 **파일경로 도메인 레이어 트리**로 분리 (§3.4 R-T2.10·2.11). URL이 폴더 구조와 divergent한 실제 repo 대응.

## 0. 배경

v1.2.42에서 React Router Tab1/2/3 전면 재설계 + file-based FE 6종 Tab2 일반화(`buildFeFileTreeScreenDiagram`) → v1.2.43에서 config-based FE 어댑터(Vue SPA·Angular)도 Tab1 wrapper 표준 적용. v1.2.44에서 다음을 마무리:

1. React Router map 패턴 라우트 회귀 해소 (F-Route-1·2·3)
2. Vue SPA·Angular Tab2도 file-tree 표준 진입 (component 참조 추적으로 route.filePath 치환)
3. Tab2 1-depth import 추가 (page → child component leaf)
4. **Tab3 라벨 'DB-Screen' → 'Data Flow' 격상** (표준 amendment)
5. FE-DIAGRAM-STANDARD 단일진실 문서 수립 (본 문서)

본 문서는 FE Tab1/2/3 시각화의 단일 진실 소스로, `BE-DIAGRAM-STANDARD.md`와 쌍을 이룬다.

## 1. 절대원칙 — 사용자 표준 2개

### 표준 1 — 디렉터리 구조 트리 X/Y축 배치 (v1.1 amendment, 2026-05-23)

- **Top-level 형제 cluster = X축 보장** (outer wrapper 안 + cluster end 직후 `~~~` chain emit으로 가로 배치 강제)
- **Nested 자식 cluster = Y축 stack 기본** (mermaid v11 구조적 제약 — `~~~` chain·`direction LR`·invisible wrapper 등 어떤 hack도 일관성 없음)
- Leaf 내부 contents = Y축으로 아래 (유지)

이는 BE 표준 R-T1.4·R-T1.5와 동일 사상이며, FE에서도 Tab1 인프라 wrapper와 Tab2 file-tree 모두 적용. **v1.0 표준은 nested LR을 약속했으나 mermaid v11이 그것을 보장하지 못함이 v1.2.45 webview 실측으로 입증됨 → 라이브러리 능력 범위로 표준을 정정** (자세한 폐기 시도 목록: [[feedback_mermaid_v11_nested_lr_limit]] · 본 문서 §7 v1.1).

### 표준 2 — 각 Tab의 목적 부합 (v1.2.44 amendment)

| Tab | 목적 | v1.2.43 까지 | v1.2.44 amendment |
|---|---|---|---|
| Tab1 | Rendering Architecture | 어떤 인프라/엔진이 어떤 라우트를 렌더하는가 | (동일) |
| Tab2 | Screen–Component | 각 화면이 어떤 컴포넌트들로 구성되는가 | (동일) + 1-depth import child 표시 |
| **Tab3** | **Data Flow** | "DB-Screen" — 어떤 화면이 어떤 DB 테이블에 접근하는가 | **"Data Flow" — 어떤 화면이 어떤 데이터 소스(DB 테이블 ∪ 외부 API endpoint)에 접근하는가** |

**왜 Tab3 격상**: BE/DB 연동이 없는 순수 FE 프로젝트(예: React Router SPA + 외부 API)에서 Tab3는 v1.2.42부터 `buildFeApiCallDiagram`(Screen ↔ API endpoint)을 렌더. 이는 "DB-Screen" 라벨과 부합하지 않았다. 본 amendment는 라벨·구현·표준을 일치시킨다. BE/DB 어댑터는 기존 ER 다이어그램이 그대로 'Data Flow'의 한 케이스로 포함된다.

## 2. Tab1 — Rendering Architecture (FE)

### 2.1 구조 (개념)

```
🌐 Browser
  └─ Hosting Platform (e.g., Vercel)
       └─ Runtime (e.g., Node.js)
            └─ Framework (e.g., Next.js App Router)
                 └─ Rendering Engine (e.g., React)
                      └─ Domain Summary (top-level 도메인 박스 + 라우트 수 배지, R-T1.2 v1.2)
                           └─ External (API Gateway / DB / Auth)
```

> **v1.2 (2026-06-18)**: Tab1은 전 라우트 nested 트리가 아니라 **top-level 도메인 요약**을 표시한다. 하위 도메인 세분화·라우트 leaf 열거는 Tab2의 역할이다. 사유·실측·폐기 근거는 §9 참조.

### 2.2 규칙

| 규칙 | 정의 |
|---|---|
| **R-T1.1 인프라 wrapper** | BROWSER → PLATFORM(또는 ROUTER) → RUNTIME → FRAMEWORK → ENGINE 다층 subgraph. 어댑터별 wrapper 라벨은 metadata 기반(`buildNestedSubgraphLines`). |
| **R-T1.2 도메인 요약 (v1.2)** | 최내부 ENGINE wrapper 안에 **top-level URL 도메인별 요약 박스** 1개씩 emit (`buildDomainSummaryLines`). 박스 라벨 = `도메인 · N routes`(라우트 수 배지). 하위 세그먼트(matMgmt 등) 중첩·라우트 leaf 열거는 **하지 않는다** — 그건 Tab2의 역할(표준 2, 탭 차별성). 도메인 박스 형제는 `~~~` chain으로 X축 보장, 도메인 수 > `GROUPS_PER_ROW`면 inner-row wrapper로 줄넘김. 도메인은 항상 O(도메인 수)라 단일 다이어그램 유지(R-T1.7). |
| **R-T1.3 동적 segment** | ~~Tab1 leaf 시각 구분~~ → v1.2부터 Tab1은 도메인 요약만 표시하므로 미적용(라우트 수에만 카운트). dynamic segment 시각 구분은 Tab2(R-T2.x)에서 처리. |
| **R-T1.4 group route (Next App Router)** | ~~Tab1 별도 subgraph~~ → v1.2부터 Tab1 미적용(도메인 요약에 카운트). group route 디렉토리 구조 보존은 Tab2에서 처리. |
| **R-T1.5 외부 분기** | 별도 subgraph로 `🗄 DB Tables` · `🌐 External API` · `🔥 Firebase` · `📦 Dexie` 등 분기. 우선순위: backends > Supabase > Prisma > Firebase > Dexie > hasExternalAPI > apiCallEdges (LLM enabled 시 backends 우선). |
| **R-T1.6 renderingMode 클래스** | `:::ssr` (서버) / `:::csr` (클라이언트) / `:::ssg` / `:::isr` / `:::ppr` / `:::unk` (미상). |
| **R-T1.7 청킹 폐지 (v1.2)** | Tab1은 **청킹하지 않는다**. 도메인 요약(R-T1.2 v1.2)은 노드 수가 O(도메인 수)로 작아 항상 단일 다이어그램으로 충분하고, 청킹은 wrapper(R-T1.1)·외부분기(R-T1.5)를 폐기시켜 Tab1의 목적을 무너뜨렸다(v1.2.51 C2 게이트 결함, 분석 `docs/analysis/v1.2.52-fe-tab1-yaxis-findings.md`). 도메인 과다 시 inner-row wrapper로 줄넘김(청킹 아님). chunking은 라우트 leaf를 열거하는 Tab2(R-T2.8)에서만 유효. |

## 3. Tab2 — Screen–Component (FE)

### 3.1 구조

화이트리스트 어댑터(R-T2.1)에 대해 `buildFeFileTreeScreenDiagram` 적용:

```
subgraph products[📁 /products]
  subgraph dyn_id[[id]]
    route_products_id["[id] · SSR"]              ← 라우트 노드
    file_page["📂 app/products/[id]<br/>📄 page.tsx"]  ← 페이지 파일 leaf
    route_products_id --> file_page                  ← Y축 edge (R-T2.2)
    file_page --> comp_detail                        ← 1-depth import (R-T2.4)
    file_page --> comp_related
    file_page --> comp_addcart
  end
end

%% Shared component: 단일 노드 + fan-in (R-T2.5 Sub-1)
file_page_other --> comp_button
file_page --> comp_button
```

### 3.2 규칙

| 규칙 | 정의 |
|---|---|
| **R-T2.1 화이트리스트** | `isFileTreeTab2Eligible`: nextjs-app-router · nextjs-pages · nuxt · sveltekit · remix · react-router · **vue-spa**(v1.2.44+) · **angular**(v1.2.44+). LLM-only(vite-react·expo)는 legacy `renderScreenSection` fallback. |
| **R-T2.2 라우트 → 파일 leaf** | 각 라우트 노드 옆/아래에 `📂 dir<br/>📄 filename` 형태의 파일 leaf 노드 + `route → file` Y축 edge. |
| **R-T2.3 디렉토리 그룹 subgraph (v1.1)** | URL prefix 공유 라우트들은 directory subgraph로 묶음. **Top-level 도메인 형제 사이 X축 배치 보장**, **nested 자식 directory는 Y축 stack** (표준 1 v1.1 / R-T1.2 v1.1과 동일 사상). |
| **R-T2.4 1-depth import child (v1.2.44+)** | page 컴포넌트의 직접 import(importDepth=1)된 internal component 파일을 `file_page --> child_file` Y축 edge로 표시. routeFileKind === 'page' 가드(layout/loading import 차단). |
| **R-T2.5 Sub-1 shared component** | 동일 component가 N page에서 import되면 노드 1회만 emit + 각 page → component edge N개 (fan-in). `fileNodeRendered: Set<string>` 가드 활용. |
| **R-T2.6 Sub-2 page → page import** | drill-down 라우트 간 page → page import도 동일하게 1-depth import edge 표시. routeFileKind 필터 제거(page만이 from). |
| **R-T2.7 외부 lib 자동 필터** | IR `componentNodes`에 등록되지 않은 import target(외부 lib)은 `compById.get(...) === undefined` → 자동 누락. |
| **R-T2.8 chunk 게이트** | `branchingGroups.length > TAB2_GROUPS_PER_ROW && pageRoutes.length > SINGLE_DIAGRAM_ROUTE_THRESHOLD` 시 group별 chunk 분할 (chunked 경로는 v1.2.43 시점 react-router 분기 미적용, v1.2.44에서도 변경 없음). |
| **R-T2.9 LLM-only 어댑터 가드** | vite-react·expo는 importsEdges 0건 → child 생략, file leaf만 표시 (현행 보존). |

### 3.3 Vue SPA · Angular 컴포넌트 추적 (v1.2.44 A1-1·A1-2)

| 어댑터 | 추적 패턴 | filePath 치환 |
|---|---|---|
| vue-spa | `component: () => import('./Foo.vue')` (dynamic) · `component: FooComp` (sync) | 모듈 spec resolve → `.vue`·`.ts`·`.tsx`·`.js`·`.jsx` 확장자 fallback, abs path → `path.relative(repoRoot, ...)` |
| angular | `component: FooComponent` (Identifier sync) · `loadComponent: () => import('./foo').then(m => m.Foo)` (dynamic) | 동일. `loadChildren`은 자체 모듈이라 fallback 유지. |

resolve 실패 시 fallback: routes 정의 파일의 relPath (회귀 가드, 표시는 가능).

### 3.4 React Router src/pages 도메인 레이어 (v1.2.50 RR-3)

config-based React Router는 URL과 컴포넌트 파일 위치가 분리된다. 실제 repo는 URL을 평탄하게(`/order-plan/spec`) 두면서 컴포넌트는 깊은 도메인 폴더(`src/pages/partner/ordProdPlanMgmt/prodOrdSpec/...`)에 둔다. URL 그룹핑(R-T2.3)은 이 경우 도메인을 드러내지 못하고 평탄한 형제 group만 나열한다.

→ **BE Tab2가 패키지 트리를 top-level 패키지 chunk로 분리하는 방식과 동일하게**, 컴포넌트의 `src/pages/<Root 도메인>` 파일경로 트리로 레이어링한다.

```
%% chunk per top-level 도메인 (partner / agency / headoffice)
graph TD
  subgraph HDR_PAGES ["📁 src/pages/partner"]
    pkg_partner__ordProdPlanMgmt["ordProdPlanMgmt"]
    pkg_partner__ordProdPlanMgmt__prodOrdSpec["prodOrdSpec"]
    pkg_partner__ordProdPlanMgmt --> pkg_partner__ordProdPlanMgmt__prodOrdSpec
    pageleaf_...["spec · csr<br/>📄 OrdSpecPrintPage.tsx"]
    pkg_partner__ordProdPlanMgmt__prodOrdSpec --> pageleaf_...
  end
```

| 규칙 | 정의 |
|---|---|
| **R-T2.10 도메인 레이어 적격** | `framework === 'react-router'` **AND** `isPagesDomainEligible`: `src/pages/` 하위에 ≥2개 도메인 폴더가 존재(컴포넌트가 `pages/<domain>/.../File` 깊이 보유)할 때만 적용. 평탄(`src/pages/Home.tsx` 직속)·기타 어댑터는 R-T2.3 URL 그룹핑 유지(회귀 0). |
| **R-T2.11 도메인 chunk 트리** | 컴포넌트 filePath의 `pages/` 이후 segments로 `buildPkgTree` → `chunkByTopLevelPackage`로 top-level 도메인별 chunk 분리(`📁 src/pages/<domain>` 헤더). 중간 폴더 = `:::pkg` 트리 노드(BE R-T1.4 재사용), 페이지 = `pageleaf_<routeId>` leaf(라우트 표시 + 렌더모드 배지 + 📄 파일명). chunk 분리로 단일 대형 다이어그램 프리즈 회피 → R-T2.8 >100 route 게이트 이전 분기. |

> **알려진 한계**: 단일 도메인 chunk 내 라우트가 매우 많을 때 node-bound 추가 분할은 미적용(BE chunkByTopLevelPackage와 동일 수준). 실 repo ship 후 재평가.

## 4. Tab3 — Data Flow (FE)

### 4.1 케이스 분기

| 조건 | 렌더링 |
|---|---|
| `metadata.adapterCategory === 'BE' \|\| tableCount > 0` | **DB ER 다이어그램** + `Queries` edge (Repository·Route → Table). |
| 위 미해당 + `hasReactRouter`(또는 다른 FE) + `tableCount === 0` | **Screen ↔ API endpoint 다이어그램** (`buildFeApiCallDiagram` — v1.2.42부터 도입). |

### 4.2 규칙

| 규칙 | 정의 |
|---|---|
| **R-T3.1 라벨 'Data Flow' (v1.2.44+)** | 격상 라벨. UI 탭(`webview.ts`), export MD 헤더(`db-screen.md`의 첫 줄 "# Data Flow (Screen ↔ Data Source)"), i18n key `tab.dbScreen` 모두 일관. **기존 'DB-Screen'은 한 케이스의 부속 표현으로 흡수**. |
| **R-T3.2 DB 케이스 ER** | MySQL Workbench 스타일 ER + `queries` edge. 컬럼 헤더 + PK/FK 표시. v1.2.2부터 표준. |
| **R-T3.3 API 케이스 endpoint** | 라우트별 endpoint 노드 + `method path` 라벨 + 라이브러리(axios/fetch/react-query) 표시. confidence='inferred'면 dashed edge(`-.->`). v1.2.42 React Router에 처음 도입. |
| **R-T3.4 empty 분기** | 두 케이스 모두 해당 안 되면 empty state ("no data flow detected"). |

## 5. 어댑터별 적용표

| 어댑터 | 라우트 식별 | Tab2 file-tree (R-T2.1) | Tab2 imports child (R-T2.4) | Tab3 케이스 |
|---|---|---|---|---|
| nextjs-app-router | 디렉토리 = URL | ✅ | ✅ | DB 또는 API |
| nextjs-pages | `pages/*.tsx` | ✅ | ✅ | DB 또는 API |
| nuxt | `pages/*.vue` | ✅ | ✅ | DB 또는 API |
| sveltekit | `routes/+page.svelte` | ✅ | ✅ | DB 또는 API |
| remix | `app/routes/*` | ✅ | (imports 미수집) | DB 또는 API |
| react-router | `createBrowserRouter` 또는 `<Routes>` JSX | ✅ | (imports 미수집) | DB 또는 API |
| **vue-spa** (v1.2.44) | `createRouter({ routes: [...] })` + component import 추적 | ✅ | ✅ | DB 또는 API |
| **angular** (v1.2.44) | `provideRouter(routes)` + Identifier/loadComponent 추적 | ✅ | ✅ | DB 또는 API |
| vite-react (LLM-only) | LLM | ⚠ legacy fallback | — | API (LLM 추정) |
| expo (LLM-only) | LLM | ⚠ legacy fallback | — | (해당 없음) |

## 6. 검증 fixture

| 어댑터 | fixture | 검증 포인트 |
|---|---|---|
| react-router | mini-react-router-app · jsx-app · jsx-expr · map-prefix · overload · **map-import-app**(v1.2.44 신규, F-Route-1·2·3) | 라우트 N건 + elementComponent 매핑 + inferenceChain |
| vue-spa | mini-vue-spa-app | filePath 치환 + Tab2 file-tree |
| angular | mini-angular-app | filePath 치환 + forRoot/forChild + loadChildren fallback |
| file-based 6 | mini-next-app · mini-nextpages-app · mini-nuxt-app · mini-sveltekit-app · mini-remix-app · (react-router 위) | snapshot 회귀 0건 |

## 7. 변경 이력

- **v1.0** (2026-05-20, v1.2.44 진입 직전): 초안 작성. BE-DIAGRAM-STANDARD.md와 쌍. Tab3 라벨 'Data Flow' 격상 표준 amendment.
- **v1.1** (2026-05-23, v1.2.45 publish 직전 채택): R-T1.2 X축 보장 범위를 **top-level 형제로 한정** + nested 자식 = Y축 stack 기본 명시. 본문 §1·§2.2 R-T1.2·§3.2 R-T2.3 정정. webview 실측 결과 mermaid v11이 nested LR을 보장하지 못함을 직시 → 라이브러리 능력 범위로 표준 정정. 자세한 사유·폐기 시도는 §8 참조.
- **v1.2** (2026-06-18, v1.2.53 사이클 채택): **Tab1을 도메인 요약으로 재정의**(R-T1.2 v1.2) + **Tab1 청킹 폐지**(R-T1.7 v1.2). R-T1.3·R-T1.4는 Tab1 미적용으로 정정. v1.2.51 C2 청킹 게이트가 Tab1 wrapper·외부분기를 폐기시켜 Tab1이 URL 트리로 전락 + Tab2와 중복되던 결함 해소. 본문 §1 표준 2·§2.1·§2.2 R-T1.2~R-T1.4·R-T1.7 정정. 자세한 사유·실측은 §9 참조.

## 8. v1.1 Amendment 본문 — R-T1.2 X축 보장 범위 정정

> **상태**: 정식 채택 (2026-05-23, v1.2.45 publish 사이클)
> **연관 메모리**: [[feedback_mermaid_v11_nested_lr_limit]] · [[project_v146_hotfix]]
> **사유**: 표준이 mermaid v11이 보장 못하는 X축 layout을 약속하던 모순 해소

### 8.1 배경

v1.0 표준 1 ("동일 directory depth = X축") + R-T1.2 ("자식 directory = Y축") 은 모든 depth에서 동일 depth 형제 cluster의 X축 가로배치를 약속해 왔다. v1.2.40 이후 patch들(v1.2.41~v1.2.44)에서 mermaid v11의 다양한 hack(invisible row wrapper · direction LR · `~~~` chain emit 위치 시도 등)으로 nested LR을 달성하려 했으나, **v1.2.45 buildup webview 실측에서 패턴이 일관되지 않음이 입증**되었다.

구체적으로:
- **mini-react-partner Tab1**: 옵션 X.2(leaf 평탄화) 적용 후 `/partner` 안 자식 subgraph chain → **X축 작동** (vsix webview 확인)
- **mini-react-partner Tab2**: 동일 NestedGroup tree + 동일 chain 위치인데 → **Y축 stack** (vsix webview 확인)

→ **CDN(정적 HTML) 검증이 webview와 일치하지 않으며, 동일 코드 패턴이 Tab1/Tab2에서 다른 layout 결과를 낸다**. mermaid v11의 nested LR은 패턴 단위로 예측 불가능하며, 표준이 약속할 수 없는 영역이다.

mermaid 공식 명세도 이를 뒷받침: "If any of a subgraph's nodes are linked to the outside, subgraph direction will be ignored. Instead the subgraph will inherit the direction of the parent graph." → 외부 edge가 있으면 direction 무시 + cluster끼리 chain은 부모 direction 상속이 일관되지 않음.

### 8.2 본 amendment의 결정

**X축 보장 범위를 top-level 형제 cluster로 한정한다. 자식 cluster들의 형제 X축은 표준이 약속하지 않는다.**

### 8.3 정정되는 규칙

**표준 1 (§1) 정정**:
- 기존: "동일 Depth = X축으로 나란히 / 최종 Depth 이후 leaf 내부 contents = Y축으로 아래"
- amendment: "**Top-level 형제 cluster = X축 보장**. nested 자식 cluster들은 **Y축 stack 기본**(mermaid v11 구조적 제약). leaf 내부 contents = Y축으로 아래 (유지)."

**R-T1.2 (§2.2) 정정**:
- 기존: "최내부 ENGINE wrapper 안에 라우트 nested subgraph. 동일 directory depth = X축, 자식 directory = Y축 (표준 1)."
- amendment: "최내부 ENGINE wrapper 안에 라우트 nested subgraph. **ENGINE 바로 아래 top-level 도메인 형제 = X축 보장** (`emitTopLevelSiblingChain` + outer wrapper 안 chain emit). **그 이하 nested 자식 = Y축 stack 기본** (mermaid v11 한계). 추가 nested X축 시도는 amendment 없이 진행 금지."

**R-T2.3 (§3.2) 정정**:
- 기존: "URL prefix 공유 라우트들은 directory subgraph로 묶음 (표준 1 X축 배치)."
- amendment: "URL prefix 공유 라우트들은 directory subgraph로 묶음. **Top-level 도메인 사이 X축 배치는 보장**, **nested 자식 directory는 Y축 stack** (R-T1.2 amendment와 동일 사상)."

### 8.4 보존되는 코드 처방

amendment는 X축 보장 약속 범위만 좁히며, 다음 코드는 **다른 가치로 유지된다**:

- **Fix 1** (`url-grouper.ts` single-route recurse): intermediate URL segment를 NestedGroup tree에 explicit 보존 → **Dept 경계 시각화**. X축 보장과 무관.
- **옵션 X.2** (`buildNestedSubgraphLines` leaf 평탄화): 단일-route + 자식 0개 + dynamic/group route 아닌 leaf의 wrapper subgraph 제거 + parent context stripPrefix → **wrapper 중복 제거 + 라벨 정합성**. X축 보장과 무관.

Tab1에서 옵션 X.2 적용 후 일부 nested 자식이 webview에서 우연히 X축으로 작동하는 케이스가 있다 — 이는 **"보너스 효과"**로 기록하며, 표준 약속에 포함하지 않는다.

### 8.5 폐기되는 시도 (재발 방지)

- ~~invisible row wrapper + `direction LR`~~ (mermaid v11에서 시각적 무시)
- ~~chain을 부모 cluster 안(`${i2}` `end` 이전)에 emit~~ (Playwright 실측 회귀)
- ~~ELK opt-in (`layout:elk + hierarchyHandling:INCLUDE_CHILDREN`)~~ (webview console에 loader 메시지조차 안 나타남 + leaf cluster 표준 충돌)
- ~~"단일-plain-노드 subgraph chain X축" 패턴~~ (CDN ✓ / webview 비일관)

→ 향후 hotfix가 본 한계를 우회하려 시도할 때 본 §8.5 다시 확인 필요. amendment 없이 표준 외 X축 보장 추가 금지.

### 8.6 적용 영향

- **검증**: 기존 fixture snapshot은 본 amendment로 의도가 바뀌는 것이 아닌, **그동안 Y축이었던 결과를 "비정상"이 아닌 "표준 준수"로 재해석**. snapshot 변경 없음.
- **사용자 경험**: fa-support 같은 file-based 라우터의 nested 자식 Y축 stack은 표준 부합. v1.2.45 결함 2 보고는 amendment 채택 후 "결함 아닌 표준 동작"으로 정정.
- **표준 단순성**: 향후 어댑터 추가·hotfix 시 "X축 보장은 top-level만"이라는 단일 규칙. 패턴 분기 시도 제거.

### 8.7 채택 완료 후속 (v1.2.45 publish 사이클)

- 본 §8 본문 정식 채택 완료(2026-05-23). §1·§2.2 R-T1.2·§3.2 R-T2.3 모두 v1.1 정정 반영.
- CHANGELOG v1.2.45 entry에 "표준 amendment (R-T1.2 v1.1) + 결함 1 fix + Tab1 leaf 평탄화" 통합 명시.
- [[feedback_mermaid_v11_nested_lr_limit]] 메모리에 amendment 채택 일자(2026-05-23) 기록.
- v1.2.45 단일 publish 사이클 진행 (v1.2.46 별도 버전 없음).

## 9. v1.2 Amendment 본문 — Tab1 도메인 요약 재정의 + 청킹 폐지

> **상태**: 채택 (2026-06-18, v1.2.53 사이클)
> **연관**: `docs/analysis/v1.2.52-fe-tab1-yaxis-findings.md` · [[project_v1253_plan]] · [[feedback_mermaid_nested_subgraph_spacing]]
> **사유**: v1.2.51 C2 청킹 게이트가 Tab1의 인프라 wrapper·외부분기를 폐기시켜 Tab1을 URL 트리로 전락 → Tab2와 중복 + 1~3탭 계층성 붕괴

### 9.1 배경 (실측)

`buildRenderingDiagram`의 청킹 분기(`branchingGroups.length > GROUPS_PER_ROW(5)` || `routeNodes > 100`)가 발동하면 `buildRouteRowDiagram`로 빠지는데, 이 경로는 FW_CONFIGS wrapper(R-T1.1)와 외부분기(R-T1.5)를 **전혀 emit하지 않는다**. 실측:

- `/tmp/rr-big`(top-level 도메인 7개): Tab1에서 BROWSER/ROUTER/REACT wrapper·API LAYER **소실**, URL 그룹만 잔존.
- `mini-react-router-domain-app`(5개): 게이트 미발동 → wrapper·외부분기 **정상**.

실 repo는 도메인 6개 이상이 흔해 거의 항상 발동했다. 또한 Tab1이 URL 전 세그먼트를 중첩 subgraph로 레이어링(`/partner` 안 `/matMgmt`)하여 Tab2(`pages/` 폴더 트리)와 그룹핑 베이스가 어긋났다.

### 9.2 결정

**Tab1은 top-level URL 도메인의 요약(도메인명 + 라우트 수 배지)만 표시하고, 라우트 leaf 열거·하위 세분화는 하지 않는다. 따라서 청킹이 불필요하며 폐지한다.**

- 노드 수 = O(도메인 수) → 항상 단일 다이어그램 → wrapper(R-T1.1)·외부분기(R-T1.5) 항상 유지.
- 도메인 박스 형제는 `~~~` chain으로 X축 보장(표준 1 v1.1과 동일), 도메인 수 > `GROUPS_PER_ROW`면 inner-row wrapper로 줄넘김.
- 하위 도메인 세분화·화면-컴포넌트 상세는 Tab2의 단독 책임(표준 2 탭 차별성 복원).

### 9.3 정정되는 규칙

- **표준 2 (§1) Tab1 목적**: "어떤 인프라/엔진이 어떤 라우트를 렌더하는가" → 도메인 요약으로 충족(전 라우트 열거 불요).
- **R-T1.2 (§2.2)**: nested 라우트 트리 → **도메인 요약 박스**(`buildDomainSummaryLines`).
- **R-T1.3·R-T1.4**: Tab1 leaf 처리 → Tab1 미적용(라우트 수에 카운트). dynamic/group 시각 구분은 Tab2.
- **R-T1.7 (§2.2)**: 청킹(`SINGLE_DIAGRAM_ROUTE_THRESHOLD`) → **Tab1 청킹 폐지**. Tab2(R-T2.8) 청킹은 유지.

### 9.4 부수 해소

- **Y축 길이 문제(Tab1)**: 도메인 박스만 남아 nested 스택 깊이가 사라져 부수 완화. Tab1의 nested+`~~~`+외부edge 구조는 spacing 옵션이 무시되는 케이스([[feedback_mermaid_nested_subgraph_spacing]])라 노드 수 감소가 정공법.
- **Tab1/Tab2 레이어 불일치(1a)**: Tab1이 URL 세분화를 하지 않으므로 자연 해소.

### 9.5 보존

- Tab2(`buildScreenComponentDiagram`)의 청킹·도메인 레이어(R-T2.x)·file-tree는 **무변경**.
- BE Tab1/Tab2(`buildBeRenderingDiagram`·`buildBeArchitectureDiagram`)는 무관·무변경.

## 부록 — 참조 메모리·코드

- 절대원칙 메모리: [project_v144_fe_improvement](../../memory-export/project_v144_fe_improvement.md) (활성)
- BE 짝: [BE-DIAGRAM-STANDARD.md](./BE-DIAGRAM-STANDARD.md)
- 핵심 코드: `packages/renderer/src/mermaid-renderer.ts` (isFileTreeTab2Eligible · buildFeFileTreeScreenDiagram · emitRouteAndFileLeaf · buildDbScreenDiagram · buildFeApiCallDiagram) · `packages/core/src/adapters/{vue-spa,angular,reactrouter}/parsers/route-parser.ts`
- Phase Lifecycle: [feedback_phase_lifecycle_workflow](../../memory-export/feedback_phase_lifecycle_workflow.md)
