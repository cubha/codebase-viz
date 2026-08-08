// 다국어 사전. ko가 source, en은 fallback. ja/zh-cn은 1차 번역.
// 추가 키는 알파벳 순으로 정렬해 유지.

export type Locale = 'ko' | 'en' | 'ja' | 'zh-cn'

export const SUPPORTED_LOCALES: readonly Locale[] = ['ko', 'en', 'ja', 'zh-cn']

export const FALLBACK_LOCALE: Locale = 'en'

type Dict = Record<string, string>

const KO: Dict = {
  // viewer.html — legend (rendering modes)
  'legend.ssr': 'SSR · 서버 렌더링',
  'legend.csr': 'CSR · 클라이언트 렌더링',
  'legend.isr': 'ISR · 증분 재생성',
  'legend.ssg': 'SSG · 정적 생성',
  'legend.inferred': 'inferred (LLM)',
  'legend.feBe': 'FE→BE 연결 (dashed)',
  // viewer.html — DB toggle bar
  'db.view.label': 'View',
  'db.view.all': '전체',
  'db.view.fk': 'FK 관계',
  'db.view.routes': '페이지 쿼리',
  'db.view.actions': '서버 액션',
  'db.sidebar.tables': 'Tables',
  // viewer.html — tabs
  'tab.rendering': 'Rendering Architecture',
  'tab.screenComponent': 'Screen–Component',
  'tab.dbScreen': '데이터 흐름',
  // viewer.html — status
  'status.rendering': '렌더링 중...',
  'status.loading': '로딩 중...',
  'status.noTables': '테이블 없음',
  'status.noData': 'No data',
  'status.noDbData': 'No DB data',
  'status.analyzing': 'analyzing...',
  // viewer.html — alerts / errors
  'alert.noDiagram': '다이어그램 데이터가 없습니다.',
  'alert.svgFailed': 'SVG 생성 실패',
  'alert.pngFailed': 'PNG 생성 실패',
  'alert.imageLoadFailed': '이미지 로드 실패',
  'alert.renderError': 'Render error',
  // viewer.html — chunk-nav suffix
  'chunk.suffix': 'wheel zoom · drag pan',
  // viewer.html — search (Wave A T3)
  'search.placeholder': '라우트·컴포넌트 검색...',
  'search.ariaLabel': '라우트·컴포넌트 검색',
  'search.matchCount': '{n}건 일치',
  'search.noMatch': '일치 없음',
  // viewer.html — sidebar (table card)
  'card.fk': 'FK',
  'card.usedBy': 'Used by',
  // viewer.html — export md
  'export.dbScreenAll': '데이터 흐름 (전체)',
  'export.routes': '개 라우트',
  'export.tables': '개 테이블',
  // sidebar (panelProvider HTML)
  'sidebar.noResult': '분석 결과 없음',
  'sidebar.workspaceFolder': 'Workspace Folder',
  'sidebar.status': 'Status',
  'sidebar.actions': 'Actions',
  'sidebar.export': 'Export',
  'sidebar.llmAnalysis': 'LLM Analysis',
  'sidebar.stack': 'Stack:',
  'sidebar.apiKeyNotSet': 'API Key: Not set',
  'sidebar.apiKeySet': 'API Key: Set',
  'sidebar.enableLLM': 'Enable LLM Analysis',
  'sidebar.btnAnalyze': '▶ Analyze Project',
  'sidebar.btnReanalyze': '↺ Re-analyze',
  'sidebar.btnViewer': '⊞ Open Viewer',
  'sidebar.btnPng': '🖼 PNG',
  'sidebar.btnSvg': '✦ SVG',
  'sidebar.btnMd': '↓ MD',
  'sidebar.btnSetApiKey': '🔑 Set API Key',
  'sidebar.btnClearApiKey': '✕ Clear API Key',
  'sidebar.language': 'Language',
  'sidebar.langAuto': '자동 (VS Code 따라가기)',
  // panelProvider (Output Panel log)
  'panel.analyzing': '분석 시작...',
  'panel.complete': '완료 — {routes}개 라우트, {tables}개 테이블',
  'panel.empty': '분석을 실행하면 로그가 표시됩니다.',
  'panel.error': '오류: {message}',
  // extension.ts — showXxxMessage
  'msg.noWorkspace': 'Codebase Viz: No workspace folder open.',
  'msg.noCacheRunFirst': 'Codebase Viz: No analysis cache. Run Analyze first.',
  'msg.staticComplete': 'Codebase Viz: Static analysis complete. Enable LLM analysis for richer results.',
  'msg.llmNoApiKey': 'Codebase Viz: LLM analysis enabled but no API key found. Set one first.',
  'msg.analysisFailed': 'Codebase Viz: Analysis failed — {message}',
  'msg.apiKeySaved': 'Codebase Viz: API key saved securely.',
  'msg.apiKeyCleared': 'Codebase Viz: API key cleared.',
  'msg.btnSetApiKey': 'Set API Key',
  // sidebar — provider selector
  'sidebar.llmProvider': 'AI 제공자',
  'sidebar.providerAnthropic': 'Anthropic (Claude)',
  'sidebar.providerGoogle': 'Google (Gemini 무료)',
  'sidebar.providerOpenAI': 'OpenAI (GPT-4o)',
  'sidebar.googleGuide': 'Gemini 무료 키 발급 →',
  'sidebar.anthropicGuide': 'Anthropic API 키 발급 →',
  'sidebar.openaiGuide': 'OpenAI API 키 발급 →',
  // extension.ts — setApiKey
  'msg.setApiKeyPrompt': '{provider} API 키를 입력하세요',
  // extension.ts — showQuickPick
  'pick.selectWorkspace': 'Select workspace folder to analyze',
  'pick.selectPair': 'Select paired BE project (optional) — Esc or Skip to analyze single project',
}

const EN: Dict = {
  'legend.ssr': 'SSR · Server Rendering',
  'legend.csr': 'CSR · Client Rendering',
  'legend.isr': 'ISR · Incremental Regen',
  'legend.ssg': 'SSG · Static Generation',
  'legend.inferred': 'inferred (LLM)',
  'legend.feBe': 'FE→BE connection (dashed)',
  'db.view.label': 'View',
  'db.view.all': 'All',
  'db.view.fk': 'FK Relations',
  'db.view.routes': 'Page Queries',
  'db.view.actions': 'Server Actions',
  'db.sidebar.tables': 'Tables',
  'tab.rendering': 'Rendering Architecture',
  'tab.screenComponent': 'Screen–Component',
  'tab.dbScreen': 'Data Flow',
  'status.rendering': 'Rendering...',
  'status.loading': 'Loading...',
  'status.noTables': 'No tables',
  'status.noData': 'No data',
  'status.noDbData': 'No DB data',
  'status.analyzing': 'analyzing...',
  'alert.noDiagram': 'No diagram data.',
  'alert.svgFailed': 'SVG generation failed',
  'alert.pngFailed': 'PNG generation failed',
  'alert.imageLoadFailed': 'Image load failed',
  'alert.renderError': 'Render error',
  'chunk.suffix': 'wheel zoom · drag pan',
  'search.placeholder': 'Search routes/components...',
  'search.ariaLabel': 'Search routes and components',
  'search.matchCount': '{n} matches',
  'search.noMatch': 'No matches',
  'card.fk': 'FK',
  'card.usedBy': 'Used by',
  'export.dbScreenAll': 'Data Flow (All)',
  'export.routes': ' routes',
  'export.tables': ' tables',
  'sidebar.noResult': 'No analysis result',
  'sidebar.workspaceFolder': 'Workspace Folder',
  'sidebar.status': 'Status',
  'sidebar.actions': 'Actions',
  'sidebar.export': 'Export',
  'sidebar.llmAnalysis': 'LLM Analysis',
  'sidebar.stack': 'Stack:',
  'sidebar.apiKeyNotSet': 'API Key: Not set',
  'sidebar.apiKeySet': 'API Key: Set',
  'sidebar.enableLLM': 'Enable LLM Analysis',
  'sidebar.btnAnalyze': '▶ Analyze Project',
  'sidebar.btnReanalyze': '↺ Re-analyze',
  'sidebar.btnViewer': '⊞ Open Viewer',
  'sidebar.btnPng': '🖼 PNG',
  'sidebar.btnSvg': '✦ SVG',
  'sidebar.btnMd': '↓ MD',
  'sidebar.btnSetApiKey': '🔑 Set API Key',
  'sidebar.btnClearApiKey': '✕ Clear API Key',
  'sidebar.language': 'Language',
  'sidebar.langAuto': 'Auto (follow VS Code)',
  'panel.analyzing': 'Analyzing...',
  'panel.complete': 'Complete — {routes} routes, {tables} tables',
  'panel.empty': 'Run analysis to see logs here.',
  'panel.error': 'Error: {message}',
  'msg.noWorkspace': 'Codebase Viz: No workspace folder open.',
  'msg.noCacheRunFirst': 'Codebase Viz: No analysis cache. Run Analyze first.',
  'msg.staticComplete': 'Codebase Viz: Static analysis complete. Enable LLM analysis for richer results.',
  'msg.llmNoApiKey': 'Codebase Viz: LLM analysis enabled but no API key found. Set one first.',
  'msg.analysisFailed': 'Codebase Viz: Analysis failed — {message}',
  'msg.apiKeySaved': 'Codebase Viz: API key saved securely.',
  'msg.apiKeyCleared': 'Codebase Viz: API key cleared.',
  'msg.btnSetApiKey': 'Set API Key',
  // sidebar — provider selector
  'sidebar.llmProvider': 'AI Provider',
  'sidebar.providerAnthropic': 'Anthropic (Claude)',
  'sidebar.providerGoogle': 'Google (Gemini free)',
  'sidebar.providerOpenAI': 'OpenAI (GPT-4o)',
  'sidebar.googleGuide': 'Get free Gemini key →',
  'sidebar.anthropicGuide': 'Get Anthropic API key →',
  'sidebar.openaiGuide': 'Get OpenAI API key →',
  // extension.ts — setApiKey
  'msg.setApiKeyPrompt': 'Enter your {provider} API key',
  'pick.selectWorkspace': 'Select workspace folder to analyze',
  'pick.selectPair': 'Select paired BE project (optional) — Esc or Skip to analyze single project',
}

const JA: Dict = {
  'legend.ssr': 'SSR · サーバーレンダリング',
  'legend.csr': 'CSR · クライアントレンダリング',
  'legend.isr': 'ISR · 増分再生成',
  'legend.ssg': 'SSG · 静的生成',
  'legend.inferred': 'inferred (LLM)',
  'legend.feBe': 'FE→BE 接続 (dashed)',
  'db.view.label': 'View',
  'db.view.all': '全て',
  'db.view.fk': 'FK 関係',
  'db.view.routes': 'ページクエリ',
  'db.view.actions': 'サーバーアクション',
  'db.sidebar.tables': 'テーブル',
  'tab.rendering': 'Rendering Architecture',
  'tab.screenComponent': 'Screen–Component',
  'tab.dbScreen': 'データフロー',
  'status.rendering': 'レンダリング中...',
  'status.loading': '読み込み中...',
  'status.noTables': 'テーブルなし',
  'status.noData': 'データなし',
  'status.noDbData': 'DBデータなし',
  'status.analyzing': '分析中...',
  'alert.noDiagram': 'ダイアグラムデータがありません。',
  'alert.svgFailed': 'SVG 生成失敗',
  'alert.pngFailed': 'PNG 生成失敗',
  'alert.imageLoadFailed': '画像読み込み失敗',
  'alert.renderError': 'レンダーエラー',
  'chunk.suffix': 'ホイールズーム · ドラッグパン',
  'search.placeholder': 'ルート・コンポーネントを検索...',
  'search.ariaLabel': 'ルート・コンポーネント検索',
  'search.matchCount': '{n}件一致',
  'search.noMatch': '一致なし',
  'card.fk': 'FK',
  'card.usedBy': '使用元',
  'export.dbScreenAll': 'データフロー (全て)',
  'export.routes': ' ルート',
  'export.tables': ' テーブル',
  'sidebar.noResult': '分析結果なし',
  'sidebar.workspaceFolder': 'ワークスペースフォルダー',
  'sidebar.status': 'ステータス',
  'sidebar.actions': 'アクション',
  'sidebar.export': 'エクスポート',
  'sidebar.llmAnalysis': 'LLM 分析',
  'sidebar.stack': 'スタック:',
  'sidebar.apiKeyNotSet': 'API キー: 未設定',
  'sidebar.apiKeySet': 'API キー: 設定済み',
  'sidebar.enableLLM': 'LLM 分析を有効化',
  'sidebar.btnAnalyze': '▶ プロジェクト分析',
  'sidebar.btnReanalyze': '↺ 再分析',
  'sidebar.btnViewer': '⊞ ビューアを開く',
  'sidebar.btnPng': '🖼 PNG',
  'sidebar.btnSvg': '✦ SVG',
  'sidebar.btnMd': '↓ MD',
  'sidebar.btnSetApiKey': '🔑 API キー設定',
  'sidebar.btnClearApiKey': '✕ API キー削除',
  'sidebar.language': '言語',
  'sidebar.langAuto': '自動 (VS Code に従う)',
  'panel.analyzing': '分析開始...',
  'panel.complete': '完了 — {routes} ルート, {tables} テーブル',
  'panel.empty': '分析を実行するとログが表示されます。',
  'panel.error': 'エラー: {message}',
  'msg.noWorkspace': 'Codebase Viz: ワークスペースフォルダーが開かれていません。',
  'msg.noCacheRunFirst': 'Codebase Viz: 分析キャッシュがありません。先に分析を実行してください。',
  'msg.staticComplete': 'Codebase Viz: 静的分析が完了しました。LLM分析を有効化するとさらに詳細な結果が得られます。',
  'msg.llmNoApiKey': 'Codebase Viz: LLM 分析が有効ですが API キーがありません。先に設定してください。',
  'msg.analysisFailed': 'Codebase Viz: 分析失敗 — {message}',
  'msg.apiKeySaved': 'Codebase Viz: API キーを安全に保存しました。',
  'msg.apiKeyCleared': 'Codebase Viz: API キーを削除しました。',
  'msg.btnSetApiKey': 'API キー設定',
  // sidebar — provider selector
  'sidebar.llmProvider': 'AI プロバイダー',
  'sidebar.providerAnthropic': 'Anthropic (Claude)',
  'sidebar.providerGoogle': 'Google (Gemini 無料)',
  'sidebar.providerOpenAI': 'OpenAI (GPT-4o)',
  'sidebar.googleGuide': 'Gemini 無料キーを取得 →',
  'sidebar.anthropicGuide': 'Anthropic APIキーを取得 →',
  'sidebar.openaiGuide': 'OpenAI APIキーを取得 →',
  // extension.ts — setApiKey
  'msg.setApiKeyPrompt': '{provider} API キーを入力してください',
  'pick.selectWorkspace': '分析するワークスペースフォルダーを選択',
  'pick.selectPair': 'ペアの BE プロジェクトを選択 (オプション) — Esc またはスキップで単一分析',
}

const ZH_CN: Dict = {
  'legend.ssr': 'SSR · 服务器渲染',
  'legend.csr': 'CSR · 客户端渲染',
  'legend.isr': 'ISR · 增量再生',
  'legend.ssg': 'SSG · 静态生成',
  'legend.inferred': 'inferred (LLM)',
  'legend.feBe': 'FE→BE 连接 (dashed)',
  'db.view.label': '视图',
  'db.view.all': '全部',
  'db.view.fk': 'FK 关系',
  'db.view.routes': '页面查询',
  'db.view.actions': '服务器操作',
  'db.sidebar.tables': '表',
  'tab.rendering': 'Rendering Architecture',
  'tab.screenComponent': 'Screen–Component',
  'tab.dbScreen': '数据流',
  'status.rendering': '渲染中...',
  'status.loading': '加载中...',
  'status.noTables': '无表',
  'status.noData': '无数据',
  'status.noDbData': '无 DB 数据',
  'status.analyzing': '分析中...',
  'alert.noDiagram': '无图表数据。',
  'alert.svgFailed': 'SVG 生成失败',
  'alert.pngFailed': 'PNG 生成失败',
  'alert.imageLoadFailed': '图像加载失败',
  'alert.renderError': '渲染错误',
  'chunk.suffix': '滚轮缩放 · 拖动平移',
  'search.placeholder': '搜索路由·组件...',
  'search.ariaLabel': '搜索路由和组件',
  'search.matchCount': '匹配 {n} 项',
  'search.noMatch': '无匹配',
  'card.fk': 'FK',
  'card.usedBy': '使用方',
  'export.dbScreenAll': '数据流 (全部)',
  'export.routes': ' 路由',
  'export.tables': ' 表',
  'sidebar.noResult': '无分析结果',
  'sidebar.workspaceFolder': '工作区文件夹',
  'sidebar.status': '状态',
  'sidebar.actions': '操作',
  'sidebar.export': '导出',
  'sidebar.llmAnalysis': 'LLM 分析',
  'sidebar.stack': '技术栈:',
  'sidebar.apiKeyNotSet': 'API Key: 未设置',
  'sidebar.apiKeySet': 'API Key: 已设置',
  'sidebar.enableLLM': '启用 LLM 分析',
  'sidebar.btnAnalyze': '▶ 分析项目',
  'sidebar.btnReanalyze': '↺ 重新分析',
  'sidebar.btnViewer': '⊞ 打开查看器',
  'sidebar.btnPng': '🖼 PNG',
  'sidebar.btnSvg': '✦ SVG',
  'sidebar.btnMd': '↓ MD',
  'sidebar.btnSetApiKey': '🔑 设置 API Key',
  'sidebar.btnClearApiKey': '✕ 清除 API Key',
  'sidebar.language': '语言',
  'sidebar.langAuto': '自动 (跟随 VS Code)',
  'panel.analyzing': '分析开始...',
  'panel.complete': '完成 — {routes} 路由, {tables} 表',
  'panel.empty': '运行分析后将在此显示日志。',
  'panel.error': '错误: {message}',
  'msg.noWorkspace': 'Codebase Viz: 未打开工作区文件夹。',
  'msg.noCacheRunFirst': 'Codebase Viz: 无分析缓存。请先运行分析。',
  'msg.staticComplete': 'Codebase Viz: 静态分析完成。启用 LLM 分析可获得更丰富的结果。',
  'msg.llmNoApiKey': 'Codebase Viz: 已启用 LLM 分析但未找到 API Key。请先设置。',
  'msg.analysisFailed': 'Codebase Viz: 分析失败 — {message}',
  'msg.apiKeySaved': 'Codebase Viz: API Key 已安全保存。',
  'msg.apiKeyCleared': 'Codebase Viz: API Key 已清除。',
  'msg.btnSetApiKey': '设置 API Key',
  // sidebar — provider selector
  'sidebar.llmProvider': 'AI 提供商',
  'sidebar.providerAnthropic': 'Anthropic (Claude)',
  'sidebar.providerGoogle': 'Google (Gemini 免费)',
  'sidebar.providerOpenAI': 'OpenAI (GPT-4o)',
  'sidebar.googleGuide': '获取免费 Gemini Key →',
  'sidebar.anthropicGuide': '获取 Anthropic API Key →',
  'sidebar.openaiGuide': '获取 OpenAI API Key →',
  // extension.ts — setApiKey
  'msg.setApiKeyPrompt': '请输入 {provider} API Key',
  'pick.selectWorkspace': '选择要分析的工作区文件夹',
  'pick.selectPair': '选择配对的 BE 项目 (可选) — Esc 或 跳过 进行单项目分析',
}

const DICTS: Record<Locale, Dict> = { ko: KO, en: EN, ja: JA, 'zh-cn': ZH_CN }

export function t(key: string, locale: Locale, params?: Record<string, string | number>): string {
  const dict = DICTS[locale] ?? DICTS[FALLBACK_LOCALE]
  let template = dict[key] ?? DICTS[FALLBACK_LOCALE][key] ?? key
  if (params !== undefined) {
    for (const [k, v] of Object.entries(params)) {
      template = template.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v))
    }
  }
  return template
}

// VS Code locale ('ko', 'en-US', 'ja', 'zh-cn', 'zh-tw') → 우리 Locale
export function normalizeLocale(vscodeLocale: string): Locale {
  const lc = vscodeLocale.toLowerCase()
  if (lc === 'ko' || lc.startsWith('ko-')) return 'ko'
  if (lc === 'ja' || lc.startsWith('ja-')) return 'ja'
  if (lc === 'zh-cn' || lc === 'zh' || lc.startsWith('zh-')) return 'zh-cn'
  return 'en'
}

// 사용자 설정 'auto' | Locale 중 하나를 받아 실제 Locale 반환.
// 'auto'면 VS Code 디스플레이 언어를 정규화해서 사용.
export function resolveLocale(settingValue: string | undefined, vscodeLocale: string): Locale {
  if (settingValue && settingValue !== 'auto' && (SUPPORTED_LOCALES as readonly string[]).includes(settingValue)) {
    return settingValue as Locale
  }
  return normalizeLocale(vscodeLocale)
}

// 전체 dict export (viewer.html에 inject용)
export function dictForLocale(locale: Locale): Dict {
  return DICTS[locale] ?? DICTS[FALLBACK_LOCALE]
}
