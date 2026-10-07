import { test as base, expect } from '@playwright/test'

import { HomePage } from '#pages/home.page.js'
import { frontendUrls } from '#utils/env.js'

// Page Objects are created per test from that test's isolated `page`, which
// keeps specs parallel-safe. Specs receive them by name, e.g. ({ homePage }).
// One Home page per frontend: homePage is registration; the others are named
// after their frontend.
const test = base.extend({
  homePage: async ({ page }, use) => {
    await use(new HomePage(page, frontendUrls.registration))
  },
  submissionsHomePage: async ({ page }, use) => {
    await use(new HomePage(page, frontendUrls.submissions))
  },
  obligationsHomePage: async ({ page }, use) => {
    await use(new HomePage(page, frontendUrls.obligations))
  }
})

export { test, expect }
