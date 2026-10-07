import { test, expect } from '#fixtures/index.js'

test.describe('Home page', () => {
  test(
    'Should be on the "Home" page',
    { tag: '@smoke' },
    async ({ page, obligationsHomePage }) => {
      await obligationsHomePage.open()

      // The service name in the title proves we hit the obligations frontend.
      await expect(page).toHaveTitle('Home | waste-batteries-obligations-fe')
      await expect(obligationsHomePage.pageHeading).toHaveText('Home')
    }
  )
})
