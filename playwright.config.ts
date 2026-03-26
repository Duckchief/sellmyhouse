import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E test configuration.
 * Server is started automatically against the test database.
 * Run: npm run test:e2e
 * Prerequisites: npm run docker:test:db && npm run build
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node tests/e2e/start-server.cjs',
    url: 'http://localhost:3001',
    reuseExistingServer: !process.env.CI,
    env: {
      DATABASE_URL:
        process.env.DATABASE_URL_TEST ||
        'postgresql://smh:smh_test@localhost:5433/smh_test',
      SESSION_SECRET: 'test-session-secret-must-be-long-enough-for-testing',
      ENCRYPTION_KEY: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      PORT: '3001',
      NODE_ENV: 'test',
    },
  },
});
