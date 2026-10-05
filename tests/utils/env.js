// Run-mode aware environment settings shared by playwright.config.js and fixtures.
//
// RUN_MODE:
//   local  — services already running on localhost (§7.1a)
//   github — services in Docker Compose, ports published to the host (§7.1b / CI)
//   e2e    — deployed services in a CDP environment selected by ENVIRONMENT

const runModes = ['local', 'github', 'e2e']
const browsers = ['chromium', 'firefox', 'webkit']

export const runMode = process.env.RUN_MODE ?? 'local'
export const environment = process.env.ENVIRONMENT ?? 'dev'
export const browserName = process.env.BROWSER ?? 'chromium'

if (!runModes.includes(runMode)) {
  throw new Error(
    `RUN_MODE must be one of ${runModes.join(', ')} — got "${runMode}"`
  )
}

if (!browsers.includes(browserName)) {
  throw new Error(
    `BROWSER must be one of ${browsers.join(', ')} — got "${browserName}"`
  )
}

const cdpUrl = (service) =>
  `https://${service}.${environment}.cdp-int.defra.cloud`

// Local and Compose ports: registration keeps the frontend default (3000);
// submissions and obligations are remapped so all three can run side by side.
// Each URL can be overridden with its own env var.
const localUrls = {
  registration: 'http://localhost:3000',
  submissions: 'http://localhost:3001',
  obligations: 'http://localhost:3002'
}

const e2eUrls = {
  registration: cdpUrl('waste-batteries-reg-frontend'),
  submissions: cdpUrl('waste-batteries-submit-frontend'),
  obligations: cdpUrl('waste-batteries-obligations-fe')
}

// In e2e mode the CDP Portal injects BASE_URL pointing at the portal gateway,
// not a service — so overrides only apply outside e2e.
const pick = (name, envVar) =>
  runMode === 'e2e' ? e2eUrls[name] : (process.env[envVar] ?? localUrls[name])

export const frontendUrls = {
  registration: pick('registration', 'REGISTRATION_FRONTEND_URL'),
  submissions: pick('submissions', 'SUBMISSIONS_FRONTEND_URL'),
  obligations: pick('obligations', 'OBLIGATIONS_FRONTEND_URL')
}

// CDP runs tests behind an egress proxy and sets HTTP_PROXY.
export const proxyConfig = process.env.HTTP_PROXY
  ? { server: process.env.HTTP_PROXY }
  : undefined
