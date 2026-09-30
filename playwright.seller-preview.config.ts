import { defineConfig } from '@playwright/test'

export default defineConfig({
  expect: { timeout: 15000 },
  testDir: './e2e', testMatch: 'seller-preview.preview.ts', fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  use: { baseURL: 'http://127.0.0.1:4188', viewport: { width: 1440, height: 1080 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev:payments -- --port 4188', url: 'http://127.0.0.1:4188/__preview/config', reuseExistingServer: false,
    env: { ...process.env, STRIPE_TEST_SECRET_KEY: '', STRIPE_TEST_PUBLISHABLE_KEY: '' },
  },
})
