class Page {
  /**
   * @param {import('@playwright/test').Page} page
   */
  constructor(page) {
    this.page = page
  }

  get pageHeading() {
    return this.page.getByRole('heading', { level: 1 })
  }

  async open(path) {
    await this.page.goto(path)
  }
}

export { Page }
