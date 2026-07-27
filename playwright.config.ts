import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.e2e.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    trace: 'retain-on-failure',
  },
  projects: [{
    name: 'chromium',
    use: { ...devices['Desktop Chrome'] },
  }],
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    env: {
      ...process.env,
      VITE_SUPABASE_URL: '',
      VITE_SUPABASE_PUBLISHABLE_KEY: '',
      VITE_STRIPE_PUBLISHABLE_KEY: '',
      VITE_TURNSTILE_SITE_KEY: 'playwright-test-site-key',
    },
  },
})
