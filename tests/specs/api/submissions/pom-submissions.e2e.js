import { randomBytes } from 'node:crypto'

import { test, expect } from '#fixtures/index.js'
import { backendHeaders, backendUrls } from '#utils/env.js'

// 24 hex characters, the shape of a Mongo ObjectId the backend requires.
const objectId = () => randomBytes(12).toString('hex')

// Unique scheme and member per call: a second submission for the same member
// and quarter is rejected, so tests never share them.
const validSubmission = (overrides = {}) => ({
  schemeOrgId: objectId(),
  memberOrgId: objectId(),
  memberName: 'Journey Test Member Ltd',
  memberBprn: 'BPRN-EA-2026-000001',
  schemeMembershipRef: 'SM-0001',
  compliancePeriodYear: 2026,
  compliancePeriodQuarter: 'Q1',
  dataBasis: 'Actual',
  tonnageEntries: [
    { classification: { chemistry: 'Alkaline' }, tonnes: '12.500' }
  ],
  ...overrides
})

// Posts a submission and attaches both bodies to the report (not logged:
// no-console). The bearer token is not attached. The response is attached
// before the caller asserts, so a failed run still shows what came back.
// Problem responses are application/problem+json, which the report would offer
// as a download, so any JSON is attached as application/json to show inline.
async function postSubmission(request, accessToken, submission) {
  await test.info().attach('request body', {
    body: JSON.stringify(submission, null, 2),
    contentType: 'application/json'
  })

  const response = await request.post(
    `${backendUrls.submissions}/pom-submissions`,
    {
      headers: { ...backendHeaders, Authorization: `Bearer ${accessToken}` },
      data: submission
    }
  )

  const responseText = await response.text()
  await test.info().attach(`response body (${response.status()})`, {
    body: responseText,
    contentType: /json/.test(response.headers()['content-type'] ?? '')
      ? 'application/json'
      : 'text/plain'
  })
  return { response, responseText }
}

test.describe('POST /pom-submissions', () => {
  test(
    'Should create a first submission for a scheme member and quarter',
    { tag: '@api' },
    async ({ request, accessToken }) => {
      const submission = validSubmission()
      const { response, responseText } = await postSubmission(
        request,
        accessToken,
        submission
      )

      expect(response.status()).toBe(201)

      const created = JSON.parse(responseText)
      expect(response.headers().location).toBe(`/pom-submissions/${created.id}`)
      expect(created).toMatchObject({
        id: expect.stringMatching(/^[0-9a-f]{24}$/),
        status: 'Submitted',
        version: 1,
        isCurrent: true,
        supersedesSubmissionId: null,
        schemeOrgId: submission.schemeOrgId,
        memberOrgId: submission.memberOrgId,
        memberName: submission.memberName,
        memberBprn: submission.memberBprn,
        schemeMembershipRef: submission.schemeMembershipRef,
        compliancePeriodYear: submission.compliancePeriodYear,
        compliancePeriodQuarter: submission.compliancePeriodQuarter,
        dataBasis: submission.dataBasis,
        // The service sets the activity and the battery category.
        tonnageEntries: [
          {
            id: expect.stringMatching(/^[0-9a-f]{24}$/),
            activity: 'Placed',
            classification: {
              batteryCategory: 'Portable',
              chemistry: 'Alkaline'
            },
            tonnes: '12.500'
          }
        ]
      })
    }
  )

  test(
    'Should refuse a second current submission for the same member and quarter',
    { tag: '@api' },
    async ({ request, accessToken }) => {
      const submission = validSubmission()

      const first = await postSubmission(request, accessToken, submission)
      expect(first.response.status()).toBe(201)

      const second = await postSubmission(request, accessToken, submission)
      expect(second.response.status()).toBe(400)
      expect(JSON.parse(second.responseText).errors).toEqual({
        Submission: [
          'A current submission already exists for this scheme, member, year and quarter.'
        ]
      })
    }
  )

  test(
    'Should return every validation error at once',
    { tag: '@api' },
    async ({ request, accessToken }) => {
      const { response, responseText } = await postSubmission(
        request,
        accessToken,
        validSubmission({
          schemeOrgId: 'not-an-id',
          memberOrgId: 'not-an-id',
          memberName: '',
          memberBprn: 'BPRN-XX-2026-1',
          schemeMembershipRef: '',
          compliancePeriodYear: 0,
          compliancePeriodQuarter: '',
          dataBasis: '',
          tonnageEntries: [
            { classification: { chemistry: '' }, tonnes: '12.5' }
          ]
        })
      )

      expect(response.status()).toBe(400)
      const { errors } = JSON.parse(responseText)
      expect(errors).toEqual({
        SchemeOrgId: ['schemeOrgId must be an ObjectId.'],
        MemberOrgId: ['memberOrgId must be an ObjectId.'],
        MemberName: ["'Member Name' must not be empty."],
        MemberBprn: [
          'memberBprn must match BPRN-{EA|NRW|SEPA|NIEA}-{year}-{6 digits}.'
        ],
        SchemeMembershipRef: ["'Scheme Membership Ref' must not be empty."],
        CompliancePeriodYear: ['compliancePeriodYear must be a calendar year.'],
        CompliancePeriodQuarter: [
          "'Compliance Period Quarter' must not be empty."
        ],
        DataBasis: ["'Data Basis' must not be empty."],
        'TonnageEntries[0].Tonnes': [
          'tonnes must be a string decimal with exactly 3 digits after the decimal point.'
        ],
        'TonnageEntries[0].Classification.Chemistry': [
          "'Classification Chemistry' must not be empty."
        ]
      })
    }
  )

  test(
    'Should refuse a classification reported more than once',
    { tag: '@api' },
    async ({ request, accessToken }) => {
      const { response, responseText } = await postSubmission(
        request,
        accessToken,
        validSubmission({
          tonnageEntries: [
            { classification: { chemistry: 'Alkaline' }, tonnes: '1.000' },
            { classification: { chemistry: 'Alkaline' }, tonnes: '2.000' }
          ]
        })
      )

      expect(response.status()).toBe(400)
      expect(JSON.parse(responseText).errors).toEqual({
        TonnageEntries: [
          'Each classification can only be reported once in a submission.'
        ]
      })
    }
  )

  test(
    'Should refuse a BPRN whose year differs from the compliance year',
    { tag: '@api' },
    async ({ request, accessToken }) => {
      const { response, responseText } = await postSubmission(
        request,
        accessToken,
        validSubmission({ memberBprn: 'BPRN-EA-2025-000001' })
      )

      expect(response.status()).toBe(400)
      expect(JSON.parse(responseText).errors).toEqual({
        MemberBprn: [
          'memberBprn must be the registration for compliancePeriodYear.'
        ]
      })
    }
  )

  test(
    'Should refuse a submission with no tonnage entries',
    { tag: '@api' },
    async ({ request, accessToken }) => {
      const { response, responseText } = await postSubmission(
        request,
        accessToken,
        validSubmission({ tonnageEntries: [] })
      )

      expect(response.status()).toBe(400)
      expect(JSON.parse(responseText).errors).toEqual({
        TonnageEntries: ["'Tonnage Entries' must not be empty."]
      })
    }
  )
})
