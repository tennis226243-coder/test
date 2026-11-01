import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  testMatch: '*.test.js',
  use: { baseURL: 'http://127.0.0.1:4173' },
  webServer: { command: 'node scripts/build-site.js tests/fixtures/site-data && node tests/e2e/server.js', url: 'http://127.0.0.1:4173/', reuseExistingServer: false },
});
