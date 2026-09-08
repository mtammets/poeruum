import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: 'payment-preview.preview.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  use: { baseURL: 'http://127.0.0.1:4186', viewport: { width: 1440, height: 1000 }, trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run dev:payments -- --port 4186',
    url: 'http://127.0.0.1:4186/__preview/config',
    reuseExistingServer: false,
    env: { ...process.env, STRIPE_TEST_PUBLISHABLE_KEY: '', STRIPE_TEST_SECRET_KEY: '' },
  },
})
