# AGENTS.md — batteries-journey-tests

Read this file first, every session. It is the single source of truth for how
this repo works. Everything else is referenced from here:

| File                                                       | What it holds                                                           |
| ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| [README.md](README.md)                                     | Run commands, env vars, folder structure, Docker setup                  |
| [.ai/coding-rules.md](.ai/coding-rules.md)                 | Selectors, assertions, ESM, linting, what to avoid                      |
| [.ai/skills/ui-test/SKILL.md](.ai/skills/ui-test/SKILL.md) | Domain knowledge for writing UI tests: routes, page patterns, templates |
| [flows/README.md](flows/README.md) + `flows/*.md`          | One file per user journey, every branch marked with its status          |
| [feature-input.md](feature-input.md)                       | Single entry point for a new feature                                    |
| [.ai/migration-plan.md](.ai/migration-plan.md)             | WDIO → Playwright migration steps and decisions (while in progress)     |

## What this repo is

Regression E2E suite validating the UI components and user journeys of
**Batteries EPR** (Extended Producer Responsibility for waste batteries). It
runs on DEFRA's CDP Portal as a test suite and on GitHub against a Docker
Compose copy of the services.

The service is split into six repos, cloned as siblings of this one:

| Role                  | Repo                              | Local URL (`RUN_MODE=local`/`github`) |
| --------------------- | --------------------------------- | ------------------------------------- |
| Registration frontend | `waste-batteries-reg-frontend`    | http://localhost:3000                 |
| Submissions frontend  | `waste-batteries-submit-frontend` | http://localhost:3001                 |
| Obligations frontend  | `waste-batteries-obligations-fe`  | http://localhost:3002                 |
| Registration backend  | `waste-batteries-reg-backend`     | internal only (8085)                  |
| Submissions backend   | `waste-batteries-submit-backend`  | internal only (8085)                  |
| Obligations backend   | `waste-batteries-obligations-be`  | internal only (8085)                  |

Frontends are Node/Hapi (GOV.UK Frontend, Nunjucks); backends are .NET 10 with
MongoDB. Sign-in is Defra ID (a stub in Compose). Development of every service
is in progress, so expect `[PLANNED]` and `[BLOCKED]` branches in the flow
files.

## Session-start routine

Do this before anything else in every session:

1. Read [flows/README.md](flows/README.md) and the journey file relevant to the task.
2. Cross-reference it against the owning frontend's source — routes in
   `src/server/routes/*/index.js`, view data in `controller.js`, markup in
   `index.njk` (`../waste-batteries-reg-frontend/src`,
   `../waste-batteries-submit-frontend/src`, `../waste-batteries-obligations-fe/src`).
   Check the sibling is up to date with `origin/main` first; if it is behind,
   say so and read `origin/main` (e.g. `git -C <repo> fetch && git -C <repo> show origin/main:<path>`)
   rather than the stale checkout.
3. Flag every route or branch that exists in source but is still `[BLOCKED]` or
   `[PLANNED]` in a flow file (or is missing from it), and ask whether to update
   the flow file and write the test.

The frontend source is the ground truth. When it disagrees with a flow file,
source wins and the flow file is updated.

## Project structure

```
tests/
  specs/      # test files (*.e2e.js) — orchestration and assertions only
  pages/      # Page Objects (*.page.js) — UI interaction, one class per page
  flows/      # business workflows spanning several pages
  fixtures/   # test.extend() fixtures — inject Page Objects and flows
  utils/      # helpers (env.js: RUN_MODE, BROWSER, URLs, proxy)
flows/        # journey documentation with status markers (not code)
docker/       # Compose env files and floci / mongodb init scripts
playwright.config.js
compose.yml, compose.build.yml
action.yml    # composite action other repos use to run this suite
```

`tests/wdio/` and the `wdio.*.conf.js` files are the legacy WebdriverIO suite,
kept only until migration step 8 removes them. Do not extend them.

### Layers

```
Spec files       → test orchestration and assertions
      ↓
Flows            → reusable business workflows spanning multiple pages
      ↓
Page Objects     → UI interaction abstraction
      ↓
Playwright       → framework primitives
```

- Specs never contain selectors or low-level UI interactions.
- Page Objects never contain business workflows or multi-page logic.
- Flows encapsulate journeys and cross-page behaviour; add one only when two or
  more specs need the same multi-page sequence.
- Fixtures (`tests/fixtures/index.js`) create Page Objects and flows per test.
  Specs import `test` and `expect` from `#fixtures/index.js`, never from
  `@playwright/test` directly.
- Reusable assertions may live in Page Objects or flows (as `expect…` methods)
  so journeys can share them; one-off assertions stay in the spec.

Import aliases (`package.json` `imports`): `#pages/*`, `#flows/*`,
`#fixtures/*`, `#utils/*`. Always include the `.js` extension.

Full rules: [.ai/coding-rules.md](.ai/coding-rules.md).

## Adding a new feature

1. The user fills in [feature-input.md](feature-input.md) and says
   **"New feature input given"**.
2. Run the session-start routine for the journey named in it.
3. **Coverage-gap analysis (hard gate).** Read the latest integration and unit
   tests in the relevant frontends (`src/**/*.test.js`) and backends
   (`*.Test/**/*.cs`) and give a per-acceptance-criterion recommendation:

   | Recommendation                       | When                                                                                    |
   | ------------------------------------ | --------------------------------------------------------------------------------------- |
   | **Write E2E**                        | Only verifiable end-to-end: cross-service routing, a full journey, confirmation content |
   | **Descope from E2E**                 | Already covered by unit or integration tests (name the test)                            |
   | **Enhance integration test instead** | Better tested lower down — name the exact file to extend                                |

   E2E is the most expensive tier; keep the suite lean. If a sibling repo is
   missing or unreadable, stop and ask — never invent findings.

4. Present the revised scope and **wait for approval** before writing anything.
5. Update the flow file first (marker, headings, fields, routing), then write
   the test. See the maintenance rule in [flows/README.md](flows/README.md).
6. Reset `feature-input.md` to its blank form in the same change.

## Adding a test — checklist

- [ ] Flow file updated first and the branch is `[IMPLEMENTED]`.
- [ ] Page, labels and routes taken from the frontend source, not guessed.
- [ ] Page Object extends `Page` (`tests/pages/page.js`) or an existing Page Object
      gains the new behaviour; registered as a fixture.
- [ ] Spec in `tests/specs/<area>.e2e.js`, uses fixtures, has no selectors.
- [ ] Tagged when it belongs to a run profile (`{ tag: '@smoke' }`).
- [ ] Role/label/test-id locators only; no `waitForTimeout`; web-first assertions.
- [ ] Independent of other tests and of run order (parallel-safe).
- [ ] `npm run pw:local` passes against running services, and `npm run pw:github`
      passes against the Compose stack.
- [ ] `npm run lint` and `npm run format:check` pass.

## Run modes

| Mode   | Services                     | Command                                         |
| ------ | ---------------------------- | ----------------------------------------------- |
| local  | Already running on localhost | `npm run pw:local` (headed, report opens after) |
| github | Docker Compose stack         | `npm run stack:up` then `npm run pw:github`     |
| e2e    | Deployed CDP environment     | `ENVIRONMENT=dev npm run pw:e2e`                |

`pw:*` scripts become `test:*` when migration step 8 lands. Details, env vars
and Docker set-up: [README.md](README.md).

## CI and platform constraints

- **CDP Portal**: on merge to `main`, `.github/workflows/publish.yml` publishes a
  Docker image; the Portal runs the latest successful build. Confirm the latest
  build is green in GitHub Actions before triggering a Portal run.
- **2-hour hard timeout** on Portal runs. `globalTimeout` stops the run at 1h55
  so the report is still published. Keep the suite well inside this.
- **`PROFILE`** (set on the Portal) maps to Playwright `grep`: it filters tests
  by title or `@tag`. A profile matching no tests fails the run on purpose.
- **Report**: Playwright HTML, `playwright-report/index.html`, uploaded by
  `bin/publish-tests.sh` (`DIRECTORY` points at `playwright-report`). If the
  report location changes, update that script.
- **Proxy**: the Portal sets `HTTP_PROXY`; `tests/utils/env.js` passes it to the
  browser.
- **GitHub**: `.github/workflows/journey-tests.yml` (filename fixed — service
  repos depend on it) runs on every PR via `check-pull-request.yml` and on
  demand. Service versions:
  - `Depends-On: <repo>#<branch>` lines in the PR description (one per repo,
    any of the six) → that branch is built on the runner;
  - or a `*-branch` workflow input;
  - otherwise the DockerHub image (`latest`, built from main).
- **Root `action.yml`** runs the suite against the Compose stack; its
  `*-tag` inputs map to the `*_TAG` variables in `compose.yml`.

## Things that will bite you

- DockerHub images are linux/amd64 only. On Apple silicon without Rosetta
  emulation the .NET backends return 500 on `/health` and Chromium crashes in
  the amd64 test image. Use `npm run stack:up:build` (native builds) locally.
- Page titles are `<pageTitle> | <serviceName>`. Every CDP service has a "Home"
  page (the Defra ID stub included), so assert the full title to prove which
  service answered.
- Browser sign-in is not wired up yet: services reach the Defra ID stub as
  `cdp-defra-id-stub:3200`, which the browser cannot resolve. The first login
  journey must map it to `localhost:3200`.
- All frontends run on `localhost`, so cookies (e.g. `userSession`) are shared
  across ports. Expect interference once journeys sign in to more than one
  frontend.
