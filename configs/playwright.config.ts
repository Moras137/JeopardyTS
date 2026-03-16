import { defineConfig, devices } from '@playwright/test';
import path from 'path';

const visualMode = process.env['PW_VISUAL'] === '1';
const allBrowsers = process.env['E2E_ALL_BROWSERS'] === '1';

const projects = allBrowsers
  ? [
      { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
      { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
      { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    ]
  : [
      { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ];

export default defineConfig({
  testDir: '../tests/e2e',
  testMatch: '**/*.spec.ts',
  outputDir: '../output/test-results',
  reporter: [
    ['list'],
    ['html', { outputFolder: '../output/playwright-report', open: 'never' }],
    [path.resolve(__dirname, '../tests/e2e/helpers/test-protocol-reporter.cjs'), {
      outputDir: path.resolve(__dirname, '../output/playwright-report'),
    }],
  ],
  
  /* Run tests in files in parallel */
  fullyParallel: false, // Sequential zuerst für weniger flakiness

  /* Fail the build on CI if you accidentally left test.only in the source code */
  forbidOnly: !!process.env['CI'],

  /* Retry on CI only */
  retries: process.env['CI'] ? 2 : 0,

  /* Opt out of parallel tests on CI */
  workers: process.env['CI'] ? 1 : 4,

  /* Shared settings for all the projects below */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:3000',
    
    /* Collect trace when retrying the failed test */
    trace: visualMode ? 'on' : 'on-first-retry',
    
    /* Screenshots on failure */
    screenshot: visualMode ? 'on' : 'only-on-failure',
    
    /* Video on failure */
    video: visualMode ? 'on' : 'retain-on-failure',
  },

  preserveOutput: 'always',

  /* Configure projects for major browsers */
  projects,
});
