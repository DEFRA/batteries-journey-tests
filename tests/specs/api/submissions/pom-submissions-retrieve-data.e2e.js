import { randomBytes } from 'node:crypto'

import { test, expect } from '#fixtures/index.js'
import { backendHeaders, backendUrls } from '#utils/env.js'

const base = `${backendUrls.submissions}/pom-submissions`

// 24 hex characters, the shape of a Mongo ObjectId the backend requires.
const objectId = () => randomBytes(12).toString('hex')

const objectIdPattern = /^[0-9a-f]{24}$/

// The ephemeral gateway sends `content-encoding: gzip` with an uncompressed
// body, which Playwright cannot decode. Ordinary calls therefore ask for an
// uncompressed response. The tests that need real gzip only run from CDP.
// True when calls go through the ephemeral gateway (a laptop run with
// CDP_API_KEY). Inside CDP they go straight to the service.
const viaGateway = Boolean(backendHeaders['x-api-key'])

const authHeaders = (accessToken) => ({
  ...backendHeaders,
  'Accept-Encoding': 'identity',
  Authorization: `Bearer ${accessToken}`
})

// A submission is unique per scheme, member, year and quarter while current,
// so every test uses its own scheme and members.
const submissionFor = ({ schemeOrgId, memberOrgId, year, quarter }) => ({
  schemeOrgId,
  memberOrgId,
  memberName: 'Journey Test Member Ltd',
  // The BPRN year must equal the compliance year.
  memberBprn: `BPRN-EA-${year}-000001`,
  schemeMembershipRef: 'SM-0001',
  compliancePeriodYear: year,
  compliancePeriodQuarter: quarter,
  dataBasis: 'Actual',
  tonnageEntries: [
    { classification: { chemistry: 'Alkaline' }, tonnes: '12.500' },
    { classification: { chemistry: 'Lithium' }, tonnes: '3.250' }
  ]
})

// Posts one submission per { year, quarter } for a scheme and member, and
// returns the created submissions in the order given.
async function seed(request, accessToken, schemeOrgId, memberOrgId, periods) {
  return Promise.all(
    periods.map(async ({ year, quarter }) => {
      const response = await request.post(base, {
        headers: authHeaders(accessToken),
        data: submissionFor({ schemeOrgId, memberOrgId, year, quarter })
      })
      expect(response.status(), `seed ${year} ${quarter}`).toBe(201)
      return response.json()
    })
  )
}

// Builds a query string. Array values repeat the parameter, which is how the
// backend reads compliancePeriodYears and compliancePeriodQuarters.
const query = (params) => {
  const search = new URLSearchParams()
  for (const [name, value] of Object.entries(params)) {
    for (const item of [value].flat()) search.append(name, String(item))
  }
  return search.toString()
}

// Calls the list endpoint and attaches the response to the report before the
// caller asserts, so a failed run still shows what came back.
async function list(request, accessToken, params, headers = {}) {
  const response = await request.get(`${base}?${query(params)}`, {
    headers: { ...authHeaders(accessToken), ...headers }
  })
  const text = await response.text()
  await test.info().attach(`list response (${response.status()})`, {
    body: text,
    contentType: /json/.test(response.headers()['content-type'] ?? '')
      ? 'application/json'
      : 'text/plain'
  })
  return {
    response,
    body: /json/.test(response.headers()['content-type'] ?? '')
      ? JSON.parse(text)
      : undefined
  }
}

// Mongo stores timestamps to the millisecond, so a created submission differs
// from a stored one in the sub-millisecond digits. Compare without them; their
// format is checked separately by expectUtcTimestamps.
const withoutTimestamps = ({
  createdAtUtc: _created,
  submittedOnUtc: _submitted,
  updatedAtUtc: _updated,
  ...rest
}) => rest

// A value that is not a number never reaches validation: the framework fails
// to bind it and answers 400 with a `detail` and no `errors` object. A number
// that is out of range is rejected by validation with a message under `errors`.
const expectRejected = (body, field, message) => {
  if (body.errors) {
    expect(Object.values(body.errors).flat()).toContain(message)
  } else {
    expect(body.detail).toContain(`Failed to bind parameter`)
    expect(body.detail).toContain(field)
  }
}

// ISO 8601 date-time in UTC: ends in Z, with up to 7 fractional digits.
const utcTimestamp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?Z$/

const expectUtcTimestamps = (submission) => {
  expect(submission.createdAtUtc).toMatch(utcTimestamp)
  expect(submission.submittedOnUtc).toMatch(utcTimestamp)
  if (submission.updatedAtUtc !== null) {
    expect(submission.updatedAtUtc).toMatch(utcTimestamp)
  }
}

const periodsOf = (items) =>
  items
    .map(
      (item) => `${item.compliancePeriodYear} ${item.compliancePeriodQuarter}`
    )
    .sort()

const allQuarters = (year) =>
  ['Q1', 'Q2', 'Q3', 'Q4'].map((quarter) => ({ year, quarter }))

test.describe('GET /pom-submissions: years look-back', () => {
  test(
    'Should return only the requested three years',
    { tag: ['@smoke', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      await seed(request, accessToken, schemeOrgId, objectId(), [
        { year: 2026, quarter: 'Q1' },
        { year: 2025, quarter: 'Q1' },
        { year: 2024, quarter: 'Q1' },
        { year: 2023, quarter: 'Q1' },
        { year: 2022, quarter: 'Q1' }
      ])

      const { response, body } = await list(request, accessToken, {
        schemeOrgId,
        compliancePeriodYears: [2026, 2025, 2024]
      })

      expect(response.status()).toBe(200)
      expect(periodsOf(body.items)).toEqual(['2024 Q1', '2025 Q1', '2026 Q1'])
      expect(body.totalCount).toBe(3)
    }
  )

  test(
    'Should return only the years that have data when the window partly overlaps',
    { tag: ['@smoke', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      await seed(request, accessToken, schemeOrgId, objectId(), [
        { year: 2023, quarter: 'Q1' },
        { year: 2022, quarter: 'Q1' }
      ])

      const { body } = await list(request, accessToken, {
        schemeOrgId,
        compliancePeriodYears: [2023, 2022, 2021]
      })

      expect(periodsOf(body.items)).toEqual(['2022 Q1', '2023 Q1'])
    }
  )

  test(
    'Should return an empty list when no requested year has data',
    { tag: ['@happy-path', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      await seed(request, accessToken, schemeOrgId, objectId(), [
        { year: 2026, quarter: 'Q1' }
      ])

      const { response, body } = await list(request, accessToken, {
        schemeOrgId,
        compliancePeriodYears: [2021, 2020, 2019]
      })

      expect(response.status()).toBe(200)
      expect(body).toMatchObject({ items: [], totalCount: 0 })
    }
  )

  test(
    'Should return a single year',
    { tag: ['@smoke', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      await seed(request, accessToken, schemeOrgId, objectId(), [
        { year: 2026, quarter: 'Q1' },
        { year: 2025, quarter: 'Q1' }
      ])

      const { body } = await list(request, accessToken, {
        schemeOrgId,
        compliancePeriodYears: 2026
      })

      expect(periodsOf(body.items)).toEqual(['2026 Q1'])
    }
  )

  test(
    'Should treat repeated compliancePeriodYears as alternatives, not a range',
    { tag: '@api' },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      await seed(request, accessToken, schemeOrgId, objectId(), [
        { year: 2026, quarter: 'Q1' },
        { year: 2024, quarter: 'Q1' },
        { year: 2022, quarter: 'Q1' }
      ])

      const { body } = await list(request, accessToken, {
        schemeOrgId,
        compliancePeriodYears: [2026, 2022]
      })

      expect(periodsOf(body.items)).toEqual(['2022 Q1', '2026 Q1'])
    }
  )
})

test.describe('GET /pom-submissions: quarters', () => {
  test(
    'Should return the four quarters as individual submissions with no pre-summed total',
    { tag: ['@smoke', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      await seed(
        request,
        accessToken,
        schemeOrgId,
        objectId(),
        allQuarters(2026)
      )

      const { body } = await list(request, accessToken, {
        schemeOrgId,
        compliancePeriodYears: 2026
      })

      expect(periodsOf(body.items)).toEqual([
        '2026 Q1',
        '2026 Q2',
        '2026 Q3',
        '2026 Q4'
      ])
      expect(body.items[0]).not.toHaveProperty('totalTonnes')
    }
  )

  test(
    'Should filter by quarters',
    { tag: ['@smoke', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      await seed(
        request,
        accessToken,
        schemeOrgId,
        objectId(),
        allQuarters(2026)
      )

      const { body } = await list(request, accessToken, {
        schemeOrgId,
        compliancePeriodQuarters: ['Q1', 'Q2']
      })

      expect(periodsOf(body.items)).toEqual(['2026 Q1', '2026 Q2'])
    }
  )

  test(
    'Should combine years and quarters as AND',
    { tag: ['@smoke', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const memberOrgId = objectId()
      await seed(request, accessToken, schemeOrgId, memberOrgId, [
        ...allQuarters(2026),
        ...allQuarters(2025),
        ...allQuarters(2024)
      ])

      const { body } = await list(request, accessToken, {
        schemeOrgId,
        compliancePeriodYears: [2026, 2025],
        compliancePeriodQuarters: ['Q3', 'Q4']
      })

      expect(periodsOf(body.items)).toEqual([
        '2025 Q3',
        '2025 Q4',
        '2026 Q3',
        '2026 Q4'
      ])
    }
  )

  test(
    'Should return only the quarters a member has submitted',
    { tag: '@api' },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const memberOrgId = objectId()
      await seed(request, accessToken, schemeOrgId, memberOrgId, [
        { year: 2026, quarter: 'Q1' },
        { year: 2026, quarter: 'Q3' }
      ])

      const { body } = await list(request, accessToken, {
        schemeOrgId,
        memberOrgId,
        compliancePeriodYears: 2026
      })

      expect(periodsOf(body.items)).toEqual(['2026 Q1', '2026 Q3'])
    }
  )
})

test.describe('GET /pom-submissions: data returned', () => {
  test(
    'Should return the tonnage entries and values that were posted',
    { tag: ['@smoke', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const memberOrgId = objectId()
      const [created] = await seed(
        request,
        accessToken,
        schemeOrgId,
        memberOrgId,
        [{ year: 2026, quarter: 'Q1' }]
      )

      const { body } = await list(request, accessToken, { schemeOrgId })

      expect(body.items).toHaveLength(1)
      expectUtcTimestamps(body.items[0])
      expect(withoutTimestamps(body.items[0])).toEqual(
        withoutTimestamps(created)
      )
      expect(
        body.items[0].tonnageEntries.map((entry) => ({
          chemistry: entry.classification.chemistry,
          tonnes: entry.tonnes
        }))
      ).toEqual([
        { chemistry: 'Alkaline', tonnes: '12.500' },
        { chemistry: 'Lithium', tonnes: '3.250' }
      ])
    }
  )

  test(
    'Should return the documented response shape',
    { tag: '@api' },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const memberOrgId = objectId()
      await seed(request, accessToken, schemeOrgId, memberOrgId, [
        { year: 2026, quarter: 'Q1' }
      ])

      const { body } = await list(request, accessToken, { schemeOrgId })

      expect(body).toMatchObject({
        pageNumber: 1,
        pageSize: expect.any(Number),
        totalCount: 1,
        totalPages: 1,
        hasPreviousPage: false,
        hasNextPage: false
      })
      expect(body.items[0]).toMatchObject({
        id: expect.stringMatching(objectIdPattern),
        version: 1,
        isCurrent: true,
        supersedesSubmissionId: null,
        status: 'Submitted',
        schemeOrgId,
        memberOrgId,
        compliancePeriodYear: 2026,
        compliancePeriodQuarter: 'Q1',
        dataBasis: 'Actual',
        submittedOnUtc: expect.stringMatching(utcTimestamp),
        createdAtUtc: expect.stringMatching(utcTimestamp),
        tonnageEntries: [
          {
            id: expect.stringMatching(objectIdPattern),
            activity: 'Placed',
            classification: {
              batteryCategory: 'Portable',
              chemistry: 'Alkaline'
            },
            tonnes: '12.500'
          },
          expect.anything()
        ]
      })
    }
  )
})

test.describe('GET /pom-submissions/{id}', () => {
  test(
    'Should return a submission by id',
    { tag: ['@smoke', '@api'] },
    async ({ request, accessToken }) => {
      const [created] = await seed(
        request,
        accessToken,
        objectId(),
        objectId(),
        [{ year: 2026, quarter: 'Q1' }]
      )

      const response = await request.get(`${base}/${created.id}`, {
        headers: authHeaders(accessToken)
      })

      expect(response.status()).toBe(200)
      const fetched = await response.json()
      expectUtcTimestamps(fetched)
      expect(withoutTimestamps(fetched)).toEqual(withoutTimestamps(created))
    }
  )

  test(
    'Should return 404 for an id that does not exist',
    { tag: '@api' },
    async ({ request, accessToken }) => {
      const response = await request.get(`${base}/${objectId()}`, {
        headers: authHeaders(accessToken)
      })

      expect(response.status()).toBe(404)
    }
  )

  test(
    'Should return 400 for a malformed id',
    { tag: '@api' },
    async ({ request, accessToken }) => {
      const response = await request.get(`${base}/not-an-id`, {
        headers: authHeaders(accessToken)
      })

      expect(response.status()).toBe(400)
      expect(response.headers()['content-type']).toContain(
        'application/problem+json'
      )
    }
  )

  test(
    'Should return 401 without a token',
    { tag: '@api' },
    async ({ request }) => {
      const response = await request.get(`${base}/${objectId()}`, {
        headers: backendHeaders
      })

      expect(response.status()).toBe(401)
    }
  )
})

test.describe('GET /pom-submissions: filters', () => {
  test(
    'Should list by schemeOrgId only',
    { tag: ['@smoke', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      await seed(request, accessToken, schemeOrgId, objectId(), [
        { year: 2026, quarter: 'Q1' }
      ])
      await seed(request, accessToken, schemeOrgId, objectId(), [
        { year: 2026, quarter: 'Q1' }
      ])

      const { body } = await list(request, accessToken, { schemeOrgId })

      expect(body.totalCount).toBe(2)
    }
  )

  test(
    'Should list by memberOrgId only',
    { tag: ['@smoke', '@api'] },
    async ({ request, accessToken }) => {
      const memberOrgId = objectId()
      await seed(request, accessToken, objectId(), memberOrgId, [
        { year: 2026, quarter: 'Q1' }
      ])
      await seed(request, accessToken, objectId(), objectId(), [
        { year: 2026, quarter: 'Q1' }
      ])

      const { body } = await list(request, accessToken, { memberOrgId })

      expect(body.items).toHaveLength(1)
      expect(body.items[0].memberOrgId).toBe(memberOrgId)
    }
  )

  test(
    'Should combine scheme, member, year and quarter as AND',
    { tag: ['@smoke', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const memberOrgId = objectId()
      await seed(request, accessToken, schemeOrgId, memberOrgId, [
        ...allQuarters(2026),
        ...allQuarters(2025)
      ])
      await seed(request, accessToken, schemeOrgId, objectId(), [
        { year: 2026, quarter: 'Q2' }
      ])

      const { body } = await list(request, accessToken, {
        schemeOrgId,
        memberOrgId,
        compliancePeriodYears: 2026,
        compliancePeriodQuarters: 'Q2'
      })

      expect(body.items).toHaveLength(1)
      expect(body.items[0]).toMatchObject({
        memberOrgId,
        compliancePeriodYear: 2026,
        compliancePeriodQuarter: 'Q2'
      })
    }
  )

  test(
    'Should return 200 and an empty list when nothing matches',
    { tag: '@api' },
    async ({ request, accessToken }) => {
      const { response, body } = await list(request, accessToken, {
        schemeOrgId: objectId()
      })

      expect(response.status()).toBe(200)
      expect(body).toMatchObject({ items: [], totalCount: 0 })
    }
  )

  test(
    'Should not return a member of another scheme for this scheme',
    { tag: '@api' },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const otherMember = objectId()
      await seed(request, accessToken, objectId(), otherMember, [
        { year: 2026, quarter: 'Q1' }
      ])

      const { body } = await list(request, accessToken, {
        schemeOrgId,
        memberOrgId: otherMember
      })

      expect(body.items).toEqual([])
    }
  )

  test(
    'Should trim whitespace around ids',
    { tag: '@api' },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      await seed(request, accessToken, schemeOrgId, objectId(), [
        { year: 2026, quarter: 'Q1' }
      ])

      const { response, body } = await list(request, accessToken, {
        schemeOrgId: ` ${schemeOrgId} `
      })

      expect(response.status()).toBe(200)
      expect(body.totalCount).toBe(1)
    }
  )

  test(
    'Should default isCurrent to true',
    { tag: ['@smoke', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      await seed(request, accessToken, schemeOrgId, objectId(), [
        { year: 2026, quarter: 'Q1' }
      ])

      const withDefault = await list(request, accessToken, { schemeOrgId })
      const explicit = await list(request, accessToken, {
        schemeOrgId,
        isCurrent: true
      })

      expect(withDefault.body.items.every((item) => item.isCurrent)).toBe(true)
      expect(explicit.body).toEqual(withDefault.body)
    }
  )
})

test.describe('GET /pom-submissions: validation', () => {
  test(
    'Should return 400 when no business filter is given',
    { tag: '@api' },
    async ({ request, accessToken }) => {
      const { response, body } = await list(request, accessToken, {})

      expect(response.status()).toBe(400)
      expect(body.errors).toEqual({
        Filters: [
          'At least one of schemeOrgId, memberOrgId, compliancePeriodYears or compliancePeriodQuarters is required.'
        ]
      })
    }
  )

  test(
    'Should not count isCurrent as a filter',
    { tag: '@api' },
    async ({ request, accessToken }) => {
      const { response, body } = await list(request, accessToken, {
        isCurrent: true
      })

      expect(response.status()).toBe(400)
      expect(body.errors).toHaveProperty('Filters')
    }
  )

  for (const year of ['99', 'abc', '-5', '10000', '2026.5']) {
    test(
      `Should return 400 for compliancePeriodYears=${year}`,
      { tag: '@api' },
      async ({ request, accessToken }) => {
        const { response, body } = await list(request, accessToken, {
          schemeOrgId: objectId(),
          compliancePeriodYears: year
        })

        expect(response.status()).toBe(400)
        expectRejected(
          body,
          'CompliancePeriodYears',
          'compliancePeriodYears must be a calendar year.'
        )
      }
    )
  }

  for (const [name, value] of [
    ['schemeOrgId', 'bad'],
    ['schemeOrgId', '123'],
    ['memberOrgId', 'bad']
  ]) {
    test(
      `Should return 400 for ${name}=${value}`,
      { tag: '@api' },
      async ({ request, accessToken }) => {
        const { response, body } = await list(request, accessToken, {
          [name]: value
        })

        expect(response.status()).toBe(400)
        expect(Object.values(body.errors).flat()).toContain(
          `${name} must be an ObjectId.`
        )
      }
    )
  }

  for (const value of ['0', '-1', 'abc', '1.5']) {
    test(
      `Should return 400 for pageNumber=${value}`,
      { tag: '@api' },
      async ({ request, accessToken }) => {
        const { response, body } = await list(request, accessToken, {
          schemeOrgId: objectId(),
          pageNumber: value
        })

        expect(response.status()).toBe(400)
        expectRejected(body, 'PageNumber', 'pageNumber must be at least 1.')
      }
    )
  }

  for (const value of ['0', '-1', 'abc']) {
    test(
      `Should return 400 for pageSize=${value}`,
      { tag: '@api' },
      async ({ request, accessToken }) => {
        const { response, body } = await list(request, accessToken, {
          schemeOrgId: objectId(),
          pageSize: value
        })

        expect(response.status()).toBe(400)
        expectRejected(body, 'PageSize', 'pageSize must be at least 1.')
      }
    )
  }

  test(
    'Should return errors as application/problem+json with a readable errors object',
    { tag: '@api' },
    async ({ request, accessToken }) => {
      const { response, body } = await list(request, accessToken, {
        schemeOrgId: 'bad'
      })

      expect(response.status()).toBe(400)
      expect(response.headers()['content-type']).toContain(
        'application/problem+json'
      )
      expect(body).toMatchObject({
        status: 400,
        errors: { SchemeOrgId: ['schemeOrgId must be an ObjectId.'] },
        traceId: expect.any(String)
      })
    }
  )
})

test.describe('GET /pom-submissions: paging', () => {
  // Five submissions, pageSize 2: three pages of 2, 2 and 1.
  const fivePeriods = [
    { year: 2026, quarter: 'Q1' },
    { year: 2026, quarter: 'Q2' },
    { year: 2026, quarter: 'Q3' },
    { year: 2026, quarter: 'Q4' },
    { year: 2025, quarter: 'Q1' }
  ]

  test(
    'Should return the first page with its flags',
    { tag: ['@smoke', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      await seed(request, accessToken, schemeOrgId, objectId(), fivePeriods)

      const { body } = await list(request, accessToken, {
        schemeOrgId,
        pageNumber: 1,
        pageSize: 2
      })

      expect(body.items).toHaveLength(2)
      expect(body).toMatchObject({
        pageNumber: 1,
        pageSize: 2,
        totalCount: 5,
        totalPages: 3,
        hasPreviousPage: false,
        hasNextPage: true
      })
    }
  )

  test(
    'Should flag the middle and the last page correctly',
    { tag: '@api' },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      await seed(request, accessToken, schemeOrgId, objectId(), fivePeriods)

      const middle = await list(request, accessToken, {
        schemeOrgId,
        pageNumber: 2,
        pageSize: 2
      })
      const last = await list(request, accessToken, {
        schemeOrgId,
        pageNumber: 3,
        pageSize: 2
      })

      expect(middle.body).toMatchObject({
        hasPreviousPage: true,
        hasNextPage: true
      })
      expect(last.body.items).toHaveLength(1)
      expect(last.body).toMatchObject({
        hasPreviousPage: true,
        hasNextPage: false
      })
    }
  )

  // The page number moves back to the last page by design (PageWindow), so a
  // consumer must stop on hasNextPage and never wait for an empty page.
  test(
    'Should move a page past the end back to the last page',
    { tag: ['@smoke', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      await seed(request, accessToken, schemeOrgId, objectId(), fivePeriods)

      const { response, body } = await list(request, accessToken, {
        schemeOrgId,
        pageNumber: 99,
        pageSize: 2
      })

      expect(response.status()).toBe(200)
      expect(body).toMatchObject({
        pageNumber: 3,
        totalPages: 3,
        totalCount: 5,
        hasNextPage: false
      })
      expect(body.items).toHaveLength(1)
    }
  )

  test(
    'Should return every submission once, in a stable order, when paging through',
    { tag: ['@smoke', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const created = await seed(
        request,
        accessToken,
        schemeOrgId,
        objectId(),
        fivePeriods
      )

      const walk = async () => {
        const ids = []
        let pageNumber = 1
        let hasNextPage = true
        while (hasNextPage) {
          const { body } = await list(request, accessToken, {
            schemeOrgId,
            pageNumber,
            pageSize: 2
          })
          ids.push(...body.items.map((item) => item.id))
          hasNextPage = body.hasNextPage
          pageNumber++
        }
        return ids
      }

      const first = await walk()
      const second = await walk()

      expect(new Set(first).size).toBe(first.length)
      expect([...first].sort()).toEqual(created.map((item) => item.id).sort())
      expect(second).toEqual(first)
    }
  )

  test(
    'Should honour a pageSize below the maximum',
    { tag: '@api' },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      await seed(request, accessToken, schemeOrgId, objectId(), fivePeriods)

      const { body } = await list(request, accessToken, {
        schemeOrgId,
        pageSize: 3
      })

      expect(body.pageSize).toBe(3)
      expect(body.items).toHaveLength(3)
    }
  )
})

test.describe('GET /pom-submissions: gzip and the page size cap', () => {
  const oneSubmission = [{ year: 2026, quarter: 'Q1' }]

  test(
    'Should cap pageSize at 750 when the caller does not accept gzip',
    { tag: '@api' },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      await seed(request, accessToken, schemeOrgId, objectId(), oneSubmission)

      const { body } = await list(
        request,
        accessToken,
        { schemeOrgId, pageSize: 100000 },
        { 'Accept-Encoding': 'identity' }
      )

      expect(body.pageSize).toBe(750)
    }
  )

  // The gateway labels a plain body as gzip and never really compresses, so
  // these cannot be checked through it. They run when calling CDP directly.
  if (!viaGateway) {
    test(
      'Should return the same JSON with and without gzip',
      { tag: '@api' },
      async ({ request, accessToken }) => {
        const schemeOrgId = objectId()
        await seed(request, accessToken, schemeOrgId, objectId(), oneSubmission)

        const gzip = await list(
          request,
          accessToken,
          { schemeOrgId },
          { 'Accept-Encoding': 'gzip' }
        )
        const plain = await list(
          request,
          accessToken,
          { schemeOrgId },
          { 'Accept-Encoding': 'identity' }
        )

        expect(gzip.response.status()).toBe(200)
        // pageSize differs by encoding (17000 vs 750), so compare the items.
        expect(gzip.body.items).toEqual(plain.body.items)
      }
    )

    test(
      'Should treat gzip;q=0 as not accepting gzip',
      { tag: '@api' },
      async ({ request, accessToken }) => {
        const schemeOrgId = objectId()
        await seed(request, accessToken, schemeOrgId, objectId(), oneSubmission)

        const { body } = await list(
          request,
          accessToken,
          { schemeOrgId, pageSize: 100000 },
          { 'Accept-Encoding': 'gzip;q=0' }
        )

        expect(body.pageSize).toBe(750)
      }
    )

    test(
      'Should allow up to 17000 per page when the caller accepts gzip',
      { tag: '@api' },
      async ({ request, accessToken }) => {
        const schemeOrgId = objectId()
        await seed(request, accessToken, schemeOrgId, objectId(), oneSubmission)

        const { body } = await list(
          request,
          accessToken,
          { schemeOrgId, pageSize: 100000 },
          { 'Accept-Encoding': 'gzip' }
        )

        expect(body.pageSize).toBe(17000)
      }
    )
  }
})

test.describe('GET /pom-submissions: authentication', () => {
  // Valid token with the last character of the signature changed.
  const alteredSignature = (token) =>
    `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`

  const badTokens = {
    'a garbage token': () => 'abc',
    'an empty bearer': () => '',
    'a token with an altered signature': alteredSignature
  }

  for (const [description, makeToken] of Object.entries(badTokens)) {
    test(
      `Should return 401 on both endpoints for ${description}`,
      { tag: '@api' },
      async ({ request, accessToken }) => {
        const headers = {
          ...backendHeaders,
          Authorization: `Bearer ${makeToken(accessToken)}`
        }

        const byId = await request.get(`${base}/${objectId()}`, { headers })
        const listed = await request.get(
          `${base}?${query({ schemeOrgId: objectId() })}`,
          { headers }
        )

        expect(byId.status()).toBe(401)
        expect(listed.status()).toBe(401)
      }
    )
  }

  test(
    'Should accept a valid stub-user token on both endpoints',
    { tag: '@api' },
    async ({ request, accessToken }) => {
      const byId = await request.get(`${base}/${objectId()}`, {
        headers: authHeaders(accessToken)
      })
      const listed = await request.get(
        `${base}?${query({ schemeOrgId: objectId() })}`,
        { headers: authHeaders(accessToken) }
      )

      // 404 and 200 prove the token was accepted; neither is a 401 or 403.
      expect(byId.status()).toBe(404)
      expect(listed.status()).toBe(200)
    }
  )
})

// BLOCKED: amendments. The backend has no amend endpoint yet, so a superseded
// version can only be made by editing Mongo by hand, which an e2e run cannot
// do. The structure of those tests is kept here, switched off, so they can be
// filled in once the endpoint exists:
//   1. Replace `amend` with a call to the real endpoint.
//   2. Set `amendEndpointReady` to true (or delete the guard).
//   3. Replace each TODO with the request and assertions it describes.
// Scenarios in eb233-test-sceanrios.md: 19, 31, 32, 33.
const amendEndpointReady = false

// TODO: call the amend endpoint for `submission` and return the new version.
async function amend() {
  throw new Error('The amend endpoint is not available yet')
}

/* eslint-disable playwright/expect-expect -- skeleton: assertions are added with the amend endpoint */
if (amendEndpointReady) {
  test.describe('Amended submissions', () => {
    test(
      'Should still return a superseded submission by id',
      { tag: '@api' },
      async ({ request, accessToken }) => {
        // TODO: seed v1, amend it to v2, then GET /pom-submissions/{v1.id}.
        // Expect 200, isCurrent false, version 1.
        const [v1] = await seed(request, accessToken, objectId(), objectId(), [
          { year: 2026, quarter: 'Q1' }
        ])
        await amend(v1)
      }
    )

    test(
      'Should return only the superseded versions for isCurrent=false',
      { tag: '@api' },
      async ({ request, accessToken }) => {
        // TODO: seed v1, amend to v2, list the scheme with isCurrent=false.
        // Expect only v1 (isCurrent false); v2 is absent.
        const schemeOrgId = objectId()
        const [v1] = await seed(request, accessToken, schemeOrgId, objectId(), [
          { year: 2026, quarter: 'Q1' }
        ])
        await amend(v1)
        await list(request, accessToken, { schemeOrgId, isCurrent: false })
      }
    )

    test(
      'Should return only the current version for isCurrent=true and by default',
      { tag: '@api' },
      async ({ request, accessToken }) => {
        // TODO: seed v1, amend to v2, list the scheme with isCurrent=true and
        // with no isCurrent. Expect only v2 in both, and the two bodies equal.
        const schemeOrgId = objectId()
        const [v1] = await seed(request, accessToken, schemeOrgId, objectId(), [
          { year: 2026, quarter: 'Q1' }
        ])
        await amend(v1)
        await list(request, accessToken, { schemeOrgId, isCurrent: true })
        await list(request, accessToken, { schemeOrgId })
      }
    )

    test(
      'Should link the new version to the old one after an amendment',
      { tag: '@api' },
      async ({ request, accessToken }) => {
        // TODO: seed v1, amend to v2. Expect v1.isCurrent false, v2.isCurrent
        // true, v2.version 2 and v2.supersedesSubmissionId equal to v1.id.
        const [v1] = await seed(request, accessToken, objectId(), objectId(), [
          { year: 2026, quarter: 'Q1' }
        ])
        await amend(v1)
      }
    )
  })
}
/* eslint-enable playwright/expect-expect */
