import { test, expect } from '#fixtures/index.js'
import { backendHeaders } from '#utils/env.js'
import {
  authHeaders,
  base,
  create,
  getById,
  list,
  objectId,
  patch,
  submissionFor,
  toMillisecond,
  viaGateway
} from '#utils/pom-submissions.js'

async function amend(request, accessToken, key, overrides = {}) {
  const response = await patch(
    request,
    accessToken,
    submissionFor({ ...key, ...overrides })
  )
  expect(response.status(), 'amend').toBe(200)
  return response.json()
}

// returnCurrentOnly=false returns the current and the superseded rows together,
// so the superseded ones are picked out by isCurrent.
async function listSuperseded(request, accessToken, params) {
  const page = await list(request, accessToken, {
    ...params,
    returnCurrentOnly: false
  })
  return { ...page, items: page.items.filter((item) => !item.isCurrent) }
}

// A fresh scheme and member, with a version 1 already created.
async function createdSubmission(request, accessToken, overrides = {}) {
  const key = { schemeOrgId: objectId(), memberOrgId: objectId() }
  const v1 = await create(request, accessToken, key, overrides)
  return { key, v1 }
}

const chemistriesOf = (submission) =>
  submission.tonnageEntries.map((entry) => entry.classification.chemistry)

test.describe('PATCH /pom-submissions: audit trail', () => {
  test(
    'Should create a new current version linked to the old one',
    { tag: ['@amend', '@api'] },
    async ({ request, accessToken }) => {
      const { key, v1 } = await createdSubmission(request, accessToken)

      const response = await patch(
        request,
        accessToken,
        submissionFor({ ...key, tonnage: [['Alkaline', '99.000']] })
      )

      expect(response.status()).toBe(200)
      const v2 = await response.json()
      expect(v2).toMatchObject({
        version: 2,
        isCurrent: true,
        supersedesSubmissionId: v1.id,
        status: 'Submitted'
      })
      expect(v2.id).not.toBe(v1.id)
      expect(v2.tonnageEntries.map((entry) => entry.tonnes)).toEqual(['99.000'])
      expect((await getById(request, accessToken, v2.id)).id).toBe(v2.id)
    }
  )

  test(
    'Should leave the old version unchanged apart from losing current status',
    { tag: ['@amend', '@api'] },
    async ({ request, accessToken }) => {
      const { key, v1 } = await createdSubmission(request, accessToken)
      const before = await getById(request, accessToken, v1.id)

      await amend(request, accessToken, key, {
        tonnage: [['Alkaline', '99.000']]
      })
      const after = await getById(request, accessToken, v1.id)

      const changed = Object.keys(before).filter(
        (field) =>
          JSON.stringify(before[field]) !== JSON.stringify(after[field])
      )
      expect(changed.sort()).toEqual(['isCurrent', 'updatedAtUtc'])
      expect(before).toMatchObject({ isCurrent: true, updatedAtUtc: null })
      expect(after.isCurrent).toBe(false)
      expect(after.updatedAtUtc).toEqual(expect.any(String))
      expect(after.tonnageEntries).toEqual(before.tonnageEntries)
    }
  )

  test(
    'Should link each version to the one before it across several amendments',
    { tag: ['@amend', '@api'] },
    async ({ request, accessToken }) => {
      const { key, v1 } = await createdSubmission(request, accessToken)
      const v2 = await amend(request, accessToken, key, {
        tonnage: [['Alkaline', '50.000']]
      })
      const v3 = await amend(request, accessToken, key, {
        tonnage: [['Alkaline', '75.000']]
      })

      expect([v2.version, v3.version]).toEqual([2, 3])
      expect(v2.supersedesSubmissionId).toBe(v1.id)
      expect(v3.supersedesSubmissionId).toBe(v2.id)

      const current = await list(request, accessToken, {
        schemeOrgId: key.schemeOrgId
      })
      const superseded = await listSuperseded(request, accessToken, {
        schemeOrgId: key.schemeOrgId
      })
      expect(current.items.map((item) => item.id)).toEqual([v3.id])
      expect(superseded.items.map((item) => item.id).sort()).toEqual(
        [v1.id, v2.id].sort()
      )
    }
  )

  test(
    'Should give the new version its own tonnage entry ids',
    { tag: ['@amend', '@api'] },
    async ({ request, accessToken }) => {
      const { key, v1 } = await createdSubmission(request, accessToken)

      const v2 = await amend(request, accessToken, key)

      const oldIds = v1.tonnageEntries.map((entry) => entry.id)
      const newIds = v2.tonnageEntries.map((entry) => entry.id)
      expect(newIds.filter((id) => oldIds.includes(id))).toEqual([])
      expect(new Set(newIds).size).toBe(newIds.length)
    }
  )

  test(
    'Should tie the two versions together with their timestamps',
    { tag: ['@amend', '@api'] },
    async ({ request, accessToken }) => {
      const { key, v1 } = await createdSubmission(request, accessToken)

      const v2 = await amend(request, accessToken, key)
      const old = await getById(request, accessToken, v1.id)

      expect(toMillisecond(old.updatedAtUtc)).toBe(
        toMillisecond(v2.createdAtUtc)
      )
      expect(v2.submittedOnUtc).toBe(v2.createdAtUtc)
      expect(v2.createdAtUtc > v1.createdAtUtc).toBe(true)
      for (const timestamp of [old.updatedAtUtc, v2.createdAtUtc]) {
        expect(timestamp).toMatch(/Z$/)
      }
    }
  )

  test(
    'Should apply every amended field to the new version and keep the old values on v1',
    { tag: ['@amend', '@api'] },
    async ({ request, accessToken }) => {
      const { key, v1 } = await createdSubmission(request, accessToken)

      const v2 = await amend(request, accessToken, key, {
        memberName: 'Renamed Member Ltd',
        schemeMembershipRef: 'SM-0002',
        dataBasis: 'Estimated',
        tonnage: [
          ['Lithium', '1.000'],
          ['Zinc', '2.000']
        ]
      })

      expect(v2).toMatchObject({
        memberName: 'Renamed Member Ltd',
        schemeMembershipRef: 'SM-0002',
        dataBasis: 'Estimated'
      })
      expect(chemistriesOf(v2)).toEqual(['Lithium', 'Zinc'])

      const old = await getById(request, accessToken, v1.id)
      expect(old).toMatchObject({
        memberName: 'Journey Test Member Ltd',
        schemeMembershipRef: 'SM-0001',
        dataBasis: 'Actual'
      })
    }
  )
})

test.describe('PATCH /pom-submissions: atomic and exclusive', () => {
  test(
    'Should leave exactly one current submission after each amendment',
    { tag: ['@amend', '@api'] },
    async ({ request, accessToken }) => {
      const { key } = await createdSubmission(request, accessToken)

      for (let amendment = 1; amendment <= 3; amendment++) {
        await amend(request, accessToken, key)
        const current = await list(request, accessToken, {
          schemeOrgId: key.schemeOrgId,
          memberOrgId: key.memberOrgId,
          compliancePeriodYears: 2026,
          compliancePeriodQuarters: 'Q1',
          returnCurrentOnly: true
        })
        expect(current.totalCount, `after amendment ${amendment}`).toBe(1)
      }
    }
  )

  // Concurrent amendments are not all refused: some succeed one after the
  // other and some are refused with 400. Which, and how many, depends on
  // timing, so this asserts what must always hold: one current version,
  // contiguous versions, and no two versions superseding the same one.
  for (const concurrent of [2, 5]) {
    test(
      `Should leave one current version when ${concurrent} amendments arrive together`,
      { tag: ['@amend', '@api'] },
      async ({ request, accessToken }) => {
        const { key } = await createdSubmission(request, accessToken)

        const responses = await Promise.all(
          Array.from({ length: concurrent }, (_, index) =>
            patch(
              request,
              accessToken,
              submissionFor({
                ...key,
                tonnage: [['Alkaline', `${10 + index}.000`]]
              })
            )
          )
        )
        const statuses = responses.map((response) => response.status())
        expect(statuses.every((status) => [200, 400].includes(status))).toBe(
          true
        )

        const scope = {
          schemeOrgId: key.schemeOrgId,
          memberOrgId: key.memberOrgId
        }
        const current = await list(request, accessToken, {
          ...scope,
          returnCurrentOnly: true
        })
        const superseded = await listSuperseded(request, accessToken, {
          ...scope
        })
        const versions = [...current.items, ...superseded.items].sort(
          (a, b) => a.version - b.version
        )

        expect(current.items).toHaveLength(1)
        expect(versions.map((item) => item.version)).toEqual(
          Array.from({ length: versions.length }, (_, index) => index + 1)
        )
        const predecessors = versions
          .slice(1)
          .map((item) => item.supersedesSubmissionId)
        expect(new Set(predecessors).size).toBe(predecessors.length)
        // One stored version for each amendment that was accepted.
        expect(versions).toHaveLength(
          1 + statuses.filter((status) => status === 200).length
        )
      }
    )
  }

  test(
    'Should leave the original current when the amendment is invalid',
    { tag: ['@amend', '@api'] },
    async ({ request, accessToken }) => {
      const { key, v1 } = await createdSubmission(request, accessToken)

      const response = await patch(
        request,
        accessToken,
        submissionFor({ ...key, tonnage: [['Alkaline', '12.5']] })
      )

      expect(response.status()).toBe(400)
      const current = await list(request, accessToken, {
        schemeOrgId: key.schemeOrgId,
        returnCurrentOnly: true
      })
      const superseded = await listSuperseded(request, accessToken, {
        schemeOrgId: key.schemeOrgId
      })
      expect(current.items.map((item) => item.id)).toEqual([v1.id])
      expect(current.items[0].updatedAtUtc).toBeNull()
      expect(superseded.items).toHaveLength(0)
    }
  )

  test(
    'Should refuse to amend a submission that does not exist',
    { tag: ['@amend', '@api'] },
    async ({ request, accessToken }) => {
      const key = { schemeOrgId: objectId(), memberOrgId: objectId() }

      const response = await patch(request, accessToken, submissionFor(key))

      expect(response.status()).toBe(400)
      expect((await response.json()).errors).toEqual({
        Submission: [
          'A current submission does not exist for this scheme, member, year and quarter.'
        ]
      })
      const created = await list(request, accessToken, {
        schemeOrgId: key.schemeOrgId
      })
      expect(created.totalCount).toBe(0)
    }
  )
})

test.describe('PATCH /pom-submissions: validation and authentication', () => {
  test(
    'Should report the same field errors as create',
    { tag: ['@amend', '@api'] },
    async ({ request, accessToken }) => {
      const invalid = {
        memberName: '',
        memberBprn: 'BPRN-XX-2026-1',
        schemeMembershipRef: '',
        dataBasis: '',
        tonnageEntries: [{ classification: { chemistry: '' }, tonnes: '12.5' }]
      }
      const forCreate = {
        ...submissionFor({ schemeOrgId: objectId(), memberOrgId: objectId() }),
        ...invalid
      }
      const { key } = await createdSubmission(request, accessToken)
      const forAmend = { ...submissionFor(key), ...invalid }

      const created = await request.post(base, {
        headers: authHeaders(accessToken),
        data: forCreate
      })
      const amended = await patch(request, accessToken, forAmend)

      expect(created.status()).toBe(400)
      expect(amended.status()).toBe(400)
      expect((await amended.json()).errors).toEqual(
        (await created.json()).errors
      )
    }
  )

  test(
    'Should refuse other invalid bodies and leave v1 current',
    { tag: ['@amend', '@api'] },
    async ({ request, accessToken }) => {
      const { key, v1 } = await createdSubmission(request, accessToken)
      const valid = submissionFor(key)
      const invalidBodies = {
        'a BPRN year that differs from the compliance year': {
          ...valid,
          memberBprn: 'BPRN-EA-2025-000001'
        },
        'no tonnage entries': { ...valid, tonnageEntries: [] },
        'a classification repeated': submissionFor({
          ...key,
          tonnage: [
            ['Alkaline', '1.000'],
            ['Alkaline', '2.000']
          ]
        }),
        'an unknown property': { ...valid, supersedesSubmissionId: objectId() }
      }

      for (const [description, data] of Object.entries(invalidBodies)) {
        const response = await patch(request, accessToken, data)
        expect(response.status(), description).toBe(400)
      }

      const current = await list(request, accessToken, {
        schemeOrgId: key.schemeOrgId,
        returnCurrentOnly: true
      })
      const superseded = await listSuperseded(request, accessToken, {
        schemeOrgId: key.schemeOrgId
      })
      expect(current.items.map((item) => item.id)).toEqual([v1.id])
      expect(superseded.items).toHaveLength(0)
    }
  )

  const badAuthorisation = {
    'no Authorization header': undefined,
    'an empty bearer': 'Bearer ',
    'a garbage token': 'Bearer abc'
  }

  for (const [description, authorization] of Object.entries(badAuthorisation)) {
    test(
      `Should return 401 for ${description}`,
      { tag: ['@amend', '@api'] },
      async ({ request, accessToken }) => {
        const { key, v1 } = await createdSubmission(request, accessToken)

        const response = await request.patch(base, {
          headers: {
            ...backendHeaders,
            ...(viaGateway && { 'Accept-Encoding': 'identity' }),
            ...(authorization && { Authorization: authorization })
          },
          data: submissionFor(key)
        })

        expect(response.status()).toBe(401)
        const current = await list(request, accessToken, {
          schemeOrgId: key.schemeOrgId,
          returnCurrentOnly: true
        })
        expect(current.items.map((item) => item.id)).toEqual([v1.id])
      }
    )
  }
})

test.describe('PATCH /pom-submissions: how the record is found', () => {
  // The model has no declaration field, so there is nothing to refuse. If one
  // is added, replace this with: amend without a declaration returns 400.
  test(
    'Should accept an amendment with no declaration because the model has none',
    { tag: ['@amend', '@api'] },
    async ({ request, accessToken }) => {
      const { key } = await createdSubmission(request, accessToken)

      const response = await patch(request, accessToken, submissionFor(key))

      expect(response.status()).toBe(200)
    }
  )

  test(
    'Should amend an old period because there is no cut-off',
    { tag: ['@amend', '@api'] },
    async ({ request, accessToken }) => {
      const { key } = await createdSubmission(request, accessToken, {
        year: 2021
      })

      const v2 = await amend(request, accessToken, key, { year: 2021 })

      expect(v2).toMatchObject({ version: 2, compliancePeriodYear: 2021 })
    }
  )

  // Unchanged data is accepted today. If it should be refused (a possible
  // future change), this test changes to expect 400.
  test(
    'Should create a new version even when the data has not changed',
    { tag: ['@amend', '@api'] },
    async ({ request, accessToken }) => {
      const { key, v1 } = await createdSubmission(request, accessToken)

      const v2 = await amend(request, accessToken, key)

      expect(v2.version).toBe(2)
      expect(v2.supersedesSubmissionId).toBe(v1.id)
      expect(
        v2.tonnageEntries.map((entry) => [
          entry.classification.chemistry,
          entry.tonnes
        ])
      ).toEqual(
        v1.tonnageEntries.map((entry) => [
          entry.classification.chemistry,
          entry.tonnes
        ])
      )
    }
  )

  test(
    'Should find the submission by scheme, member, year and quarter without a previous id',
    { tag: ['@amend', '@api'] },
    async ({ request, accessToken }) => {
      const { key, v1 } = await createdSubmission(request, accessToken)

      const v2 = await amend(request, accessToken, key)
      const withPreviousId = await patch(request, accessToken, {
        ...submissionFor(key),
        supersedesSubmissionId: v1.id
      })

      expect(v2.supersedesSubmissionId).toBe(v1.id)
      // The caller cannot choose what to supersede: unknown properties are refused.
      expect(withPreviousId.status()).toBe(400)
    }
  )

  test(
    'Should not let an amendment change the scheme or the member',
    { tag: ['@amend', '@api'] },
    async ({ request, accessToken }) => {
      const { key, v1 } = await createdSubmission(request, accessToken)
      const elsewhere = {
        'another member in the same scheme': {
          ...key,
          memberOrgId: objectId()
        },
        'the same member in another scheme': {
          ...key,
          schemeOrgId: objectId()
        }
      }

      for (const [description, otherKey] of Object.entries(elsewhere)) {
        const response = await patch(
          request,
          accessToken,
          submissionFor(otherKey)
        )
        expect(response.status(), description).toBe(400)
        expect(Object.keys((await response.json()).errors)).toEqual([
          'Submission'
        ])
      }

      const current = await list(request, accessToken, {
        schemeOrgId: key.schemeOrgId,
        returnCurrentOnly: true
      })
      expect(current.items.map((item) => item.id)).toEqual([v1.id])
    }
  )

  test(
    'Should touch only its own scheme, member, year and quarter',
    { tag: ['@amend', '@api'] },
    async ({ request, accessToken }) => {
      const key = { schemeOrgId: objectId(), memberOrgId: objectId() }
      const otherMember = { ...key, memberOrgId: objectId() }
      const q1 = await create(request, accessToken, key)
      const q2 = await create(request, accessToken, key, { quarter: 'Q2' })
      const year2025 = await create(request, accessToken, key, { year: 2025 })
      const other = await create(request, accessToken, otherMember)

      await amend(request, accessToken, key, {
        tonnage: [['Alkaline', '99.000']]
      })

      const current = await list(request, accessToken, {
        schemeOrgId: key.schemeOrgId,
        returnCurrentOnly: true
      })
      const byId = new Map(current.items.map((item) => [item.id, item]))
      for (const untouched of [q2, year2025, other]) {
        expect(byId.get(untouched.id)).toMatchObject({
          version: 1,
          isCurrent: true
        })
      }
      expect(byId.has(q1.id)).toBe(false)
      expect(current.totalCount).toBe(4)
    }
  )
})

// What the read endpoints return once a submission has been amended: v1 is
// superseded (isCurrent false) and v2 is current.
test.describe('GET /pom-submissions: amended submissions', () => {
  // Seeds v1 and amends it to v2, with different tonnage so they differ.
  async function amended(request, accessToken) {
    const { key, v1 } = await createdSubmission(request, accessToken)
    const v2 = await amend(request, accessToken, key, {
      tonnage: [['Alkaline', '99.000']]
    })
    return { schemeOrgId: key.schemeOrgId, v1, v2 }
  }

  test(
    'Should still return a superseded submission by id',
    { tag: ['@amend', '@api'] },
    async ({ request, accessToken }) => {
      const { v1 } = await amended(request, accessToken)

      const fetched = await getById(request, accessToken, v1.id)

      expect(fetched).toMatchObject({
        id: v1.id,
        version: 1,
        isCurrent: false,
        supersedesSubmissionId: null
      })
      expect(fetched.updatedAtUtc).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?Z$/
      )
    }
  )

  test(
    'Should return the current and the superseded version for returnCurrentOnly=false',
    { tag: ['@amend', '@api'] },
    async ({ request, accessToken }) => {
      const { schemeOrgId, v1, v2 } = await amended(request, accessToken)

      const all = await list(request, accessToken, {
        schemeOrgId,
        returnCurrentOnly: false
      })

      expect(all.items.map((item) => item.id).sort()).toEqual(
        [v1.id, v2.id].sort()
      )
      expect(all.items.find((item) => item.id === v1.id).isCurrent).toBe(false)
      expect(all.items.find((item) => item.id === v2.id).isCurrent).toBe(true)
    }
  )

  test(
    'Should return only the current version for returnCurrentOnly=true and by default',
    { tag: ['@amend', '@api'] },
    async ({ request, accessToken }) => {
      const { schemeOrgId, v2 } = await amended(request, accessToken)

      const explicit = await list(request, accessToken, {
        schemeOrgId,
        returnCurrentOnly: true
      })
      const byDefault = await list(request, accessToken, { schemeOrgId })

      expect(explicit.items.map((item) => item.id)).toEqual([v2.id])
      expect(byDefault).toEqual(explicit)
      expect(explicit.items[0].tonnageEntries[0].tonnes).toBe('99.000')
    }
  )

  test(
    'Should hold exactly the two versions across the current and superseded lists',
    { tag: ['@amend', '@api'] },
    async ({ request, accessToken }) => {
      const { schemeOrgId, v1, v2 } = await amended(request, accessToken)

      const current = await list(request, accessToken, { schemeOrgId })
      const superseded = await listSuperseded(request, accessToken, {
        schemeOrgId
      })

      expect(current.items.map((item) => item.id)).toEqual([v2.id])
      expect(superseded.items.map((item) => item.id)).toEqual([v1.id])
    }
  )
})
