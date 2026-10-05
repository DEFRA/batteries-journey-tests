# batteries-journey-tests

Regression E2E suite for **Batteries EPR**, validating UI components and user
journeys across the registration, submissions and obligations services. Built
on [Playwright Test](https://playwright.dev/) (JavaScript, ESM) and run on the
CDP Portal, on GitHub, or locally.

Working on this repo with an AI agent? Start at [AGENTS.md](AGENTS.md).

- [Prerequisites](#prerequisites)
- [Setup](#setup)
- [Running the tests](#running-the-tests)
  - [Against services already running on localhost](#against-services-already-running-on-localhost)
  - [Against the Docker Compose stack](#against-the-docker-compose-stack)
  - [Against a CDP environment](#against-a-cdp-environment)
- [Environment variables](#environment-variables)
- [Folder structure](#folder-structure)
- [Docker Compose stack](#docker-compose-stack)
- [CDP Portal](#cdp-portal)
- [GitHub workflow](#github-workflow)
- [Licence](#licence)

## Prerequisites

- [Node.js](http://nodejs.org/) `>= 24` (`nvm use` picks up `.nvmrc`)
- [Docker](https://www.docker.com/) with Compose v2
- [AWS CLI](https://aws.amazon.com/cli/) — for poking floci (local AWS) resources
- [awslocal](https://github.com/localstack/awscli-local) (optional) — preconfigured AWS CLI wrapper
- The six service repos cloned next to this one (needed to build them from
  source and for agents to read their code):

  ```
  ../waste-batteries-reg-frontend      ../waste-batteries-reg-backend
  ../waste-batteries-submit-frontend   ../waste-batteries-submit-backend
  ../waste-batteries-obligations-fe    ../waste-batteries-obligations-be
  ```

Previously published images of every service are on
[DEFRA DockerHub](https://hub.docker.com/u/defradigital).

## Setup

```bash
nvm use
npm install
npx playwright install chromium   # add firefox / webkit to test those browsers
```

## Running the tests

Three run modes, chosen with `RUN_MODE` (the npm scripts set it for you).

### Against services already running on localhost

Fastest loop for writing a test. Start the frontends (and the backends they
call) with their own run scripts, e.g. for registration:

```bash
cd ../waste-batteries-reg-frontend
docker compose up -d --wait cdp-defra-id-stub redis   # Defra ID stub + Redis
npm run dev                                            # http://localhost:3000
```

Then:

```bash
npm run test:local
```

The browser is visible and the HTML report opens when the run finishes. Point
at other ports with `REGISTRATION_FRONTEND_URL`, `SUBMISSIONS_FRONTEND_URL` or
`OBLIGATIONS_FRONTEND_URL`.

### Against the Docker Compose stack

Closest local copy of CI. This is the same command the GitHub workflow runs.

```bash
npm run stack:up        # pull DockerHub images, start everything, wait for health
npm run test:github
npm run stack:down
```

On Apple silicon, build the services from the sibling repos instead (see
[Docker Compose stack](#docker-compose-stack)):

```bash
npm run stack:up:build
npm run test:github
```

### Against a CDP environment

```bash
ENVIRONMENT=dev npm run test:e2e
ENVIRONMENT=test npm run test:e2e
```

Targets `https://waste-batteries-*.${ENVIRONMENT}.cdp-int.defra.cloud`. CDP
environments are only reachable from the platform, so this normally runs on the
[CDP Portal](#cdp-portal).

### Other useful commands

```bash
BROWSER=firefox npm run test:github     # chromium (default), firefox, webkit
PROFILE=@smoke npm run test:github      # only tests whose title or tag matches
npm run test:report                   # reopen the last HTML report
npm run test:local:debug              # step through with the Playwright Inspector
npm run lint && npm run format:check
```

## Environment variables

| Variable                    | Default                          | Purpose                                                                |
| --------------------------- | -------------------------------- | ---------------------------------------------------------------------- |
| `RUN_MODE`                  | `local`                          | `local`, `github` or `e2e` (set by the npm scripts)                    |
| `ENVIRONMENT`               | `dev`                            | CDP environment for `e2e` mode                                         |
| `BROWSER`                   | `chromium`                       | `chromium`, `firefox` or `webkit`                                      |
| `HEADED`                    | `false` (`true` in `test:local`) | Show the browser                                                       |
| `PROFILE`                   | —                                | Filter tests by title or `@tag` (regex), e.g. `@smoke`                 |
| `REGISTRATION_FRONTEND_URL` | `http://localhost:3000`          | Registration frontend (ignored in `e2e` mode)                          |
| `SUBMISSIONS_FRONTEND_URL`  | `http://localhost:3001`          | Submissions frontend (ignored in `e2e` mode)                           |
| `OBLIGATIONS_FRONTEND_URL`  | `http://localhost:3002`          | Obligations frontend (ignored in `e2e` mode)                           |
| `HTTP_PROXY`                | —                                | Egress proxy; set by the CDP Portal                                    |
| `CI`                        | —                                | Set by `test:github`: one worker, one retry, `test.only` forbidden     |
| `<SERVICE>_TAG`             | `latest`                         | Compose image tag per service, e.g. `WASTE_BATTERIES_REG_FRONTEND_TAG` |
| `<SERVICE>_PATH`            | `../<service>`                   | Source location for `compose.build.yml`                                |

## Folder structure

```
tests/
  specs/      # test files (*.e2e.js)
  pages/      # Page Objects (*.page.js)
  flows/      # business workflows spanning several pages
  fixtures/   # test.extend() fixtures
  utils/      # helpers (env.js)
flows/        # journey documentation with status markers
.ai/          # agent rules, skills and the migration plan
docker/
  config/     # defaults.env + one .env per service
  scripts/    # floci and mongodb init scripts
bin/publish-tests.sh   # uploads the report on the CDP Portal
playwright.config.js
compose.yml, compose.build.yml
action.yml             # composite action for running this suite from other repos
```

## Docker Compose stack

[`compose.yml`](compose.yml) runs everything on one network
(`batteries-journey-tests`), so services resolve each other by name:

| Service                           | Host port | Notes                                         |
| --------------------------------- | --------- | --------------------------------------------- |
| `waste-batteries-reg-frontend`    | 3000      |                                               |
| `waste-batteries-submit-frontend` | 3001      |                                               |
| `waste-batteries-obligations-fe`  | 3002      |                                               |
| three backends                    | —         | port 8085 inside the network                  |
| `mongodb`, `redis`                | —         |                                               |
| `floci`                           | 4566      | LocalStack substitute: S3, SQS, SNS, DynamoDB |
| `cdp-defra-id-stub`               | 3200      | Defra ID sign-in stub                         |
| `cdp-uploader`                    | 7337      | File uploads with mocked virus scanning       |
| `playwright` (profile)            | —         | Optional: run the suite inside the stack      |

- **Image versions**: `docker compose pull` before a run (Compose does not
  auto-pull). Pin a version with its tag variable:
  `WASTE_BATTERIES_REG_FRONTEND_TAG=0.9.0 npm run stack:up`.
- **Build from source**: [`compose.build.yml`](compose.build.yml) builds all
  six services from the sibling repos as `:local` images. To test a service
  branch locally, check it out in the sibling and build only that service:

  ```bash
  git -C ../waste-batteries-reg-frontend switch feature/my-branch
  docker compose -f compose.yml -f compose.build.yml build waste-batteries-reg-frontend
  WASTE_BATTERIES_REG_FRONTEND_TAG=local npm run stack:up
  ```

- **Apple silicon**: DockerHub images are linux/amd64 only. Without Rosetta
  emulation (Rancher Desktop → Preferences → Virtual Machine → Emulation, or
  the Docker Desktop equivalent) the .NET backends fail their health checks.
  `npm run stack:up:build` avoids this by building native images.
- **Configuration**: `docker/config/defaults.env` holds shared settings;
  each service has its own `docker/config/<service>.env`.
- **AWS resources**: scripts in `docker/scripts/floci/` run when floci starts
  (buckets and queues for `cdp-uploader`, the Defra ID stub's DynamoDB table).
  Add service resources there.
- **Adding a service**: copy one of the commented examples at the bottom of
  `compose.yml`, add its `.env` file, and add a build entry in
  `compose.build.yml`.
- **Tests inside the stack**: `docker compose --profile playwright run --rm playwright`.

## CDP Portal

Tests run from the CDP Portal under **Test Suites**: select this suite, pick
the environment, optionally set `PROFILE`, then **Run**. The Portal returns
pass/fail and a link to the report.

- Merging to `main` builds and publishes a new image
  (`.github/workflows/publish.yml`); the Portal always runs the latest
  successful build. Check the build is green in GitHub Actions before running.
- `entrypoint.sh` runs the suite in `e2e` mode, then `bin/publish-tests.sh`
  uploads `playwright-report/` (entry point `index.html`) to S3. The container
  exits non-zero if any test fails.
- Runs are killed after **2 hours**; the suite stops itself at 1h55 so the
  report is still published.
- `PROFILE` is passed straight to Playwright as a `grep` filter (title or
  `@tag`).

To build and run the image yourself (against the Compose stack):

```bash
docker build -t batteries-journey-tests .
docker run --rm --network batteries-journey-tests_batteries-journey-tests \
  -e RUN_MODE=github \
  -e REGISTRATION_FRONTEND_URL=http://waste-batteries-reg-frontend:3000 \
  batteries-journey-tests
```

(Without `RESULTS_OUTPUT_S3_PATH` the publish step reports that it is unset.)

## GitHub workflow

[`.github/workflows/journey-tests.yml`](.github/workflows/journey-tests.yml)
starts the Compose stack on the runner and runs `npm run test:github`. It runs
on every pull request (via `check-pull-request.yml`) and can be started by hand
or called from another workflow.

**Choosing service versions**, highest priority first:

1. `Depends-On:` lines in the pull request description, one per repo:

   ```
   Depends-On: waste-batteries-reg-frontend#feature/foo
   Depends-On: DEFRA/waste-batteries-obligations-be#bugfix/bar
   ```

2. The `*-branch` inputs when started by hand (Actions → Run Journey Tests on
   GitHub → Run workflow), along with the journey-tests branch and browser.
3. Otherwise the published DockerHub image (`latest`, built from main).

A chosen branch is checked out and built on the runner; the log of the
"Resolve service branches" step shows the ref used for every service.

**From a service repo**, run the suite against a newly built image with the
composite action:

```yaml
- uses: DEFRA/batteries-journey-tests@main
  with:
    waste-batteries-reg-frontend-tag: ${{ steps.version.outputs.tag }}
```

The Playwright report and Compose logs are uploaded as workflow artifacts.

## Licence

THIS INFORMATION IS LICENSED UNDER THE CONDITIONS OF THE OPEN GOVERNMENT LICENCE found at:

<http://www.nationalarchives.gov.uk/doc/open-government-licence/version/3>

The following attribution statement MUST be cited in your products and applications when using this information.

> Contains public sector information licensed under the Open Government licence v3

### About the licence

The Open Government Licence (OGL) was developed by the Controller of Her Majesty's Stationery Office (HMSO) to enable
information providers in the public sector to license the use and re-use of their information under a common open
licence.

It is designed to encourage use and re-use of information freely and flexibly, with only a few conditions.
