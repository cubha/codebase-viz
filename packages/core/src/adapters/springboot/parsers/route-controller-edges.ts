import {
  createEdge,
  makeEdgeId,
  type IREdge,
  type RouteNode,
  type ComponentNode,
} from '@codebase-viz/types'

// be/leaf.ts isBeController와 동일 컨벤션(파일명 아닌 클래스명 suffix) — core는 renderer를
// import할 수 없어(계층 분리) 최소 형태로 복제. 두 곳이 갈리면 렌더링과 IR 관계가 어긋나므로
// 컨벤션 변경 시 양쪽 동시 수정 필요.
function isControllerComponent(name: string): boolean {
  return name.endsWith('Controller')
}

// C2(BE-DIAGRAM-STANDARD v1.2): RouteNode가 어느 Controller 컴포넌트에 속하는지는 지금까지
// filePath 일치로 렌더러가 암묵적으로만 그려왔다(그래프에 질의 가능한 관계가 없었음). 같은
// 파일에서 파싱된 RouteNode + Controller-suffix ComponentNode는 1:1로 대응하므로 filePath
// 정확 일치만으로 충분히 verified.
export function buildControllerRouteEdges(
  routes: RouteNode[],
  components: ComponentNode[],
): IREdge[] {
  if (routes.length === 0 || components.length === 0) return []

  const controllerByFilePath = new Map<string, ComponentNode>()
  for (const c of components) {
    if (!isControllerComponent(c.name)) continue
    if (!controllerByFilePath.has(c.filePath)) controllerByFilePath.set(c.filePath, c)
  }

  const edges: IREdge[] = []
  for (const route of routes) {
    const controller = controllerByFilePath.get(route.filePath)
    if (controller === undefined) continue
    edges.push(
      createEdge({
        id: makeEdgeId('handles', route.id, controller.id),
        from: route.id,
        to: controller.id,
        kind: 'handles',
        provenance: route.provenance,
        confidence: 'verified',
      }),
    )
  }
  return edges
}
