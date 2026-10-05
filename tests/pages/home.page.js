import { Page } from '#pages/page'

class HomePage extends Page {
  open() {
    return super.open('/')
  }
}

export default new HomePage()
