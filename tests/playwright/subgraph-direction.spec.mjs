/**
 * Task1 ST1-2 — mermaid 11.16.0 nested subgraph direction 재실측
 *
 * 배경: mermaid v11(구 11.14.0)에서 "subgraph 안 direction 선언"이
 * 자식 노드가 부모 밖과 edge로 연결된 경우 무시되고 항상 Y축(TB)으로 쌓이는
 * 라이브러리 한계가 있었다(feedback_mermaid_v11_nested_lr_limit 12-candidate 검증).
 * 11.16.0 changelog에 "#4648 respect per-subgraph direction keyword in Dagre layout"
 * fix가 포함돼 있어, 우리 한계의 본체인 #4738(외부 edge 연결 subgraph의 direction 무시)이
 * 같이 해소됐는지 실측 판정한다.
 *
 * Usage: npx playwright test tests/playwright/subgraph-direction.spec.mjs
 */
import { test, expect } from '@playwright/test'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import os from 'os'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const VIEWER_PATH = path.resolve(__dirname, '../../packages/extension/media/viewer.html')
const MERMAID_LOCAL = path.resolve(__dirname, '../../packages/extension/media/mermaid.min.js')

function buildHarness() {
  const template = fs.readFileSync(VIEWER_PATH, 'utf8')
  const withLocalMermaid = template.replace(
    '<script src="https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js"></script>',
    `<script src="file://${MERMAID_LOCAL}"></script>`,
  )
  const tmpPath = path.join(os.tmpdir(), `codebase-viz-subgraph-direction-${Date.now()}-${Math.random().toString(36).slice(2)}.html`)
  fs.writeFileSync(tmpPath, withLocalMermaid, 'utf8')
  return 'file://' + tmpPath
}

async function renderAndGetNodeBoxes(page, diagram, nodeIds) {
  const url = buildHarness(diagram)
  await page.addInitScript((rendering) => {
    window.__CODEBASE_VIZ_DIAGRAMS__ = { rendering, screenComponent: rendering, dbScreen: '' }
    window.__CODEBASE_VIZ_META__ = { projectName: 'Direction-Test', routeCount: 2, tableCount: 0 }
  }, diagram)
  await page.goto(url)
  await page.waitForSelector('#i-r svg', { timeout: 10000 })
  await page.waitForTimeout(500)

  // .node 클래스로 한정 — edgePath id(예: "L_A1_A2_0")가 노드 id 부분문자열을 포함해
  // '[id*="A1"]'만으로는 edge와 node를 구분 못 한다(둘 다 매칭돼 같은 박스를 반환하는 버그 확인됨).
  const boxes = {}
  for (const id of nodeIds) {
    const loc = page.locator('#i-r svg .node').filter({ hasText: new RegExp(`^${id}$`) }).first()
    const box = await loc.boundingBox()
    boxes[id] = box
  }
  return boxes
}

test.describe('Task1 ST1-2 — mermaid 11.16.0 nested subgraph direction 재실측', () => {
  test('#4648 baseline: 외부 edge 없는 subgraph 내부 direction LR', async ({ page }) => {
    // A1--A2 edge 필수 — dagre는 랭크를 edge로 결정한다. edge 없는 두 노드는
    // direction과 무관하게 삽입 순서로 배치될 수 있어 direction 반영 여부를 판별 못 한다.
    const diagram = [
      'graph TD',
      '  subgraph PARENT[Parent]',
      '    direction LR',
      '    A1[A1]',
      '    A2[A2]',
      '    A1 --> A2',
      '  end',
    ].join('\n')

    const boxes = await renderAndGetNodeBoxes(page, diagram, ['A1', 'A2'])
    expect(boxes.A1, 'A1 노드가 렌더링돼야 한다').not.toBeNull()
    expect(boxes.A2, 'A2 노드가 렌더링돼야 한다').not.toBeNull()

    const dy = Math.abs(boxes.A1.y - boxes.A2.y)
    const dx = Math.abs(boxes.A1.x - boxes.A2.x)
    console.log(`[#4648 baseline] A1=(${boxes.A1.x.toFixed(0)},${boxes.A1.y.toFixed(0)}) A2=(${boxes.A2.x.toFixed(0)},${boxes.A2.y.toFixed(0)}) dx=${dx.toFixed(0)} dy=${dy.toFixed(0)}`)

    // 11.16.0 실측 확정 동작 — 외부edge 없는 단순 subgraph는 direction LR을 존중한다(개선됨).
    // 향후 mermaid 버전에서 이게 깨지면(=회귀) 이 assertion이 잡는다.
    expect(dx, '#4648: 외부edge 없는 단순 subgraph는 LR 존중(가로 배치)돼야 한다').toBeGreaterThan(50)
    expect(dy, '#4648: 외부edge 없는 단순 subgraph는 세로 어긋남이 없어야 한다').toBeLessThan(20)
  })

  test('#4738 본체: 외부 edge 연결된 subgraph 내부 direction LR — 우리 한계의 핵심 케이스', async ({ page }) => {
    // mermaid 공식 한계 문구: "If any of a subgraph's NODES are linked to the outside,
    // subgraph direction will be ignored." — subgraph 컨테이너 자체가 아니라 내부 자식
    // 노드(B1)를 직접 겨냥해야 실제 한계 재현이다(컨테이너만 겨냥한 최초 버전은 무효 재현이었음).
    const diagram = [
      'graph LR',
      '  EXT[External] --> B1',
      '  subgraph PARENT[Parent]',
      '    direction LR',
      '    B1[B1]',
      '    B2[B2]',
      '    B1 --> B2',
      '  end',
    ].join('\n')

    const boxes = await renderAndGetNodeBoxes(page, diagram, ['B1', 'B2'])
    expect(boxes.B1, 'B1 노드가 렌더링돼야 한다').not.toBeNull()
    expect(boxes.B2, 'B2 노드가 렌더링돼야 한다').not.toBeNull()

    const dy = Math.abs(boxes.B1.y - boxes.B2.y)
    const dx = Math.abs(boxes.B1.x - boxes.B2.x)
    console.log(`[#4738 core] B1=(${boxes.B1.x.toFixed(0)},${boxes.B1.y.toFixed(0)}) B2=(${boxes.B2.x.toFixed(0)},${boxes.B2.y.toFixed(0)}) dx=${dx.toFixed(0)} dy=${dy.toFixed(0)}`)

    // 11.16.0 실측 확정 동작 — 외부edge가 내부 자식 노드를 직접 겨냥해도(단일 레벨 subgraph
    // 한정) direction LR을 존중한다(개선됨). 아래 nested subgraph-of-subgraph 케이스와는
    // 결과가 다르므로 각각 별도로 고정한다.
    expect(dx, '#4738(단일레벨): 외부edge가 자식을 직접 겨냥해도 LR 존중돼야 한다').toBeGreaterThan(50)
    expect(dy, '#4738(단일레벨): 세로 어긋남이 없어야 한다').toBeLessThan(20)
  })

  test('#4738 진짜 본체: nested subgraph-of-subgraph(우리 렌더러 실제 구조) + 외부 edge', async ({ page }) => {
    // feedback_mermaid_v11_nested_lr_limit이 실제로 실패 재현한 구조는 "플레인 노드가 든
    // 단일 subgraph"가 아니라 "subgraph 안에 subgraph들이 중첩"된 형태다(BE Tab1 패키지 트리,
    // FE Tab1 도메인 트리와 동일 구조). 위 #4738 테스트(B1/B2 plain node)는 이 구조를 재현하지
    // 않으므로 별도로 검증한다.
    const diagram = [
      'graph LR',
      '  EXT[External] --> D1',
      '  subgraph PARENT[Parent]',
      '    direction LR',
      '    subgraph CHILD_A[Child A]',
      '      D1[D1]',
      '    end',
      '    subgraph CHILD_B[Child B]',
      '      D2[D2]',
      '    end',
      '  end',
    ].join('\n')

    const boxes = await renderAndGetNodeBoxes(page, diagram, ['D1', 'D2'])
    expect(boxes.D1, 'D1 노드가 렌더링돼야 한다').not.toBeNull()
    expect(boxes.D2, 'D2 노드가 렌더링돼야 한다').not.toBeNull()

    const dy = Math.abs(boxes.D1.y - boxes.D2.y)
    const dx = Math.abs(boxes.D1.x - boxes.D2.x)
    console.log(`[#4738 nested-subgraph] D1=(${boxes.D1.x.toFixed(0)},${boxes.D1.y.toFixed(0)}) D2=(${boxes.D2.x.toFixed(0)},${boxes.D2.y.toFixed(0)}) dx=${dx.toFixed(0)} dy=${dy.toFixed(0)}`)

    // 11.16.0 실측 확정: 우리 렌더러 실제 구조(subgraph-of-subgraph)에서는 여전히 Y축 강제
    // — #4738 미해소. 이 assertion은 "알려진 한계가 아직 존재함"을 고정한다(known-limitation
    // regression guard). 향후 mermaid 버전에서 이 테스트가 FAIL하면 = 한계가 드디어 해소된 것
    // → FE-DIAGRAM-STANDARD.md R-T1.2(top-level 형제만 X축 보장) amendment를 재검토할 신호.
    expect(dy, '#4738(nested): 알려진 한계 — 중첩 subgraph는 여전히 Y축 강제 예상. FAIL 시 한계 해소 신호').toBeGreaterThan(50)
    expect(dx, '#4738(nested): 알려진 한계 — X축 배치 안 됨 예상. FAIL 시 한계 해소 신호').toBeLessThan(20)
  })

  test('현행 우회 회귀: top-level 형제 subgraph ~~~ invisible chain', async ({ page }) => {
    const diagram = [
      'graph LR',
      '  subgraph DOMAIN_A[Domain A]',
      '    C1[C1]',
      '    C1b[C1b]',
      '    C1 --> C1b',
      '  end',
      '  subgraph DOMAIN_B[Domain B]',
      '    C2[C2]',
      '  end',
      '  DOMAIN_A ~~~ DOMAIN_B',
    ].join('\n')

    const boxes = await renderAndGetNodeBoxes(page, diagram, ['C1', 'C2'])
    expect(boxes.C1, 'C1 노드가 렌더링돼야 한다').not.toBeNull()
    expect(boxes.C2, 'C2 노드가 렌더링돼야 한다').not.toBeNull()

    const dx = Math.abs(boxes.C1.x - boxes.C2.x)
    console.log(`[workaround regression] C1=(${boxes.C1.x.toFixed(0)},${boxes.C1.y.toFixed(0)}) C2=(${boxes.C2.x.toFixed(0)},${boxes.C2.y.toFixed(0)}) dx=${dx.toFixed(0)}`)

    // 표준 R-T1.2가 보장하는 유일한 계약: top-level 형제는 X축 배치. 11.16.0에서도 유지돼야 한다.
    expect(dx, 'top-level 형제 subgraph는 X축(가로)으로 배치돼야 한다 — 현행 표준(R-T1.2) 유지 확인').toBeGreaterThan(50)
  })
})
