// webview.ts가 JSON.stringify 결과를 <script> 블록에 직접 삽입하므로, 값에 "</script>"가
// 포함되면 스크립트 컨텍스트를 이탈할 수 있다. '<'를 유니코드 이스케이프해 이를 무력화한다.
export function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c')
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => HTML_ESCAPE_MAP[ch] ?? ch)
}
