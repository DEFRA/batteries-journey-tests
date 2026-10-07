import { test, expect } from '#fixtures/index.js'

test.describe('Home page', () => {
  test(
    'Should be on the "Home" page',
    { tag: '@smoke' },
    async ({ page, homePage }) => {
      await homePage.open()

      // Title is "<pageTitle> | <serviceName>". The service name proves we hit
      // the registration frontend, not another CDP service with a Home page.
      await expect(page).toHaveTitle('Home | waste-batteries-reg-frontend')
      await expect(homePage.pageHeading).toHaveText('Home')
    }
  )
})
