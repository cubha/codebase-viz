import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { generateText } from 'ai'
import { z } from 'zod'
import type { LLMAnalysisResult } from './schema.js'
import { isRetryableLlmError } from './retry-classify.js'

const SYSTEM_PROMPT = `You are a code architecture analyzer. Analyze the provided source code and return a JSON object describing the project structure.

Return ONLY valid JSON matching this schema:
{
  "framework": string,       // "nextjs-app-router" | "nextjs-pages" | "vite-react" | "nuxt" | "sveltekit" | "expo" | "nestjs" | or any detected framework
  "deployTarget": string,    // "browser" | "server" | "mobile" | "edge" — where the frontend runs
  "hasSupabase": boolean,    // true if @supabase/supabase-js or supabase client is used
  "hasPrisma": boolean,      // true if @prisma/client is used
  "hasDexie": boolean,       // true if dexie (IndexedDB wrapper) is used
  "hasFirebase": boolean,    // true if firebase SDK is used
  "routes": [
    {
      "path": string,        // URL path e.g. "/blog/[slug]"
      "file": string,        // repo-relative file path
      "mode": string,        // "SSR" | "CSR" | "SSG" | "ISR" | "unknown"
      "components": string[] // component names rendered on this route
    }
  ],
  "tables": [
    {
      "name": string,        // table/collection/entity name
      "usedBy": string[]     // FRONTEND component names that query this resource (API calls, direct DB queries). Do NOT include backend module names.
    }
  ],
  "backendServices": [
    {
      "name": string,        // e.g. "NestJS API"
      "framework": string,   // "nestjs" | "express" | "fastify" | "hono" | "django" | "rails"
      "modules": string[],   // top-level module/domain names (e.g. ["AuthModule", "CrmModule"])
      "entities": string[],  // DB entity/table names this backend manages
      "dbType": string       // "postgresql" | "mysql" | "mongodb" | "sqlite"
    }
  ],
  "inferenceNotes": string[] // brief reasoning notes
}

Rules:
- Detect framework from package.json deps and config files; don't rely only on the hint provided
- If files from multiple apps are provided (monorepo), set "framework" to the PRIMARY frontend framework and list backend apps in "backendServices"
- deployTarget: "browser" for SPAs (Vite/CRA/Next.js-CSR), "server" for SSR (Next.js/Nuxt), "mobile" for Expo/React Native
- Only include routes that are actual UI pages/screens (not API endpoints)
- tables: what the FRONTEND queries via API calls or direct DB — set usedBy to frontend component names only
- backendServices: NestJS/Express/FastAPI apps found in the codebase — list their modules and entity names
- Set mode to "CSR" if "use client" directive is present, "SSR" for server components
- ISR if revalidate is set, SSG if generateStaticParams with no revalidate
- If no backend is found, set backendServices to []`

const DEFAULT_MODELS = {
  anthropic: 'claude-sonnet-4-6',
  google: 'gemini-2.5-flash',
  openai: 'gpt-4o',
} as const

const LLMResultSchema = z.object({
  framework: z.string(),
  deployTarget: z.string().optional(),
  hasSupabase: z.boolean().optional(),
  hasPrisma: z.boolean().optional(),
  hasDexie: z.boolean().optional(),
  hasFirebase: z.boolean().optional(),
  routes: z.array(z.object({
    path: z.string(),
    file: z.string(),
    mode: z.string(),
    components: z.array(z.string()),
  })),
  tables: z.array(z.object({
    name: z.string(),
    usedBy: z.array(z.string()),
  })),
  backendServices: z.array(z.object({
    name: z.string(),
    framework: z.string(),
    modules: z.array(z.string()).optional(),
    entities: z.array(z.string()).optional(),
    dbType: z.string().optional(),
  })).optional(),
  inferenceNotes: z.array(z.string()),
})

export type LLMProvider = 'anthropic' | 'google' | 'openai'

// ARCH-2: provider 기본값('anthropic')을 client.ts·extension.ts 양쪽에 중복 하드코딩하던 것을
// 이 단일 상수로 통일한다.
export const DEFAULT_LLM_PROVIDER: LLMProvider = 'anthropic'

export interface LLMClientOptions {
  apiKey: string
  provider?: LLMProvider
  model?: string
  maxTokens?: number
}

export interface AnalyzeOptions {
  projectName: string
  framework: string
  fileContents: Record<string, string>
}

function createModel(opts: LLMClientOptions) {
  const provider = opts.provider ?? DEFAULT_LLM_PROVIDER
  // 빈 문자열·공백만 있는 model은 invalid (provider API가 404 반환) → DEFAULT_MODELS fallback.
  const trimmed = opts.model?.trim()
  const modelId = trimmed !== undefined && trimmed.length > 0 ? trimmed : DEFAULT_MODELS[provider]
  if (provider === 'google') return createGoogleGenerativeAI({ apiKey: opts.apiKey })(modelId)
  if (provider === 'openai') return createOpenAI({ apiKey: opts.apiKey })(modelId)
  return createAnthropic({ apiKey: opts.apiKey })(modelId)
}

export async function analyzeWithLLM(
  options: LLMClientOptions,
  analyzeOptions: AnalyzeOptions,
): Promise<LLMAnalysisResult> {
  const model = createModel(options)
  const maxTokens = options.maxTokens ?? 8000

  const fileBlock = Object.entries(analyzeOptions.fileContents)
    .map(([filePath, content]) => `### ${filePath}\n\`\`\`\n${content}\n\`\`\``)
    .join('\n\n')

  const userMessage = `Project: ${analyzeOptions.projectName}
Detected framework: ${analyzeOptions.framework}

Analyze the following source files and return the JSON structure:

${fileBlock}`

  const attempt = async (): Promise<LLMAnalysisResult> => {
    const { text } = await generateText({
      model,
      maxOutputTokens: maxTokens,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
    })

    const jsonMatch = text.match(/\{[\s\S]+\}/)
    if (jsonMatch === null) throw new Error('LLM response does not contain valid JSON')

    return LLMResultSchema.parse(JSON.parse(jsonMatch[0])) as LLMAnalysisResult
  }

  try {
    return await attempt()
  } catch (firstError) {
    // 4xx 등 재시도로 회복 불가능한 에러는 즉시 표면화 — 동일 실패를 반복 호출해 API 비용만
    // 낭비하지 않는다. 재시도 대상이면 재시도하되, 그마저 실패하면 첫 에러를 보존해 함께 표면화한다.
    if (!isRetryableLlmError(firstError)) throw firstError

    try {
      return await attempt()
    } catch (secondError) {
      const firstMessage = firstError instanceof Error ? firstError.message : String(firstError)
      const secondMessage = secondError instanceof Error ? secondError.message : String(secondError)
      const combined = new Error(
        `LLM analysis failed after retry. First attempt: ${firstMessage}. Retry: ${secondMessage}`,
        { cause: firstError },
      )
      // pipeline.ts가 err.name으로 원본 에러 타입(APICallError 등)을 진단 메시지에 노출하므로,
      // 제네릭 Error로 재래핑해도 그 정보가 사라지지 않도록 첫 에러의 name을 물려받는다.
      if (firstError instanceof Error) combined.name = firstError.name
      throw combined
    }
  }
}
