# Coding rules

Rules for all code under `tests/`. Structure and workflow are in
[AGENTS.md](../AGENTS.md); domain knowledge is in
[skills/ui-test/SKILL.md](skills/ui-test/SKILL.md).

## Language and modules

- JavaScript, ES modules only (`"type": "module"`). `import`/`export`, never
  `require`.
- `async`/`await` everywhere; no `.then()` chains, no callbacks.
- Import through the aliases with the `.js` extension:
  `import { HomePage } from '#pages/home.page.js'`.
- Export classes and functions by name (`export { HomePage }`). No default
  exports, no singleton instances — Page Objects are created per test by
  fixtures.
- Specs import `test` and `expect` from `#fixtures/index.js` only.

## Naming

| Thing       | Location                  | File                | Export                     |
| ----------- | ------------------------- | ------------------- | -------------------------- |
| Spec        | `tests/specs/`            | `<area>.e2e.js`     | —                          |
| Page Object | `tests/pages/`            | `<page>.page.js`    | `class <Page>Page`         |
| Flow        | `tests/flows/`            | `<journey>.flow.js` | `class <Journey>Flow`      |
| Fixture     | `tests/fixtures/index.js` | —                   | camelCase, e.g. `homePage` |
| Helper      | `tests/utils/`            | `<topic>.js`        | named functions/consts     |

Test titles describe observable behaviour: `'Should show the Home page'`, not
`'test home'`.

## Locators

Prefer, in order:

1. `getByRole(role, { name })` — buttons, links, headings, form controls.
2. `getByLabel('Label text')` — form fields (GOV.UK labels are always present).
3. `getByText(...)` — static content with no better handle.
4. `getByTestId(...)` — the frontends' `data-testid` hooks (e.g.
   `app-heading-title`, `app-signed-in-user`).

CSS or XPath only when none of the above can identify the element, with a
comment saying why. Never use generated GOV.UK classes (`govuk-!-margin-…`) or
DOM position (`nth-child`, `.first()` on an ambiguous list) to select.

Locators live in Page Objects as getters returning a `Locator`:

```js
get saveButton() {
  return this.page.getByRole('button', { name: 'Save' })
}
```

## Waiting and assertions

- No `page.waitForTimeout()` or other fixed sleeps. Rely on auto-waiting.
- Web-first assertions only: `await expect(locator).toHaveText(...)`,
  `toBeVisible()`, `toHaveURL()`, `toHaveTitle()`. Never
  `expect(await locator.textContent()).toBe(...)`.
- Assert what proves the right service answered: full page titles
  (`'Home | waste-batteries-reg-frontend'`), not just `Home`.
- One-off assertions stay in the spec. An assertion reused across journeys may
  become an `expect…()` method on the Page Object or flow, e.g.
  `expectErrorSummary(message)`.
- Do not assert on implementation detail (classes, inline styles, hidden
  inputs such as the CSRF `crumb`).

## Isolation and determinism

- Every test must pass alone, in any order, and in parallel
  (`fullyParallel: true`).
- No shared mutable state between tests: no module-level variables holding
  pages, users or data.
- Create the data a test needs inside the test (or a fixture) with values
  unique per run, e.g. include `test.info().testId` or a timestamp.
- Never depend on data another test created.
- No `test.only` (CI forbids it) and no permanently skipped tests; use a flow
  file `[BLOCKED]` marker instead of `test.skip` for features that cannot be
  tested yet.

## Configuration

- Read environment through `tests/utils/env.js` (`runMode`, `frontendUrls`,
  `browserName`, `proxyConfig`). Do not read `process.env` in specs or Page
  Objects.
- Navigate with paths (`page.goto('/about')`); `baseURL` is the registration
  frontend. For another frontend, use `frontendUrls.submissions` /
  `frontendUrls.obligations` from a Page Object, never a hard-coded host.
- No secrets in the repo. Credentials come from env vars set by the Portal or
  the workflow.

## Linting and formatting

- `npm run lint` (ESLint) and `npm run format:check` (Prettier) must pass; the
  pre-commit hook runs both.
- `eslint-plugin-playwright` (recommended rules) runs on `tests/`; it fails
  the build on `waitForTimeout`, `test.only`, `test.skip` and tests with no
  assertion.
- Prettier style: no semicolons, single quotes, 2-space indent, no trailing
  commas.
- `no-console` is an error — use Playwright's reporters, `test.info()`
  annotations or attachments instead.

## What to avoid

- Selectors, `page.locator(...)` calls or `page.goto` in specs.
- Business workflows or cross-page navigation inside a Page Object.
- New abstractions with a single call site (a wrapper, base class or helper
  used once).
- Retrying flaky steps in code (`for` loops around clicks, `try`/`catch`
  around assertions). Fix the cause.
- Editing generated output: `playwright-report/`, `test-results/`.
