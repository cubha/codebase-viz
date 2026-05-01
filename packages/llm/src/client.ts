import Anthropic from '@anthropic-ai/sdk'
import type { LLMAnalysisResult } from './schema.js'

const SYSTEM_PROMPT = `You are a code architecture analyzer. Analyze the provided source code and return a JSON object describing the project structure.

Return ONLY valid JSON matching this schema:
{
  "framework": string,  // "nextjs-app-router" | "nextjs-pages" | "vite-react" | "nuxt" | "sveltekit" | "expo" | "unknown"
  "routes": [
    {
      "path": string,       // URL path e.g. "/blog/[slug]"
      "file": string,       // repo-relative file path
      "mode": string,       // "SSR" | "CSR" | "SSG" | "ISR" | "unknown"
      "components": string[] // component names rendered on this route
    }
  ],
  "tables": [
    {
      "name": string,      // table/collection/model name
      "usedBy": string[]   // component names that query this table
    }
  ],
  "inferenceNotes": string[] // brief reasoning notes
}

Rules:
- Only include routes that are actual pages/screens (not API routes)
- Only include tables/collections that are actually queried in the code
- Set mode to "CSR" if "use client" directive is present, "SSR" for server components
- ISR if revalidate is set, SSG if generateStaticParams with no revalidate`

export interface LLMClientOptions {
  apiKey: string
  model?: string
  maxTokens?: number
}

export interface AnalyzeOptions {
  projectName: string
  framework: string
  fileContents: Record<string, string>
}

export async function analyzWithLLM(
  options: LLMClientOptions,
  analyzeOptions: AnalyzeOptions,
): Promise<LLMAnalysisResult> {
  const client = new Anthropic({ apiKey: options.apiKey })
  const model = options.model ?? 'claude-sonnet-4-5'
  const maxTokens = options.maxTokens ?? 8000

  const fileBlock = Object.entries(analyzeOptions.fileContents)
    .map(([filePath, content]) => `### ${filePath}\n\`\`\`\n${content}\n\`\`\``)
    .join('\n\n')

  const userMessage = `Project: ${analyzeOptions.projectName}
Detected framework: ${analyzeOptions.framework}

Analyze the following source files and return the JSON structure:

${fileBlock}`

  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  })

  const textContent = message.content.find(c => c.type === 'text')
  if (textContent === undefined || textContent.type !== 'text') {
    throw new Error('LLM returned no text content')
  }

  const jsonMatch = textContent.text.match(/\{[\s\S]+\}/)
  if (jsonMatch === null) {
    throw new Error('LLM response does not contain valid JSON')
  }

  return JSON.parse(jsonMatch[0]) as LLMAnalysisResult
}
