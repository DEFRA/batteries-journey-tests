import { randomBytes } from 'node:crypto'

import { test, expect } from '#fixtures/index.js'
import { backendHeaders, backendUrls } from '#utils/env.js'

/**
 * Shared by the POM submission API specs: the URL, the headers, a valid
 * request body and the calls every spec makes. A spec adds its own helpers
 * only for what is specific to it.
 */

// The compliance year the tests use. A batch is for one year, so the other
// years a test needs are written relative to it, such as currentYear - 1.
export const currentYear = new Date().getFullYear()

export const base = `${backendUrls.submissions}/pom-submissions`

// 24 hex characters, the shape of a Mongo ObjectId the backend requires.
export const objectId = () => randomBytes(12).toString('hex')

// True when calls go through the ephemeral gateway (a laptop run with
// CDP_API_KEY). Inside CDP they go straight to the service.
export const viaGateway = Boolean(backendHeaders['x-api-key'])

// The gateway sends `content-encoding: gzip` with an uncompressed body, which
// Playwright cannot decode, so calls through it ask for plain JSON. Inside CDP
// the header is not needed.
export const authHeaders = (accessToken) => ({
  ...backendHeaders,
  ...(viaGateway && { 'Accept-Encoding': 'identity' }),
  Authorization: `Bearer ${accessToken}`
})

// The body for create, amend and each item of a batch. A submission is found by
// scheme, member, year and quarter, so every test uses its own scheme and
// members.
export const submissionFor = ({
  schemeOrgId,
  memberOrgId,
  year = currentYear,
  quarter = 'Q1',
  memberName = 'Journey Test Member Ltd',
  schemeMembershipRef = 'SM-0001',
  dataBasis = 'Actual',
  tonnage = [
    ['Alkaline', '12.500'],
    ['Lithium', '3.250']
  ]
}) => ({
  schemeOrgId,
  memberOrgId,
  memberName,
  // The BPRN year must equal the compliance year.
  memberBprn: `BPRN-EA-${year}-000001`,
  schemeMembershipRef,
  compliancePeriodYear: year,
  compliancePeriodQuarter: quarter,
  dataBasis,
  tonnageEntries: tonnage.map(([chemistry, tonnes]) => ({
    classification: { chemistry },
    tonnes
  }))
})

// Builds a query string. Array values repeat the parameter, which is how the
// backend reads compliancePeriodYears and compliancePeriodQuarters.
export const query = (params) => {
  const search = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) {
    for (const item of [value].flat()) search.append(name, String(item))
  }
  return search.toString()
}

// Calls the list endpoint and attaches the response to the report before the
// caller asserts, so a failed run still shows what came back. The status is
// not checked, so a test can assert on a refusal as well as on a success.
export async function getList(request, accessToken, params, headers = {}) {
  const response = await request.get(`${base}?${query(params)}`, {
    headers: { ...authHeaders(accessToken), ...headers }
  })
  const text = await response.text()
  const isJson = /json/.test(response.headers()['content-type'] ?? '')
  await test.info().attach(`list response (${response.status()})`, {
    body: text,
    contentType: isJson ? 'application/json' : 'text/plain'
  })
  return { response, body: isJson ? JSON.parse(text) : undefined }
}

// The list endpoint, expecting 200. Returns the page.
export async function list(request, accessToken, params) {
  const { response, body } = await getList(request, accessToken, params)
  expect(response.status(), 'list').toBe(200)
  return body
}

export async function getById(request, accessToken, id) {
  const response = await request.get(`${base}/${id}`, {
    headers: authHeaders(accessToken)
  })
  expect(response.status(), 'get by id').toBe(200)
  return response.json()
}

export async function create(request, accessToken, key, overrides = {}) {
  const response = await request.post(base, {
    headers: authHeaders(accessToken),
    data: submissionFor({ ...key, ...overrides })
  })
  expect(response.status(), 'create').toBe(201)
  return response.json()
}

// PATCH /pom-submissions replaces the current submission for the key. Returns
// the response so a test can assert on a refusal as well as on a success.
export const patch = (request, accessToken, data) =>
  request.patch(base, { headers: authHeaders(accessToken), data })

// Mongo stores timestamps to the millisecond, so a response built before the
// write can carry more digits, and a value ending in a zero is written with
// fewer. Compare as milliseconds since the epoch, not as text.
export const toMillisecond = (timestamp) => Date.parse(timestamp)
