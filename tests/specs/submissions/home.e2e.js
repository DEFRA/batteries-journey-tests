import { test, expect } from '#fixtures/index.js'

test.describe('Home page', () => {
  test(
    'Should be on the "Home" page',
    { tag: '@smoke' },
    async ({ page, submissionsHomePage }) => {
      await submissionsHomePage.open()

      // The service name in the title proves we hit the submissions frontend.
      await expect(page).toHaveTitle('Home | waste-batteries-submit-frontend')
      await expect(submissionsHomePage.pageHeading).toHaveText('Home')
    }
  )
})
