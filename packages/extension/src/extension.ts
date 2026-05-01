import * as vscode from 'vscode'
import { CodeSightPanel } from './webview.js'
import { runAnalysis } from './analyzer.js'

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand('codesight.analyze', async () => {
      const workspaceRoot = getWorkspaceRoot()
      if (workspaceRoot === undefined) {
        void vscode.window.showErrorMessage('CodeSight: No workspace folder open.')
        return
      }

      const config = vscode.workspace.getConfiguration('codesight')
      const enableLLM = config.get<boolean>('enableLLM', false)
      const model = config.get<string>('model', 'claude-sonnet-4-5')

      let apiKey: string | undefined
      if (enableLLM) {
        apiKey = await context.secrets.get('codesight.anthropicKey')
        if (apiKey === undefined || apiKey === '') {
          const action = await vscode.window.showWarningMessage(
            'CodeSight: LLM analysis enabled but no API key found. Set one first.',
            'Set API Key',
          )
          if (action === 'Set API Key') {
            await vscode.commands.executeCommand('codesight.setApiKey')
          }
          return
        }
      }

      const panel = CodeSightPanel.createOrShow(context.extensionUri)

      try {
        panel.showLoading()
        const graph = await runAnalysis(workspaceRoot, apiKey !== undefined ? { apiKey, model } : undefined)
        panel.updateGraph(graph)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        void vscode.window.showErrorMessage(`CodeSight: Analysis failed — ${message}`)
        panel.showError(message)
      }
    }),

    vscode.commands.registerCommand('codesight.setApiKey', async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Enter your Anthropic API key',
        password: true,
        placeHolder: 'sk-ant-api03-...',
      })
      if (key !== undefined && key !== '') {
        await context.secrets.store('codesight.anthropicKey', key)
        void vscode.window.showInformationMessage('CodeSight: API key saved securely.')
      }
    }),

    vscode.commands.registerCommand('codesight.clearApiKey', async () => {
      await context.secrets.delete('codesight.anthropicKey')
      void vscode.window.showInformationMessage('CodeSight: API key cleared.')
    }),
  )
}

export function deactivate(): void {
  CodeSightPanel.dispose()
}

function getWorkspaceRoot(): string | undefined {
  const folders = vscode.workspace.workspaceFolders
  if (folders === undefined || folders.length === 0) return undefined
  return folders[0]?.uri.fsPath
}
