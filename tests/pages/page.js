import { frontendUrls } from '#utils/env.js'

class Page {
  /**
   * @param {import('@playwright/test').Page} page
   * @param {string} [baseUrl] frontend this page belongs to (default: registration)
   */
  constructor(page, baseUrl = frontendUrls.registration) {
    this.page = page
    this.baseUrl = baseUrl
  }

  get pageHeading() {
    return this.page.getByRole('heading', { level: 1 })
  }

  async open(path) {
    await this.page.goto(new URL(path, this.baseUrl).href)
  }
}

export { Page }
