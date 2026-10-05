import { defineConfig } from '@playwright/test'

import {
  browserName,
  frontendUrls,
  proxyConfig,
  runMode
} from './tests/utils/env.js'

const oneMinute = 60 * 1000

export default defineConfig({
  testDir: './tests/specs',
  // Keeps the existing *.e2e.js spec naming convention.
  testMatch: '**/*.e2e.js',

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  // Live CDP environments get one retry to absorb transient slowness.
  retries: process.env.CI || runMode === 'e2e' ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,

  // The CDP Portal hard-kills runs at 2 hours. Stop at 1h55 so the report is
  // still written and published.
  globalTimeout: 115 * oneMinute,
  timeout: oneMinute,
  expect: { timeout: 10 * 1000 },

  reporter: [
    // Writes playwright-report/index.html — the entry point the Portal renders.
    [
      'html',
      {
        outputFolder: 'playwright-report',
        // §7.1a: local runs open the report when the run finishes.
        open: runMode === 'local' ? 'always' : 'never'
      }
    ],
    ['list']
  ],

  use: {
    // Registration is the default frontend; other frontends are reached via
    // the fixtures using frontendUrls.
    baseURL: frontendUrls.registration,
    browserName: /** @type {'chromium' | 'firefox' | 'webkit'} */ (browserName),
    headless: process.env.HEADED !== 'true',
    viewport: { width: 1920, height: 1080 },
    ...(proxyConfig && {
      proxy: proxyConfig,
      // The CDP egress proxy tunnels via CONNECT; Chromium's HTTP/2 to origin
      // trips it with ERR_HTTP2_PROTOCOL_ERROR.
      ...(browserName === 'chromium' && {
        launchOptions: { args: ['--disable-http2'] }
      })
    }),

    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    trace: 'retain-on-failure'
  },

  // PROFILE (set on the CDP Portal) filters tests by title or @tag, e.g. @smoke.
  grep: process.env.PROFILE ? new RegExp(process.env.PROFILE) : undefined
})
