const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,
  fullyParallel: true,
  webServer: {
    command: 'python3 -m http.server 8744 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8744/',
    reuseExistingServer: true,
  },
  use: {
    baseURL: 'http://127.0.0.1:8744',
    viewport: { width: 1180, height: 820 },   // iPad-landscape-ish
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    // WebKit = the iPad's actual engine; closer to the target device than Chrome
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
