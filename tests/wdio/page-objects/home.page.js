import { Page } from './page.js'

class HomePage extends Page {
  open() {
    return super.open('/')
  }
}

export default new HomePage()
