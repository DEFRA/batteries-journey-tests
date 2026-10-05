---
name: ui-test
description: Domain knowledge for writing Playwright UI tests for the Batteries EPR frontends — routes, page structure, GOV.UK selector patterns, and Page Object / fixture / spec templates. Use when adding or changing a test under tests/.
---

# UI test skill — Batteries EPR

Read [AGENTS.md](../../../AGENTS.md) and [coding-rules.md](../../coding-rules.md)
first. This file is domain knowledge only; the frontend source is still the
ground truth, so confirm anything here against it before relying on it.

Snapshot taken from `origin/main` of each frontend on 2026-10-05
(reg `48f751e`, submit `9f6695c`, obligations `34ef3ea`).

## The three frontends

All three are the same CDP Node frontend scaffold (Hapi, Nunjucks, GOV.UK
Frontend) with Defra ID sign-in. Service-specific pages are not built yet.

| Frontend     | Repo                              | `frontendUrls.` | Local / Compose URL   | `serviceName` (title suffix)      |
| ------------ | --------------------------------- | --------------- | --------------------- | --------------------------------- |
| Registration | `waste-batteries-reg-frontend`    | `registration`  | http://localhost:3000 | `waste-batteries-reg-frontend`    |
| Submissions  | `waste-batteries-submit-frontend` | `submissions`   | http://localhost:3001 | `waste-batteries-submit-frontend` |
| Obligations  | `waste-batteries-obligations-fe`  | `obligations`   | http://localhost:3002 | `waste-batteries-obligations-fe`  |

`baseURL` is the registration frontend, so `page.goto('/')` opens registration
`/`. `serviceName` comes from `config.serviceName` and is expected to change
to a real service name — update the assertions when it does.

## Routes (identical in all three)

| Method | Path                  | Auth                     | View / behaviour                                                         |
| ------ | --------------------- | ------------------------ | ------------------------------------------------------------------------ |
| GET    | `/`                   | optional (`mode: 'try'`) | `home/index` — title `Home`, heading `Home`                              |
| GET    | `/about`              | optional                 | `about/index` — title `About`, heading `About`, breadcrumbs Home › About |
| GET    | `/example`            | **signed in**            | `example/index` — form with "Example Text" input, Save button            |
| POST   | `/example`            | **signed in**            | Saves via backend; redirects to `/example` with success banner           |
| GET    | `/auth/sign-in`       | starts Defra ID          | Redirects to Defra ID, then back to `/` (or the page that asked)         |
| GET    | `/auth/sign-in-oidc`  | Defra ID callback        | Failure → `unauthorised/index`, title "We could not sign you in"         |
| GET    | `/auth/sign-out`      | session                  | Clears the session, redirects to Defra ID end-session                    |
| GET    | `/auth/sign-out-oidc` | none                     | Post-logout callback, redirects to `/`                                   |
| GET    | `/auth/organisation`  | Defra ID                 | Switch organisation                                                      |
| GET    | `/health`             | none                     | JSON health check (not a UI route — don't E2E it)                        |

A protected route visited while signed out redirects to
`/auth/sign-in?redirect=<path>`, which starts Defra ID sign-in and returns to
`<path>` afterwards.
Routes register in `src/server/plugins/router.js`; each route lives in
`src/server/routes/<name>/` (`index.js` route, `controller.js` view data,
`index.njk` markup).

## Page anatomy

Every page extends `src/server/common/templates/layouts/page.njk`:

| Part               | Markup                                                                           | Locator                                                            |
| ------------------ | -------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Document title     | `<pageTitle> \| <serviceName>`                                                   | `expect(page).toHaveTitle('Home \| waste-batteries-reg-frontend')` |
| Main heading       | `<h1 data-testid="app-heading-title">` (from `appHeading`)                       | `page.getByRole('heading', { level: 1 })`                          |
| Heading caption    | `<span data-testid="app-heading-caption">` (service repo name)                   | `page.getByTestId('app-heading-caption')`                          |
| Body               | `<div data-testid="app-page-body">`                                              | `page.getByTestId('app-page-body')`                                |
| Service navigation | GOV.UK service navigation: Home, About; + Example when signed in                 | `page.getByRole('link', { name: 'About' })`                        |
| Signed out         | "Sign in" link under the header                                                  | `page.getByRole('link', { name: 'Sign in' })`                      |
| Signed in          | Account bar `data-testid="app-signed-in-user"` with org, email, name, "Sign out" | `page.getByTestId('app-signed-in-user')`                           |
| Breadcrumbs        | GOV.UK breadcrumbs when more than one crumb                                      | `page.getByRole('navigation', { name: 'Breadcrumb' })`             |

The GOV.UK header logo SVG has its own `<title>GOV.UK</title>`; that is not
the document title.

## GOV.UK component patterns

| Component           | What renders                                                                               | Locator                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| Text input          | `<label for="id">` + `<input id="id">`                                                     | `page.getByLabel('Example Text')`                                            |
| Button              | `<button class="govuk-button">Save</button>`                                               | `page.getByRole('button', { name: 'Save' })`                                 |
| Error summary       | `.govuk-error-summary` with `role="alert"`, title "There is a problem", links to fields    | `page.getByRole('alert').filter({ hasText: 'There is a problem' })`          |
| Field error         | `<p class="govuk-error-message"><span class="govuk-visually-hidden">Error:</span> msg</p>` | `expect(page.getByLabel('Example Text')).toHaveAccessibleDescription(/msg/)` |
| Success banner      | `.govuk-notification-banner--success`, `role="alert"`, heading "Success"                   | `page.getByRole('alert').filter({ hasText: 'Success' })`                     |
| Radios / checkboxes | `<fieldset>` + `<legend>` + labelled inputs                                                | `page.getByRole('group', { name: legend }).getByLabel(option)`               |
| Links               | `<a class="govuk-link">`                                                                   | `page.getByRole('link', { name })`                                           |

Forms post a hidden CSRF `crumb`; fill and submit through the UI, never post
directly.

Example validation (registration `/example`): empty or whitespace input →
HTTP 400, error summary and field error "Enter example text"; backend failure
on save → 500 with "There was a problem saving the example text".

## Where the lower-level tests live (for coverage-gap analysis)

- Frontends: Vitest `*.test.js` next to the code, using
  `server.inject` — e.g. `src/server/routes/home/controller.test.js` asserts
  `/` returns 200 and contains `Home |`. Route, controller, auth and component
  templates are all covered this way.
- Backends: xUnit under `<Project>.Test/` — `Example/Endpoints/ExampleEndpointsTest.cs`,
  `ExampleData/Endpoints/ExampleDataEndpointsTest.cs`, model tests, and
  `Utils/TestAuthentication.cs`.

## Templates

### Page Object — `tests/pages/<name>.page.js`

```js
import { Page } from '#pages/page.js'

class ExamplePage extends Page {
  get exampleTextInput() {
    return this.page.getByLabel('Example Text')
  }

  get saveButton() {
    return this.page.getByRole('button', { name: 'Save' })
  }

  get successBanner() {
    return this.page.getByRole('alert').filter({ hasText: 'Success' })
  }

  async open() {
    await super.open('/example')
  }

  async save(text) {
    await this.exampleTextInput.fill(text)
    await this.saveButton.click()
  }
}

export { ExamplePage }
```

### Fixture — add to `tests/fixtures/index.js`

```js
examplePage: async ({ page }, use) => {
  await use(new ExamplePage(page))
}
```

### Page on another frontend

```js
import { Page } from '#pages/page.js'
import { frontendUrls } from '#utils/env.js'

class SubmissionsHomePage extends Page {
  async open() {
    await super.open(new URL('/', frontendUrls.submissions).href)
  }
}

export { SubmissionsHomePage }
```

### Flow — `tests/flows/<journey>.flow.js` (only when two or more specs share it)

```js
class SignInFlow {
  constructor({ homePage, signInPage }) {
    this.homePage = homePage
    this.signInPage = signInPage
  }

  async signInAs(user) {
    await this.homePage.open()
    await this.homePage.signInLink.click()
    await this.signInPage.completeAs(user)
  }
}

export { SignInFlow }
```

### Spec — `tests/specs/<area>.e2e.js`

(`/example` needs a signed-in user, so this spec stays `[BLOCKED]` until sign-in
is wired up — it shows the shape, not a test to add today.)

```js
import { test, expect } from '#fixtures/index.js'

test.describe('Example page', () => {
  test(
    'Should save example text',
    { tag: '@regression' },
    async ({ examplePage }) => {
      await examplePage.open()
      await examplePage.save(`text ${test.info().testId}`)

      await expect(examplePage.successBanner).toContainText(
        'Example text saved'
      )
    }
  )
})
```

## Tags

| Tag           | Meaning                                                    |
| ------------- | ---------------------------------------------------------- |
| `@smoke`      | Fast check that each deployed service is up and serving UI |
| `@regression` | Full journey coverage                                      |

Select them with `PROFILE` (e.g. `PROFILE=@smoke`). Add new tags to this table.
