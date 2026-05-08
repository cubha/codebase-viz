# Changelog

## [1.1.1] — 2026-05-08

### Bug Fixes

**A group — WINA-APP-FE 분석 가능화 (차단 해제)**

- **Fix #3 — stack-detector 우선순위**: `vite+react` 감지가 `react-router-dom` 감지를 가로채던 문제 수정. `vite+react+react-router-dom` 조합이 이제 react-router 어댑터로 올바르게 분류됩니다.
- **Fix #5 — vite-react phantom adapterId**: 라우터 라이브러리가 없는 순수 SPA에 한해 `adapterId: undefined`로 정확히 처리. LLM OFF 상태에서 분석 시 silent empty 대신 명시적 에러 메시지를 출력합니다.
- **Fix #4 — JSX `<Routes>` 파서**: react-router v6의 JSX 패턴(`<BrowserRouter>` + `<Routes>` + `<Route>`) 정적 파서 추가. 평면/nested/index/catch-all Route 4가지 패턴을 모두 지원합니다.

**B group — 대규모 라우트 가독성 (품질 개선)**

- **Fix #1 — Multi-level 재귀 그룹핑**: `groupRoutesByUrl()` 재귀 nested 트리(`NestedGroup`) 구조로 전환. 934 라우트 규모 프로젝트에서 `/api → /v1 → /partner → ...` 형태로 깊이 중첩된 Mermaid `subgraph`가 생성됩니다. `maxDepth: 8`, `minGroupSize: 3` stop 조건으로 무한 재귀를 방지합니다.
- **Fix #2 — 노드 수 기반 chunk 트리거**: `shouldChunk()` 에 `nodeCount` / `nodeThreshold`(기본 100) 조건 추가. 1M자 미만이더라도 라우트가 100개를 초과하면 chunk 분할이 발생합니다.

**C group — 대규모 다이어그램 가독성 (UX 개선)**

- **Fix #6 — 행 기반 그리드 레이아웃**: LCP(최장공통접두사) 이후 최초 분기 지점을 자동 탐지하고 하위 그룹을 5개 단위로 행 배치합니다. `/api/v1` 하나로 수렴하는 934-라우트 규모 BE 프로젝트에서도 가로 폭 폭발 없이 다이어그램이 표시됩니다. Tab1·Tab2·Tab3 모두 적용.
- **Fix #7 — 전체 컬럼 ERD 표시**: DB 스키마 컬럼의 묵시적 8개 절단(slice)을 제거. ERD 다이어그램과 사이드바에서 테이블의 모든 컬럼이 표시됩니다.
- **Fix #8 — 멀티행 뷰어**: 다중 행 다이어그램을 동시에 표시하는 스택 뷰로 전환. 각 행 SVG를 컨테이너 너비에 맞게 자동 스케일하며 수직 스크롤로 탐색합니다.

### Other Changes

- `ANALYZER_VERSION` 상수를 `'codebase-viz@1.1.1'`로 업데이트 — v1.1.0 이전 캐시(`.codesight/cache.json`)가 있는 프로젝트에서 자동 무효화 후 재분석이 트리거됩니다.

> **캐시 주의**: LLM 분석 결과가 캐시된 프로젝트는 v1.1.1 최초 실행 시 재분석이 발생합니다. LLM API Key 설정이 되어 있으면 LLM 비용이 재발생할 수 있습니다.

---

## [1.1.0] — 2025-04-15

### New Features

- **13번째 프레임워크 지원**: Next.js Pages Router (`pages/` 디렉터리) 어댑터 추가
- **FE↔BE 멀티프로젝트 URL 매칭**: `fetch()` / `axios.*` 호출 URL을 BE 라우트와 정적 매칭, 결합 다이어그램에 점선 cross-edge 표시
- **Tab1 URL 계층 그룹핑**: `groupRoutesByUrl()` 도입으로 동일 prefix 라우트를 Mermaid `subgraph`로 묶어 표시
- **Flyway DDL 파서**: Spring Boot 프로젝트의 Flyway 마이그레이션 파일에서 테이블 스키마 추출

---

## [1.0.0] — 2025-03-01

### Initial Release

- 12개 프레임워크 정적 분석 (Next.js App Router, Nuxt, SvelteKit, NestJS, Django, FastAPI, Flask, Spring Boot, Vue SPA, Angular, Remix, React Router)
- 3-tab Mermaid 다이어그램 (Rendering Architecture / Screen–Component / DB–Screen)
- Supabase, Prisma, Drizzle, TypeORM, SQLAlchemy, JPA ORM 파서
- LLM 선택적 보강 (Claude claude-sonnet-4-6)
