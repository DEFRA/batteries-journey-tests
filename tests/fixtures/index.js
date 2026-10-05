import { test as base, expect } from '@playwright/test'

import { HomePage } from '#pages/home.page.js'

// Page Objects are created per test from that test's isolated `page`, which
// keeps specs parallel-safe. Specs receive them by name, e.g. ({ homePage }).
const test = base.extend({
  homePage: async ({ page }, use) => {
    await use(new HomePage(page))
  }
})

export { test, expect }
