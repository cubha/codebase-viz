# BE Diagram Standard (v1.2)

작성: 2026-05-19 · 사용자 합의: v1.2.40 작업 진입 전
v1.1 개정: 2026-06-12 (v1.2.50) — Tab2 DI 체인을 고정 2-hop에서 **N-ary 재귀 체인**으로 확장 (§3.2 R-T2.2·2.5·2.7)
v1.2.57 amendment: 2026-06-29 — R-T1.6 endpoint 표현을 `endpoints_<Ctrl>` subgraph(Y축 노드 적층)에서 **leaf 노드 안 markdown multiline collapse**로 전환 (§2.1·§2.2 R-T1.6). endpoint가 많은 컨트롤러의 Y축 비대 해소.
v1.2 개정: 2026-07-22 (Task7, [[project_v13x_be_phase2_candidates]] C1·C2·C3·C4) — K3(색충돌 해소, R-T1.7/R-T2.6) · C2(Route→Controller `handles` 엣지, R-T2.8) · C1(MyBatis statement 노드, R-T2.9) · C4(테이블 클러스터 뱃지, R-T1.10) · C3(외부 시스템 노드, R-T2.10 — `@FeignClient`만 우선 구현, RestTemplate/WebClient/SAP RFC/`@JmsListener`는 defer). K1은 C1 반영으로 자연 해소(R-T2.2 체인이 XML에서 Statement로 한 홉 더 연장, 구조 확장 아님).

## 0. 배경

v1.2.2/v1.2.3 BE 어댑터 표준화에서 도입된 Tab1/Tab2 BE 전용 렌더러가 실제 대용량 Spring Boot 프로젝트(985 routes / 422 tables)에서 두 가지 한계 노출:

1. **Tab2 단순 X축 나열**: 컨트롤러 30+ 도메인이 한 줄에 펼쳐져 X축 폭발. 패키지 계층·연관관계 미표현.
2. **Tab1 nested subgraph(박스 in 박스)**: 깊은 패키지를 컨테이너 중첩으로 표현하나 트리 직관성 부족.

본 표준은 BE Tab1/Tab2 시각화를 사용자가 제시한 트리 다이어그램 구조로 통일하기 위한 단일 진실 소스다.

## 1. 표현 원칙

1. **레이아웃**: `graph TD` (top-down). 동일 depth = X축으로 나란히, 부모→자식 관계 = Y축으로 아래.
2. **노드 = 실체**: 패키지·컨트롤러·서비스·리포지토리 모두 노드로 표현. subgraph는 의미 있는 컨테이너로 제한적 사용(예: leaf의 DI 체인 묶음, DB ER).
3. **간선 = 관계**: 부모-자식(패키지 계층)·DI 주입은 명시적 edge로. 추정 관계는 dashed edge(`-.->`).

## 2. Tab1 — Rendering Architecture (BE)

### 2.1 구조

```
┌─────────────────────────────────────────────┐
│ 📁 src/main/java/com.<공통 prefix>            │  (헤더 annotation)
│                                              │
│                  wina                        │  (top-level node)
│        ┌──────────┼──────────┐               │
│      partner    agency    headoffice         │  (depth 1, X축)
│        │                                      │
│  ┌─────┴───────┐                              │
│ matMgmt   ordProdPlanMgmt                    │  (depth 2)
│   │                                           │
│ decoSheet                                     │  (depth 3)
│   │                                           │
│ 📄 **DecoSheetController** [/api/.../decoSheet]│  (leaf, collapse)
│ ─────────────                                 │
│   **GET** /                                   │
│   **GET** /:id                                │
│   **POST** /                                  │
└─────────────────────────────────────────────┘
```

### 2.2 규칙

| 규칙 | 정의 |
|---|---|
| **R-T1.1 패키지 추출** | `src/main/{java,kotlin}/` 자동 감지 후 파일명 제외한 segments 추출. |
| **R-T1.2 공통 prefix strip** | 모든 Controller가 공유하는 LCP(예: `com.wina`) 자동 strip. strip된 경로는 다이어그램 상단 헤더 노드(`📁 src/main/java/com.wina`)로 1회 표시. |
| **R-T1.3 suffix strip** | 마지막 segment가 모두 `controller(s)`(case-insensitive)이면 strip. Spring 패키지 컨벤션 반영. |
| **R-T1.4 트리 노드** | 각 패키지 segment = 사각형 노드(`pkg["wina"]`). 부모-자식은 명시적 edge(`-->`). |
| **R-T1.5 leaf 노드** | Controller 파일 = `📄 ControllerName [/api/prefix]` 노드. URL prefix는 path-segment LCP로 자동 추출. |
| **R-T1.6 endpoints** (v1.2.57 amendment) | Controller leaf **노드 안에 markdown multiline**으로 collapse. 헤더(`📄 **ControllerName** [prefix]`) + 구분선 + endpoint 1행씩(`**METHOD** /suffix`, suffix만·prefix 중복 제거). 구 `endpoints_<Ctrl>` subgraph(endpoint를 개별 노드로 Y축 적층)는 **폐기** — endpoint 많은 컨트롤러의 Y축 비대 + nested subgraph spacing/LR 통제 불가 문제 해소. URL 경로의 markdown 메타문자(`_*\``)는 백슬래시 escape. viewer `htmlLabels:false`(SVG 텍스트)에서 markdown bold 정상 렌더. |
| **R-T1.7 클래스** (v1.2 amendment) | leaf Controller = `:::ctrl`(청록, K3 색충돌 해소 — FE `ssr`과 분리), 패키지 노드 = `:::pkg`(중립 회색). |

### 2.3 테이블 클러스터 (v1.2, K4)

| 규칙 | 정의 |
|---|---|
| **R-T1.10 leaf 테이블 뱃지** | Controller의 DI 체인(`calls`, 깊이 가드 6)을 재귀 추적해 도달 가능한 컴포넌트의 `queries` 엣지 대상 테이블을 모아 leaf 노드 안 markdown 마지막 행에 `🗄 table1, table2` 로 collapse(endpoint 목록과 동일 기법, R-T1.6 연장). 신규 IR·신규 subgraph 없음 — Tab3 ER은 별도 view로 변경 없음(K4 결정). 테이블 0개면 뱃지 라인 자체를 생략(Less is More). |

### 2.4 X축 폭발 방지

| 규칙 | 정의 |
|---|---|
| **R-T1.8 top-level 청크** | top-level 패키지(R-T1.2 strip 후 첫 depth 노드, 예: `partner`/`agency`/`headoffice`)별로 별도 다이어그램 chunk 분할. viewer row-mode가 chunk별 zoom/pan을 이미 지원. |
| **R-T1.9 elk mrtree(보조)** | `@mermaid-js/layout-elk`가 `mrtree` 알고리즘을 노출하는 경우 적용. 빌드 확인 필수. 미지원 시 기본 dagre + R-T1.8 chunking으로 대체. |

## 3. Tab2 — Screen–Component (BE)

### 3.1 구조 (v1.1)

Tab1과 동일한 패키지 트리 위에, leaf를 단순 Controller 노드가 아닌 **Controller에서 출발하는 N-ary 재귀 DI 체인 subgraph**로 확장. 고정 `Controller → Service → Repository` 2-hop 구조(v1.0)는 폐기하고, `calls` 엣지를 재귀 추적하여 **다중 Service 인라인 + ServiceImpl→다중 Repository fan-out + Repository→XML**까지 실제 존재하는 모든 단계를 표시한다.

```
…  ←  (Tab1과 동일한 패키지 트리)
   │
 📄 CommonPopController
   │
 ┌─[ DI ]──────────────────────────────────────┐
 │  CommonPopController                          │
 │      ↓                  ↓                      │  ← 다중 Service 인라인
 │  CommonPopService   PerfStatusService         │
 │      ↓                  ↓                      │  ← Service → ServiceImpl (implements)
 │  CommonPopServiceImpl  PerfStatusServiceImpl  │
 │      ↓        ↓             ↓                  │  ← ServiceImpl → 다중 Repository (fan-out)
 │  CommonPopRepo OrderRepo  PerfStatusRepo       │
 │      ↓                                          │  ← Repository → XML (namespace 매칭)
 │  CommonPopMapper.xml …                          │
 └────────────────────────────────────────────────┘
```

### 3.2 규칙 (v1.1)

| 규칙 | 정의 |
|---|---|
| **R-T2.1 베이스 트리** | Tab1과 동일한 패키지 트리 구조 + 동일 chunking 정책(R-T1.8) 적용. |
| **R-T2.2 N-ary DI 체인** | Controller leaf 자리에 `di_<ControllerId>` subgraph. Controller에서 `calls` 엣지를 **재귀 추적**(깊이 가드 6)하여 Controller → Service[] → ServiceImpl → Repository[] → XML 단계를 표시. 각 단계는 별도 노드 + `-->`(verified) 또는 `-.->`(inferred). 노드 ID는 `di_<ctrl>__<compId>`로 leaf 단위 namespace화(다중 Controller 주입 시 subgraph 간 충돌 방지). |
| **R-T2.3 leaf 정렬** | DI 체인은 Controller(상)→XML(하) 수직. edge 방향은 호출/구현/매핑 방향과 일치. |
| **R-T2.4 cross-package DI** | 한 도메인의 컴포넌트가 다른 도메인 컴포넌트를 주입받으면 외부 노드 ID 직접 참조 금지(ghost-node 회피) → `(external Service/Repository)` placeholder(`:::muted`) + `cross-pkg` 라벨. XML 매퍼(resources, java 패키지 밖)는 cross-pkg 판정에서 제외하고 항상 terminal 실노드로 표시. |
| **R-T2.5 Less is More** | 실제 존재하는 엣지만 표시. Service/Repository가 없으면 그 단계를 그리지 않으며 `(none)` 추정 placeholder를 만들지 않는다. (v1.0의 고정 슬롯 placeholder 폐기) |
| **R-T2.6 클래스** (v1.2 amendment) | Controller=`:::ctrl`(청록), Service/ServiceImpl=`:::unk`(회색), Repository=`:::ssg`(보라), XML/Statement=`:::pkg`(슬레이트). |
| **R-T2.7 IR 계약** | Service(interface)→ServiceImpl은 di-parser의 `implements` 추적 `calls` 엣지. Repository→XML은 mapper-xml-parser의 namespace(FQN) 정확 매칭 `calls` 엣지 + XML ComponentNode(`*.xml`). IR EdgeKind 확장 없음. |
| **R-T2.8 Route↔Controller** (v1.2, C2) | RouteNode와 그 파일의 Controller ComponentNode를 `handles` 엣지(신규 EdgeKind)로 연결 — filePath 정확 일치, verified. `renders`(FE page/layout SSR)와 의미가 달라 재사용하지 않음(K3와 동일 취지). Tab1/2 렌더링에는 영향 없음(기존 filePath 그룹핑 그대로) — 그래프 질의 가능성만 추가. |
| **R-T2.9 XML→Statement** (v1.2, C1) | mapper XML의 `<select/insert/update/delete id="...">`를 ComponentNode(`id [SQL_TYPE]` 네이밍, ST7-2 Option A — 신규 NodeKind 없음)로 노출, XML→Statement `calls` 엣지 추가(DI 체인 5번째 홉). Repository.method ↔ statement-id 매핑(인터페이스 메서드 파싱)은 범위 밖 — 결정론적으로 확인 가능한 XML 구조만 다룸. Tab2 cross-pkg 게이트는 XML과 동일하게 Statement도 판정 예외(resources 하위라 package 없음). |
| **R-T2.10 외부 시스템** (v1.2, C3) | `@FeignClient` 인터페이스를 ComponentNode로 등록(이름은 원본 클래스명 그대로 — 접미사를 붙이면 di-parser `@Autowired` 필드-타입명 매칭이 깨짐). 대신 `provenance.adapter === 'external-call-extractor@0.1'`을 렌더러 판별 마커로 사용, `:::ext`(호박색) 클래스 부여. Tab2 cross-pkg 게이트에서도 XML/Statement와 동일하게 판정 예외(패키지 소속이 없는 게 정상). RestTemplate/WebClient(호출 URL이 표현식이라 정적 추출 신뢰도 낮음)·SAP RFC(범용 Java 문법으로 판별 불가)·`@JmsListener`(외부→컴포넌트로 엣지 방향이 반대)는 defer. |

## 4. Tab3 — DB–Screen (BE)

**변경 없음.** ER 다이어그램(`erDiagram`)은 표준 표 형식이 산업 표준이며, v1.2.2에서 적용된 MySQL Workbench 스타일 테마(헤더 어두운 청회색 + td 밝은 배경) 유지.

## 5. FE 다이어그램과의 관계

본 표준은 **BE 어댑터(`adapterCategory: 'BE'`)에만 적용**. FE 어댑터(`'FE'` / `'Fullstack'`)는 URL 기반 라우트 그룹핑 + Wave 1 nested subgraph 정책을 유지(v1.1.6 T4 그대로).

## 6. 변경 영향 범위

| 변경 대상 | 파일 | 회귀 위험 |
|---|---|---|
| Tab1 BE | `packages/renderer/src/mermaid-renderer.ts` (`buildBeRenderingDiagram` 재구현) | BE 전용 분기이므로 FE 회귀 0 |
| Tab2 BE | `packages/renderer/src/mermaid-renderer.ts` (`buildBeArchitectureDiagram` 재구현) | BE 전용 분기이므로 FE 회귀 0 |
| chunking | `packages/renderer/src/mermaid-renderer.ts` (`buildWithChunkFallback` BE 가드는 v1.2.3에서 적용됨, top-level 패키지 단위 새 chunking 함수 추가) | FE 미영향 |
| elk mrtree | `packages/extension/media/viewer.html` (mermaid init 검토) | mermaid 기본 dagre로 fallback 가능 |
| 테스트 | `packages/renderer/src/mermaid-renderer.test.ts` BE Tab1/2 케이스 갱신 + 회귀 fixture(`mini-spring-deep-pkg-app`) 활용 | snapshot 갱신 필요 |

## 7. 미해결·검토 사항

- **elk mrtree 가용성**: `@mermaid-js/layout-elk` 빌드가 어떤 ELK 알고리즘을 노출하는지 실제 확인 후 적용 가능 여부 결정.
- ~~**leaf endpoint subgraph 가독성**~~: ✅ 해소 (v1.2.57 R-T1.6 amendment) — endpoint를 leaf 노드 안 markdown multiline으로 collapse하여 endpoint 적층 Y축 비대 제거.
- **viewer collapse/expand**: 트리 노드 click으로 자식 패키지 접기/펴기 UX는 v1.2.40 범위 밖. 후속 작업.
