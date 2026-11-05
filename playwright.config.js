const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  testMatch: '*.spec.js',
  use: {
    browserName: 'chromium',
    // Kept only when a test fails, for debugging CI-specific problems.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
