// Writes a Defra ID stub access token for a CDP environment to the repo root.
//
//   npm run token -- dev    -> dev-token.txt
//   npm run token -- test   -> test-token.txt
//
// Uses the same sign-in as the API tests (tests/utils/defra-id.js), against the
// stub deployed in the chosen CDP environment. The token files are gitignored.
// Optional: DEFRA_ID_USER overrides the stub user.
import { writeFileSync } from 'node:fs'

import { request } from '@playwright/test'

const environments = ['dev', 'test']
const environment = process.argv[2]

if (!environments.includes(environment)) {
  throw new Error(`Usage: npm run token -- <${environments.join('|')}>`)
}

// env.js reads these at import time, so set them before importing defra-id.js.
process.env.RUN_MODE = 'e2e'
process.env.ENVIRONMENT = environment

const { getAccessToken } = await import('../tests/utils/defra-id.js')

const context = await request.newContext()
try {
  const file = new URL(`../${environment}-token.txt`, import.meta.url)
  writeFileSync(file, `${await getAccessToken(context)}\n`)
} finally {
  await context.dispose()
}
