import * as vscode from 'vscode'
import * as crypto from 'node:crypto'
import { t, resolveLocale, dictForLocale } from './i18n/dict.js'

function getLocale() {
  const setting = vscode.workspace.getConfiguration('codebaseViz').get<string>('language', 'auto')
  return resolveLocale(setting, vscode.env.language)
}

export class PanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codebaseViz.panelView'
  private _view?: vscode.WebviewView
  private _logs: string[] = []

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView
    webviewView.webview.options = { enableScripts: true }
    webviewView.webview.html = this._getHtml()
    this._flushLogs()
  }

  public log(message: string): void {
    const ts = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    this._logs.push(`[${ts}] ${message}`)
    if (this._logs.length > 200) this._logs.shift()
    this._view?.webview.postMessage({ type: 'log', message, ts })
  }

  public setAnalyzing(analyzing: boolean, projectName?: string): void {
    this._view?.webview.postMessage({ type: 'state', analyzing, projectName })
    if (analyzing) this.log(t('panel.analyzing', getLocale()))
  }

  public setResult(info: { projectName: string; routeCount: number; tableCount: number; cachedAt: number }): void {
    this._view?.webview.postMessage({ type: 'result', ...info })
    this.log(t('panel.complete', getLocale(), { routes: info.routeCount, tables: info.tableCount }))
  }

  private _flushLogs(): void {
    for (const msg of this._logs) {
      this._view?.webview.postMessage({ type: 'log', message: msg, ts: '' })
    }
  }

  private _getHtml(): string {
    const locale = getLocale()
    const dict = dictForLocale(locale)
    const nonce = crypto.randomBytes(16).toString('base64')
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px;
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    height: 100vh;
    display: flex;
    flex-direction: column;
  }
  #header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
    background: var(--vscode-sideBar-background);
    flex-shrink: 0;
  }
  #state {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }
  #state.analyzing { color: var(--vscode-charts-blue); }
  .clear-btn {
    margin-left: auto;
    background: none;
    border: none;
    color: var(--vscode-descriptionForeground);
    cursor: pointer;
    font-size: 10px;
    padding: 2px 6px;
  }
  .clear-btn:hover { color: var(--vscode-foreground); }
  #summary {
    padding: 8px 12px;
    border-bottom: 1px solid var(--vscode-panel-border);
    display: none;
    font-size: 11px;
    gap: 16px;
    flex-wrap: wrap;
    background: var(--vscode-sideBar-background);
  }
  #summary.visible { display: flex; }
  .stat { display: flex; flex-direction: column; }
  .stat-val { font-size: 18px; font-weight: 700; color: var(--vscode-charts-blue); line-height: 1; }
  .stat-lbl { color: var(--vscode-descriptionForeground); font-size: 10px; }
  #log {
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px;
    font-family: var(--vscode-editor-font-family, monospace);
  }
  .log-line {
    padding: 1px 0;
    color: var(--vscode-foreground);
    opacity: 0.85;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .log-line .ts { color: var(--vscode-descriptionForeground); margin-right: 6px; }
  .empty { color: var(--vscode-descriptionForeground); font-style: italic; padding: 12px 0; }
</style>
</head>
<body>
<div id="header">
  <span style="font-weight:600;font-size:11px;">Codebase Visualizer</span>
  <span id="state">Ready</span>
  <button id="clearBtn" class="clear-btn">Clear</button>
</div>
<div id="summary">
  <div class="stat"><span class="stat-val" id="sRoutes">0</span><span class="stat-lbl">Routes</span></div>
  <div class="stat"><span class="stat-val" id="sTables">0</span><span class="stat-lbl">Tables</span></div>
  <div class="stat"><span class="stat-val" id="sProject" style="font-size:13px">—</span><span class="stat-lbl">Project</span></div>
</div>
<div id="log"><div class="empty">${t('panel.empty', locale)}</div></div>

<script>
  window.__PANEL_I18N__ = ${JSON.stringify(dict)};
  const logEl = document.getElementById('log');
  const stateEl = document.getElementById('state');
  const summary = document.getElementById('summary');
  let hasLogs = false;

  function addLine(ts, msg) {
    if (!hasLogs) { logEl.innerHTML = ''; hasLogs = true; }
    const div = document.createElement('div');
    div.className = 'log-line';
    div.innerHTML = ts ? '<span class="ts">' + ts + '</span>' + esc(msg) : esc(msg);
    logEl.appendChild(div);
    logEl.scrollTop = logEl.scrollHeight;
  }

  function esc(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function clearLog() {
    logEl.innerHTML = '<div class="empty">' + (window.__PANEL_I18N__ && window.__PANEL_I18N__['panel.empty']) + '</div>';
    hasLogs = false;
    summary.classList.remove('visible');
    stateEl.textContent = 'Ready';
    stateEl.className = '';
  }

  document.getElementById('clearBtn').addEventListener('click', clearLog);

  window.addEventListener('message', e => {
    const d = e.data;
    if (d.type === 'log') {
      addLine(d.ts, d.message);
    } else if (d.type === 'state') {
      if (d.analyzing) {
        stateEl.textContent = '● Analyzing' + (d.projectName ? ' ' + d.projectName : '') + '...';
        stateEl.className = 'analyzing';
      } else {
        stateEl.textContent = 'Ready';
        stateEl.className = '';
      }
    } else if (d.type === 'result') {
      stateEl.textContent = '✓ Done';
      stateEl.className = '';
      document.getElementById('sRoutes').textContent = d.routeCount;
      document.getElementById('sTables').textContent = d.tableCount;
      document.getElementById('sProject').textContent = d.projectName;
      summary.classList.add('visible');
    }
  });
</script>
</body>
</html>`
    return html.replace(/<script>/g, `<script nonce="${nonce}">`)
  }
}
