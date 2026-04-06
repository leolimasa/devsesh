import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 60000,
  fullyParallel: false,
  reporter: 'list',
  use: {
    browserName: 'chromium',
    baseURL: 'http://localhost:8080',
    launchOptions: {
      executablePath: process.env.CHROMIUM_PATH || '/nix/store/20ra63h4njcpr9v7vz34vhgrkm8g0icp-chromium-146.0.7680.177/bin/chromium',
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});