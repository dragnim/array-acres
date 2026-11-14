const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: 'tests',
  testMatch: '*.spec.js',
  use: {
    // Kept only when a test fails, for debugging CI-specific problems.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  // The full suite runs in Chromium. Firefox and WebKit (Safari's engine) run a short smoke suite of the main
  // journeys, which catches browser-specific problems without multiplying the time the tests take.
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' }, testMatch: 'smoke.spec.js' },
    { name: 'webkit', use: { browserName: 'webkit' }, testMatch: 'smoke.spec.js' },
  ],
  // The smoke suite loads the game over http, as players get it.
  webServer: { command: 'node tests/serve.js', url: 'http://localhost:4173/index.html', reuseExistingServer: true },
});
