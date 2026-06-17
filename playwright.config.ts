import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './playwright-tests',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:3000',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  reporter: [['json', { outputFile: 'playwright-report/results.json' }], ['html', { open: 'never' }]],
})
