// 임시 시각 검증 하네스. 분석 결과 .md → viewer.html에 cache.json 인라인 → HTTP server(ELK ESM 로드 필요) → Playwright.
// 사용: node scripts/render-harness.mjs <md-input-dir> <out-prefix>
//   예: node scripts/render-harness.mjs /tmp/partner-out /tmp/partner-shot
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

const [,, inputDir = '/tmp/partner-out', outPrefix = '/tmp/partner-shot'] = process.argv

function extractMermaid(mdPath) {
  if (!fs.existsSync(mdPath)) return ''
  const md = fs.readFileSync(mdPath, 'utf8')
  const m = md.match(/```mermaid\n([\s\S]*?)\n```/)
  return m ? m[1] : ''
}

// T4: sequence.md는 CLI가 emit하지 않는 페어(FE+BE) 전용 산출물이라 옵셔널 — 없으면 기존
// 3탭(single-project .md 산출물) 검증과 바이트 단위로 동일하게 동작한다.
const sequenceMd = path.join(inputDir, 'sequence.md')
const hasSequence = fs.existsSync(sequenceMd)

const diagrams = {
  rendering: extractMermaid(path.join(inputDir, 'rendering.md')),
  screenComponent: extractMermaid(path.join(inputDir, 'screen-component.md')),
  dbScreen: extractMermaid(path.join(inputDir, 'db-screen.md')),
  ...(hasSequence ? { sequence: extractMermaid(sequenceMd) } : {}),
}

const EN_DICT = {
  'legend.ssr': 'SSR · Server Rendering', 'legend.csr': 'CSR · Client Rendering',
  'legend.isr': 'ISR · Incremental Regen', 'legend.ssg': 'SSG · Static Generation',
  'legend.inferred': 'inferred (LLM)', 'legend.feBe': 'FE→BE connection (dashed)',
  'db.view.label': 'View', 'db.view.all': 'All', 'db.view.fk': 'FK Relations',
  'db.view.routes': 'Page Queries', 'db.view.actions': 'Server Actions',
  'db.sidebar.tables': 'Tables',
  'tab.rendering': 'Rendering Architecture', 'tab.screenComponent': 'Screen–Component', 'tab.dbScreen': 'DB–Screen', 'tab.sequence': 'Sequence',
  'status.rendering': 'Rendering...', 'status.loading': 'Loading...', 'status.noTables': 'No tables',
  'status.noData': 'No data', 'status.noDbData': 'No DB data', 'status.analyzing': 'analyzing...',
  'alert.noDiagram': 'No diagram data.', 'alert.svgFailed': 'SVG generation failed',
  'alert.pngFailed': 'PNG generation failed', 'alert.imageLoadFailed': 'Image load failed',
  'alert.renderError': 'Render error', 'chunk.suffix': 'wheel zoom · drag pan',
  'card.fk': 'FK', 'card.usedBy': 'Used by',
}

const HARNESS_DIR = path.join('/tmp', 'render-harness')
fs.mkdirSync(HARNESS_DIR, { recursive: true })
fs.copyFileSync(MERMAID_LOCAL, path.join(HARNESS_DIR, 'mermaid.min.js'))

const meta = { projectName: path.basename(inputDir), routeCount: 21, tableCount: 12, cachedAt: Date.now(), isPair: hasSequence }
const seed = `<script>
  window.__CODEBASE_VIZ_META__ = ${JSON.stringify(meta)};
  window.__CODEBASE_VIZ_DIAGRAMS__ = ${JSON.stringify(diagrams)};
  window.__CODEBASE_VIZ_I18N__ = ${JSON.stringify(EN_DICT)};
</script>`
const html = fs.readFileSync(VIEWER_HTML, 'utf8')
  .replace('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js', './mermaid.min.js')
  .replace('<body>', '<body>\n' + seed)
fs.writeFileSync(path.join(HARNESS_DIR, 'viewer.html'), html)

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' }
const server = http.createServer((req, res) => {
  const url = req.url === '/' ? '/viewer.html' : req.url.split('?')[0]
  // req.url은 Node가 `..`를 정규화하지 않은 raw 값이고 path.join은 베이스로 클램프하지 않는다 —
  // `GET /../../etc/passwd`가 HARNESS_DIR 밖 파일을 그대로 응답한다. resolve 후 접두사 검사로 가둔다.
  const f = path.resolve(HARNESS_DIR, '.' + url)
  if (f !== HARNESS_DIR && !f.startsWith(HARNESS_DIR + path.sep)) { res.statusCode = 403; res.end('forbidden'); return }
  if (!fs.existsSync(f) || !fs.statSync(f).isFile()) { res.statusCode = 404; res.end('not found'); return }
  res.setHeader('Content-Type', MIME[path.extname(f)] ?? 'application/octet-stream')
  res.end(fs.readFileSync(f))
})
// host를 생략하면 Node가 모든 인터페이스(0.0.0.0/::)에 바인딩한다 — 같은 네트워크의 다른 호스트가
// harness 실행 중 접근할 수 있다. 이 서버는 로컬 Playwright 전용이라 loopback으로 못박는다.
await new Promise((r) => server.listen(0, '127.0.0.1', r))
const port = server.address().port
console.log('[server] http://127.0.0.1:' + port)

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await ctx.newPage()

const consoleErrors = []
const consoleAll = []
page.on('console', (msg) => { consoleAll.push(`[${msg.type()}] ${msg.text()}`); if (msg.type() === 'error') consoleErrors.push(msg.text()) })
page.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message))

await page.goto('http://127.0.0.1:' + port + '/viewer.html')
await page.waitForTimeout(5000)

const tabs = [['r', 'tab1-rendering'], ['s', 'tab2-screen'], ['d', 'tab3-db']]
if (hasSequence) tabs.push(['q', 'tab4-sequence'])
for (const [tab, key] of tabs) {
  await page.click(`.tab[data-t="${tab}"]`)
  await page.waitForTimeout(3000)
  const shot = `${outPrefix}-${key}.png`
  await page.screenshot({ path: shot, fullPage: false })
  console.log('[shot]', shot)
}

if (consoleErrors.length > 0) {
  console.log('--- console errors ---')
  for (const e of consoleErrors) console.log(' ', e)
}
const elkLog = consoleAll.filter((l) => /ELK|elk/i.test(l))
if (elkLog.length > 0) {
  console.log('--- elk log ---')
  for (const e of elkLog) console.log(' ', e)
}

await browser.close()
server.close()
console.log('done')
