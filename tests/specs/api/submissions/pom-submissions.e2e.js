import { randomBytes } from 'node:crypto'

import { test, expect } from '#fixtures/index.js'
import { backendHeaders, backendUrls } from '#utils/env.js'

// 24 hex characters, the shape of a Mongo ObjectId the backend requires.
const objectId = () => randomBytes(12).toString('hex')

test.describe('POST /pom-submissions', () => {
  test(
    'Should create a first submission for a scheme member and quarter',
    { tag: '@api' },
    async ({ request, accessToken }) => {
      // Unique scheme and member per run: a second submission for the same
      // member and quarter is rejected, so tests never share them.
      const submission = {
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
        ]
      }

      // Attached to the report (not logged: no-console). The bearer token is not.
      const requestText = JSON.stringify(submission, null, 2)
      await test.info().attach('request body', {
        body: requestText,
        contentType: 'application/json'
      })

      const response = await request.post(
        `${backendUrls.submissions}/pom-submissions`,
        {
          headers: {
            ...backendHeaders,
            Authorization: `Bearer ${accessToken}`
          },
          data: submission
        }
      )

      // Attached before asserting, so a failed run still shows what came back.
      const responseText = await response.text()
      await test.info().attach(`response body (${response.status()})`, {
        body: responseText,
        contentType: response.headers()['content-type'] ?? 'text/plain'
      })

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
})
