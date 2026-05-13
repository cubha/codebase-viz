import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: 'tests/playwright',
  timeout: 30000,
  use: {
    headless: true,
    viewport: { width: 1280, height: 900 },
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
  reporter: [['list'], ['html', { outputFolder: 'tests/playwright/report', open: 'never' }]],
})
