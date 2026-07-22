import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      // 'vscode'는 확장 호스트가 런타임에 주입하는 모듈이라 Node/vitest에서 직접 resolve 불가능하다
      // (esbuild.mjs도 external 처리 — 이 alias는 vitest 전용이며 프로덕션 번들엔 영향 없음).
      vscode: fileURLToPath(new URL('./packages/extension/src/test-support/vscode-mock.ts', import.meta.url)),
    },
  },
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/test/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
  },
})
