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

const diagrams = {
  rendering: extractMermaid(path.join(inputDir, 'rendering.md')),
  screenComponent: extractMermaid(path.join(inputDir, 'screen-component.md')),
  dbScreen: extractMermaid(path.join(inputDir, 'db-screen.md')),
}

const EN_DICT = {
  'legend.ssr': 'SSR · Server Rendering', 'legend.csr': 'CSR · Client Rendering',
  'legend.isr': 'ISR · Incremental Regen', 'legend.ssg': 'SSG · Static Generation',
  'legend.inferred': 'inferred (LLM)', 'legend.feBe': 'FE→BE connection (dashed)',
  'db.view.label': 'View', 'db.view.all': 'All', 'db.view.fk': 'FK Relations',
  'db.view.routes': 'Page Queries', 'db.view.actions': 'Server Actions',
  'db.sidebar.tables': 'Tables',
  'tab.rendering': 'Rendering Architecture', 'tab.screenComponent': 'Screen–Component', 'tab.dbScreen': 'DB–Screen',
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

const meta = { projectName: path.basename(inputDir), routeCount: 21, tableCount: 12, cachedAt: Date.now() }
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
  const f = path.join(HARNESS_DIR, url)
  if (!fs.existsSync(f)) { res.statusCode = 404; res.end('not found'); return }
  res.setHeader('Content-Type', MIME[path.extname(f)] ?? 'application/octet-stream')
  res.end(fs.readFileSync(f))
})
await new Promise((r) => server.listen(0, r))
const port = server.address().port
console.log('[server] http://localhost:' + port)

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } })
const page = await ctx.newPage()

const consoleErrors = []
const consoleAll = []
page.on('console', (msg) => { consoleAll.push(`[${msg.type()}] ${msg.text()}`); if (msg.type() === 'error') consoleErrors.push(msg.text()) })
page.on('pageerror', (err) => consoleErrors.push('PAGEERROR: ' + err.message))

await page.goto('http://localhost:' + port + '/viewer.html')
await page.waitForTimeout(5000)

for (const [tab, key] of [['r', 'tab1-rendering'], ['s', 'tab2-screen'], ['d', 'tab3-db']]) {
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
