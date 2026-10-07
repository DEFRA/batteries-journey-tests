// Decides, per Batteries service, which branch the journey-test run builds.
//
// Sources, highest priority first:
//   1. `Depends-On: <repo>#<branch>` lines in the pull request body (PR_BODY)
//   2. workflow inputs, passed as <SERVICE>_BRANCH env vars (e.g. WASTE_BATTERIES_REG_FRONTEND_BRANCH)
//   3. none — the service runs its published DockerHub image (latest unless a
//      <SERVICE>_TAG is set), which is built from main
//
// Accepted Depends-On forms (one line per repo, case-insensitive keyword):
//   Depends-On: waste-batteries-reg-frontend#feature/foo
//   Depends-On: DEFRA/waste-batteries-reg-frontend#feature/foo
//   Depends-On: /waste-batteries-reg-frontend#feature/foo
//
// Writes `branches` (JSON object of service → branch, only services to build)
// to $GITHUB_OUTPUT when set, and logs the resolved ref for every service.

import { appendFileSync } from 'node:fs'

export const services = [
  'waste-batteries-reg-frontend',
  'waste-batteries-submit-frontend',
  'waste-batteries-obligations-fe',
  'waste-batteries-reg-backend',
  'waste-batteries-submit-backend',
  'waste-batteries-obligations-be'
]

export const envName = (service, suffix) =>
  `${service.toUpperCase().replaceAll('-', '_')}_${suffix}`

export function parseDependsOn(body = '') {
  const pattern =
    /^\s*Depends-On:\s*(?:DEFRA\/|\/)?([A-Za-z0-9._-]+)#(\S+)\s*$/gim
  const found = {}

  for (const [, repo, branch] of body.matchAll(pattern)) {
    if (!services.includes(repo)) {
      throw new Error(
        `Depends-On names unknown repo "${repo}". Known: ${services.join(', ')}`
      )
    }
    found[repo] ??= branch
  }

  return found
}

export function resolveBranches(env) {
  const fromPr = parseDependsOn(env.PR_BODY)
  const branches = {}
  const log = []

  for (const service of services) {
    const branch = fromPr[service] ?? env[envName(service, 'BRANCH')]?.trim()

    if (branch) {
      branches[service] = branch
      log.push(
        `${service}: build branch "${branch}" (${fromPr[service] ? 'Depends-On' : 'input'})`
      )
    } else {
      const tag = env[envName(service, 'TAG')] || 'latest'
      log.push(`${service}: DockerHub image tag "${tag}"`)
    }
  }

  return { branches, log }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { branches, log } = resolveBranches(process.env)

  for (const line of log) {
    process.stdout.write(`${line}\n`)
  }

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `branches=${JSON.stringify(branches)}\n`
    )
  }
}
