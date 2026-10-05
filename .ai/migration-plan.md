# WDIO → Playwright Migration Plan

Anchor for agent sessions working on the migration on branch
`feature/convert-wdio-to-playwright`. Update the status column as steps land.

## Working agreement

- One step at a time; stop after each step with a brief (**What we have done** / **What is next**).
- Each step ends in one commit. Bulk moves get their own commit.
- WDIO / BrowserStack / Allure are removed only in step 8, after Playwright is proven.
- `playwright-migration-prompt-batteries.md` is a local working file — **never commit it**.

## Decisions (agreed 2026-10-05)

| Topic                    | Decision                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Journeys                 | No business journey is ready yet. The single journey in scope is "navigate to the home page (`/`)". One flow file covers it.          |
| Smoke target             | Home page (`/`) only.                                                                                                                 |
| Root `action.yml` (§7.4) | Root `action.yml` exposes one image-tag input per service; input names match the Compose override variables.                          |
| Data stores              | MongoDB (not Postgres) and floci (LocalStack substitute), matching the backends' own `compose.yml`. Redis for frontend sessions.      |
| Auth                     | Frontends fetch Defra ID OIDC discovery at startup, so Compose includes `cdp-defra-id-stub`. `/` is public (`auth: { mode: 'try' }`). |
| Playwright container     | Optional, behind a Compose profile. `npm run test:github` runs on the host against published ports.                                   |
| `PROFILE`                | Mapped to Playwright `grep` (test titles / `@tags`, e.g. `@smoke`).                                                                   |
| Report                   | Playwright HTML reporter (`playwright-report/index.html`); `bin/publish-tests.sh` `DIRECTORY` updated accordingly.                    |

## Context discovered

- Frontends (reg / submit / obligations): Node + Hapi, port 3000 by default, scaffold routes only (home, about, auth, health, example). Home page title and heading: `Home`.
- Backends (reg / submit / obligations): .NET 10, port 8085 by default, MongoDB + floci, JWT via Defra ID stub.
- Template's `journey-tests.yml` wrongly calls `DEFRA/cdp-node-journey-test-suite-template/run-journey-tests@main` — fixed in step 6.
- Registration home page title is `Home | waste-batteries-reg-frontend` (`<pageTitle> | <serviceName>`). The CDP Defra ID stub serves `Home | cdp-defra-id-stub`, so the smoke spec asserts the full title to prove it hit the right service.
- The template WDIO spec asserts title `Home` exactly and has always failed against this frontend. It lives in `tests/wdio/` until step 8 deletes it.
- Running the registration frontend locally: `docker compose up -d --wait cdp-defra-id-stub redis` then `npm run dev` in `../waste-batteries-reg-frontend`.

## Steps

| #   | Step                                                    | Produces                                                                                                                                                                                                                                                                        | Does not yet do                  | Status |
| --- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------ |
| 1   | Bulk move `test/` → `tests/` (`page-objects` → `pages`) | Renamed tree, aliases + WDIO spec globs updated, WDIO still runnable                                                                                                                                                                                                            | No Playwright                    | Done   |
| 2   | Add Playwright alongside WDIO                           | `@playwright/test`, `playwright.config.js` (`RUN_MODE`, `BROWSER`, `HEADED`, `ENVIRONMENT`, proxy, per-frontend base URLs, `PROFILE`→grep, HTML report), temporary `pw:*` scripts                                                                                               | No specs; WDIO scripts untouched | Done   |
| 3   | Port Page Objects + smoke spec                          | §4.3 layout; fixture-injected `BasePage`/`HomePage` classes; `@smoke` home page spec; proven against locally running frontend (§7.1a)                                                                                                                                           | No Compose, no CI                | Done   |
| 4   | Compose stack                                           | Six services from DockerHub with tag overrides, Mongo, Redis, floci, defra-id-stub, cdp-uploader, one network, commented examples, `compose.build.yml` (build from siblings), `./docker` scripts and per-service `.env`; proven via `docker compose up` + `npm run test:github` | No workflow changes              |        |
| 5   | Portal image                                            | Dockerfile on Playwright base image (no Java), `entrypoint.sh` (`ENVIRONMENT`, `PROFILE`, `FAILED` marker), `publish-tests.sh` → `playwright-report`; proven by local image run                                                                                                 | CI not wired                     |        |
| 6   | CI                                                      | Root `action.yml`, `journey-tests.yml` with branch inputs + `Depends-On:` parsing, template-action bug fixed, `publish.yml` / `check-pull-request.yml` updated                                                                                                                  | Proving needs a push — ask first |        |
| 7   | Agent artefacts                                         | `AGENTS.md`, `CLAUDE.md`, `README.md`, `.ai/coding-rules.md`, `.ai/skills/ui-test/SKILL.md`, `flows/README.md` + home flow file, `feature-input.md`                                                                                                                             | No journey test code             |        |
| 8   | Remove WDIO / BrowserStack / Allure (labelled commit)   | Old configs + deps gone, `pw:*` scripts become `test:local` / `test:github` / `test:e2e`, Playwright lint rules                                                                                                                                                                 | —                                |        |
| 9   | DoD audit                                               | Every §8 item ticked with evidence; this file updated                                                                                                                                                                                                                           | —                                |        |
