// AI SDK의 APICallError는 인스턴스에 isRetryable(SDK가 HTTP status로 판정한 재시도 가능 여부)을
// 직접 노출한다. instanceof 대신 duck-type으로 읽어 테스트에서 실제 SDK 클래스 없이도 검증 가능하고,
// 어떤 provider(anthropic/google/openai)를 거치든 동일하게 동작한다.
export function isRetryableLlmError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return true
  const isRetryable = (error as Record<string, unknown>).isRetryable
  if (typeof isRetryable === 'boolean') return isRetryable
  // JSON 파싱 실패·zod 스키마 검증 실패 등 우리 자체 에러는 재시도로 회복 가능하므로 허용.
  return true
}
