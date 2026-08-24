import { defineConfig, devices } from '@playwright/test';

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
const localBaseUrl = 'http://127.0.0.1:4321';
const localOutputDir = process.env.TRINITY_PROJECT_ROOT
  ? './.tools/test-results/playwright'
  : './test-results';

export default defineConfig({
  testDir: './tests/e2e',
  outputDir: localOutputDir,
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 7_500 },
  reporter: process.env.CI
    ? [['line'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : 'list',
  use: {
    baseURL: externalBaseUrl || localBaseUrl,
    colorScheme: 'dark',
    locale: 'en-US',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'mobile-chromium',
      use: { ...devices['Pixel 7'] },
      testMatch: /(?:routes|accessibility)\.spec\.ts/,
    },
    {
      name: 'tablet-chromium',
      use: {
        ...devices['Desktop Chrome'],
        hasTouch: true,
        viewport: { width: 834, height: 1112 },
      },
      testMatch: /(?:routes|accessibility)\.spec\.ts/,
    },
  ],
  webServer: externalBaseUrl
    ? undefined
    : {
        command:
          'npm run build && npm run prepare:deploy -- --environment production --dist dist && npm run preview -- --host 127.0.0.1 --port 4321',
        env: {
          ...process.env,
          PUBLIC_INDEXABLE: 'true',
          SITE_DEPLOYMENT_ENV: 'production',
        },
        url: localBaseUrl,
        reuseExistingServer: !process.env.CI,
        timeout: 180_000,
      },
});
