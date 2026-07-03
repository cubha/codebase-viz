// v1.2.52 viewer perf 측정 하니스. 대형 다중청크 입력에서 viewer.html의
// time-to-first-row / time-to-all-rendered / scroll jank proxy를 측정한다.
// before/after 동일 스크립트로 재사용 → 개선 delta 산출.
// 사용: node scripts/viewer-perf.mjs [chunkCount] [label]
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as http from 'node:http'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const MEDIA = path.join(ROOT, 'packages/extension/media')
const VIEWER_HTML = path.join(MEDIA, 'viewer.html')
const MERMAID_LOCAL = path.join(MEDIA, 'mermaid.min.js')
const CHUNK_SEP = '%%--CHUNK--%%'

const [, , chunkCountArg = '22', label = 'baseline'] = process.argv
const CHUNK_COUNT = parseInt(chunkCountArg, 10)

// 청크당 ~50 route (CHUNK_ROUTE_BUDGET). 22 chunk ≈ 1100 route — 사용자 1112 보고와 동일 스케일.
function buildMultiChunkDiagram(chunkCount, routesPerChunk = 50) {
  const chunks = []
  for (let i = 0; i < chunkCount; i++) {
    const offset = i * routesPerChunk
    const rows = []
    rows.push(`%%{init:{'theme':'base','themeVariables':{'background':'#060810','primaryColor':'#0c1a30','primaryTextColor':'#94a3b8','lineColor':'#334155','fontFamily':'monospace'}}}%%`)
    rows.push('graph LR')
    rows.push(`  subgraph G${i}["Domain ${i + 1}"]`)
    for (let j = 0; j < routesPerChunk; j++) {
      rows.push(`    R${offset + j}["/api/v${i}/resource${j}/detail"]`)
    }
    rows.push('  end')
    // 청크 내부에 약간의 엣지 → dagre 레이아웃 비용 현실화
    for (let j = 1; j < routesPerChunk; j += 7) {
      rows.push(`  R${offset} --> R${offset + j}`)
    }
    chunks.push(rows.join('\n'))
  }
  return chunks.join('\n' + CHUNK_SEP + '\n')
}

const diagram = buildMultiChunkDiagram(CHUNK_COUNT)

const EN_DICT = {
  'legend.ssr': 'SSR', 'legend.csr': 'CSR', 'legend.isr': 'ISR', 'legend.ssg': 'SSG',
  'legend.inferred': 'inferred', 'legend.feBe': 'FE→BE',
  'db.view.label': 'View', 'db.view.all': 'All', 'db.view.fk': 'FK',
  'db.view.routes': 'Pages', 'db.view.actions': 'Actions', 'db.sidebar.tables': 'Tables',
  'tab.rendering': 'Rendering', 'tab.screenComponent': 'Screen', 'tab.dbScreen': 'DB',
  'status.rendering': 'Rendering...', 'status.loading': 'Loading...', 'status.noTables': 'No tables',
  'status.noData': 'No data', 'status.noDbData': 'No DB data', 'status.analyzing': 'analyzing...',
  'alert.renderError': 'Render error', 'chunk.suffix': 'wheel zoom · drag pan',
  'card.fk': 'FK', 'card.usedBy': 'Used by',
}

const HARNESS_DIR = path.join('/tmp', 'viewer-perf-harness')
fs.mkdirSync(HARNESS_DIR, { recursive: true })
fs.copyFileSync(MERMAID_LOCAL, path.join(HARNESS_DIR, 'mermaid.min.js'))

const meta = { projectName: 'perf-' + label, routeCount: CHUNK_COUNT * 50, tableCount: 0 }
// 페이지 로드 즉시 perf 관측자 설치 — .row-diagram에 svg가 처음 붙는 시점/전부 붙는 시점 기록.
const perfSeed = `<script>
  window.__CODEBASE_VIZ_META__ = ${JSON.stringify(meta)};
  window.__CODEBASE_VIZ_DIAGRAMS__ = ${JSON.stringify({ rendering: diagram, screenComponent: '', dbScreen: '' })};
  window.__CODEBASE_VIZ_I18N__ = ${JSON.stringify(EN_DICT)};
  window.__PERF = { firstRow: null, lastRow: null, count: 0 };
  (function(){
    var mo = new MutationObserver(function(){
      var rows = document.querySelectorAll('#i-r .row-diagram');
      rows.forEach(function(row){
        if (!row.__timed && row.querySelector('svg')) {
          row.__timed = true;
          var t = performance.now();
          window.__PERF.count++;
          if (window.__PERF.firstRow === null) window.__PERF.firstRow = t;
          window.__PERF.lastRow = t;
        }
      });
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  })();
</script>`
const html = fs.readFileSync(VIEWER_HTML, 'utf8')
  .replace('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js', './mermaid.min.js')
  .replace('<body>', '<body>\n' + perfSeed)
fs.writeFileSync(path.join(HARNESS_DIR, 'viewer.html'), html)

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript' }
const server = http.createServer((req, res) => {
  const url = req.url === '/' ? '/viewer.html' : req.url.split('?')[0]
  const f = path.join(HARNESS_DIR, url)
  if (!fs.existsSync(f)) { res.statusCode = 404; res.end('not found'); return }
  res.setHeader('Content-Type', MIME[path.extname(f)] ?? 'application/octet-stream')
  res.end(fs.readFileSync(f))
})
await new Promise((r) => server.listen(0, r))
const port = server.address().port

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await ctx.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))

await page.goto('http://localhost:' + port + '/viewer.html')

// 모든 청크 렌더 완료까지 대기 (count === CHUNK_COUNT 또는 타임아웃 30s)
await page.waitForFunction(
  (n) => window.__PERF && window.__PERF.count >= n,
  CHUNK_COUNT,
  { timeout: 30000 },
).catch(() => {})

const timing = await page.evaluate(() => ({
  firstRow: window.__PERF.firstRow,
  lastRow: window.__PERF.lastRow,
  count: window.__PERF.count,
}))

// Jank proxy: 스크롤을 반복하며 rAF 프레임 간격 샘플링 → 최장 프레임/드롭 프레임.
const jank = await page.evaluate(async () => {
  const wrap = document.getElementById('w-r')
  const frames = []
  let last = performance.now()
  let running = true
  function loop() {
    const now = performance.now()
    frames.push(now - last)
    last = now
    if (running) requestAnimationFrame(loop)
  }
  requestAnimationFrame(loop)
  // 1.2s 동안 스크롤 왕복 (off-screen 청크 페인트 유발)
  const t0 = performance.now()
  while (performance.now() - t0 < 1200) {
    wrap.scrollTop = (wrap.scrollTop + 220) % Math.max(1, wrap.scrollHeight - wrap.clientHeight)
    await new Promise((r) => requestAnimationFrame(r))
  }
  running = false
  await new Promise((r) => requestAnimationFrame(r))
  const sorted = frames.slice(1).sort((a, b) => a - b)
  const max = sorted[sorted.length - 1] || 0
  const p95 = sorted[Math.floor(sorted.length * 0.95)] || 0
  const dropped = sorted.filter((d) => d > 32).length // >2 frame (60fps 기준 16.7ms)
  return { maxFrameMs: +max.toFixed(1), p95FrameMs: +p95.toFixed(1), droppedFrames: dropped, samples: sorted.length }
})

await browser.close()
server.close()

const out = {
  label,
  chunks: CHUNK_COUNT,
  routes: CHUNK_COUNT * 50,
  timeToFirstRowMs: timing.firstRow !== null ? +timing.firstRow.toFixed(0) : null,
  timeToAllRenderedMs: timing.lastRow !== null ? +timing.lastRow.toFixed(0) : null,
  renderedRows: timing.count,
  jank,
  errors,
}
console.log(JSON.stringify(out, null, 2))
