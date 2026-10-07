import { Page } from '#pages/page.js'

class HomePage extends Page {
  async open() {
    await super.open('/')
  }
}

export { HomePage }
