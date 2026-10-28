import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: process.env.COMMON_TESTER_TEST_DIR || './.local/runs',
  outputDir: process.env.COMMON_TESTER_OUTPUT_DIR || './.local/test-results',
  reporter: [['json', { outputFile: process.env.COMMON_TESTER_REPORT || '.local/playwright-results.json' }]],
  retries: 0,
  workers: 1,
  use: {
    screenshot: 'on',
    trace: 'retain-on-failure',
  },
});
