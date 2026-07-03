import { describe, it, expect } from 'vitest'
import { isRetryableLlmError } from './retry-classify.js'

describe('isRetryableLlmError (ERR-1)', () => {
  it('AI SDK APICallError의 isRetryable=false(4xx 등)면 재시도 불가로 분류한다', () => {
    expect(isRetryableLlmError({ isRetryable: false, statusCode: 401 })).toBe(false)
    expect(isRetryableLlmError({ isRetryable: false, statusCode: 400 })).toBe(false)
  })

  it('AI SDK APICallError의 isRetryable=true(429/5xx 등)면 재시도 가능으로 분류한다', () => {
    expect(isRetryableLlmError({ isRetryable: true, statusCode: 429 })).toBe(true)
    expect(isRetryableLlmError({ isRetryable: true, statusCode: 503 })).toBe(true)
  })

  it('isRetryable 필드가 없는 에러(JSON 파싱 실패·스키마 검증 실패 등 자체 에러)는 재시도 가능으로 분류한다', () => {
    expect(isRetryableLlmError(new Error('LLM response does not contain valid JSON'))).toBe(true)
    expect(isRetryableLlmError({ message: 'zod validation failed' })).toBe(true)
  })

  it('객체가 아닌 에러(문자열 throw 등)도 재시도 가능으로 분류한다', () => {
    expect(isRetryableLlmError('some string error')).toBe(true)
    expect(isRetryableLlmError(null)).toBe(true)
    expect(isRetryableLlmError(undefined)).toBe(true)
  })
})
