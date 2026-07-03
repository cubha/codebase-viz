// viewer.html을 헤드리스 chromium으로 띄워 시나리오 인터랙션 후 GIF 생성.
// 캐시 데이터 시드 → 시나리오별 frame 캡처 → ffmpeg palettegen + paletteuse → GIF.
// 사용 fixture: fixtures/mini-next-app 분석 결과 (CLI로 사전 생성 가능, 또는 사용자 캐시).
import { chromium } from 'playwright'
import { spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import ffmpegPath from 'ffmpeg-static'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const MEDIA = path.join(ROOT, 'media')
const TMP = path.join(ROOT, '.gif-tmp')

// 시연용 데이터: extension cache.json (분석 결과). 실제 프로젝트 규모로 풍성한 다이어그램.
const CACHE_PATH = process.env.GIF_CACHE_PATH ?? '/mnt/d/workspace/dev-log-portfolio/.codebase-viz/cache.json'

const VIEWER_HTML = path.join(MEDIA, 'viewer.html')
const MERMAID_LOCAL = path.join(MEDIA, 'mermaid.min.js')

function loadCache() {
  if (!fs.existsSync(CACHE_PATH)) {
    console.error(`Cache not found: ${CACHE_PATH}\nSet GIF_CACHE_PATH or run extension analyze.`)
    process.exit(1)
  }
  return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8'))
}

fs.mkdirSync(TMP, { recursive: true })
// HTTP server 대신 file:// 차단 회피용 inline data: URI나 임시 dir 사용
const HARNESS_DIR = path.join(TMP, 'harness')
fs.mkdirSync(HARNESS_DIR, { recursive: true })

// viewer.html을 harness dir에 복사하면서 mermaid CDN을 로컬 경로로 치환 + 캐시 시드
// 영문 dict 인라인 (build script가 dist에 의존 안 하도록)
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

function buildHarness() {
  const cache = loadCache()
  const html = fs.readFileSync(VIEWER_HTML, 'utf8')
  const seed = `<script>
  window.__CODEBASE_VIZ_META__ = ${JSON.stringify({ projectName: cache.projectName, routeCount: cache.routeCount, tableCount: cache.tableCount, cachedAt: cache.savedAt })};
  window.__CODEBASE_VIZ_DIAGRAMS__ = ${JSON.stringify(cache.diagrams)};
  window.__CODEBASE_VIZ_I18N__ = ${JSON.stringify(EN_DICT)};
</script>`
  // mermaid CDN → 로컬 (chromium은 file://에서 외부 cdn 가능하지만 안정성 위해)
  fs.copyFileSync(MERMAID_LOCAL, path.join(HARNESS_DIR, 'mermaid.min.js'))
  const out = html
    .replace('https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js', './mermaid.min.js')
    .replace('<body>', '<body>\n' + seed)
  const harnessPath = path.join(HARNESS_DIR, 'viewer.html')
  fs.writeFileSync(harnessPath, out)
  return harnessPath
}

async function captureFrames(scenarioName, scenarioFn, framesDir, frameCount = 60, intervalMs = 100, setupFn) {
  const harnessPath = buildHarness()
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 850 } })
  const page = await ctx.newPage()
  await page.goto('file://' + harnessPath)
  await page.waitForTimeout(2000) // mermaid render 시간

  // setupFn: 캡처 시작 전 setup (예: Tab3 미리 이동) — 첫 프레임이 시나리오 컨텍스트로 시작.
  if (setupFn) {
    await setupFn(page)
    await page.waitForTimeout(1500)
  }

  fs.rmSync(framesDir, { recursive: true, force: true })
  fs.mkdirSync(framesDir, { recursive: true })

  const captureLoop = (async () => {
    for (let i = 0; i < frameCount; i++) {
      await page.screenshot({ path: path.join(framesDir, `f${String(i).padStart(4, '0')}.png`) })
      await page.waitForTimeout(intervalMs)
    }
  })()
  await scenarioFn(page)
  await captureLoop
  await browser.close()
  console.log(`[${scenarioName}] captured ${frameCount} frames @ ${intervalMs}ms`)
}

async function buildGif(framesDir, outPath, fps = 12, scale = 900) {
  const palette = path.join(framesDir, 'palette.png')
  // palettegen
  const r1 = spawnSync(ffmpegPath, [
    '-y', '-framerate', String(fps), '-i', path.join(framesDir, 'f%04d.png'),
    '-vf', `fps=${fps},scale=${scale}:-1:flags=lanczos,palettegen=stats_mode=diff`,
    palette,
  ], { stdio: 'inherit' })
  if (r1.status !== 0) throw new Error('palettegen failed')
  // paletteuse
  const r2 = spawnSync(ffmpegPath, [
    '-y', '-framerate', String(fps), '-i', path.join(framesDir, 'f%04d.png'), '-i', palette,
    '-lavfi', `fps=${fps},scale=${scale}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
    outPath,
  ], { stdio: 'inherit' })
  if (r2.status !== 0) throw new Error('paletteuse failed')
  const sizeKB = (fs.statSync(outPath).size / 1024).toFixed(1)
  console.log(`[gif] ${outPath} (${sizeKB} KB)`)
}

// ── 시나리오 ──────────────────────────────────────────────────────────────────

// 시나리오 1: Hero — Tab1 zoom out으로 전체 노드 → Tab2 전환 → Tab2 zoom out으로 전체 노드
async function scenarioHero(page) {
  // Tab1 fitToView 적용 후 1초 정적
  await page.waitForTimeout(1000)
  // Tab1 zoom out: wheel down 6회 (각 0.9배 → 누적 약 0.53배)
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.zm && window.zm('r', 0.9))
    await page.waitForTimeout(180)
  }
  // 전체 노드 보이는 상태 정적
  await page.waitForTimeout(1500)
  // Tab2 전환
  await page.click('.tab[data-t="s"]')
  // Tab2 mermaid render + fitToView 대기
  await page.waitForTimeout(2200)
  // Tab2 zoom out 6회
  for (let i = 0; i < 6; i++) {
    await page.evaluate(() => window.zm && window.zm('s', 0.9))
    await page.waitForTimeout(180)
  }
  // 전체 노드 보이는 상태 정적
  await page.waitForTimeout(1500)
}

// 시나리오 2: DB toggle — Tab3에서 4-button 토글 클릭 (Tab3는 setup에서 미리 이동)
async function setupDbToggle(page) {
  await page.click('.tab[data-t="d"]')
}
async function scenarioDbToggle(page) {
  await page.waitForTimeout(500)
  const buttons = ['fk', 'routes', 'actions', 'all']
  for (const v of buttons) {
    await page.click(`[data-v="${v}"]`)
    await page.waitForTimeout(1300)
  }
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const scenario = process.argv[2] ?? 'all'
  if (scenario === 'hero' || scenario === 'all') {
    const dir = path.join(TMP, 'hero-frames')
    // 시나리오 ~9s: Tab1 정적1s + zoom-out 1.1s + 정적1.5s + Tab2 click+render 2.2s + zoom-out 1.1s + 정적1.5s
    await captureFrames('hero', scenarioHero, dir, 75, 125)
    await buildGif(dir, path.join(MEDIA, 'demo-tab-switch.gif'), 8, 900)
  }
  if (scenario === 'db' || scenario === 'all') {
    const dir = path.join(TMP, 'db-frames')
    await captureFrames('db-toggle', scenarioDbToggle, dir, 55, 120, setupDbToggle)
    await buildGif(dir, path.join(MEDIA, 'demo-db-toggle.gif'), 12, 900)
  }
  console.log('done')
}

main().catch(err => { console.error(err); process.exit(1) })
