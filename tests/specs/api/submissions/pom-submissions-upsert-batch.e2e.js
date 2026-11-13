import { test, expect } from '#fixtures/index.js'
import { backendHeaders } from '#utils/env.js'
import {
  currentYear,
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

// POST /pom-submissions/upsert-batch takes a JSON array. Each item has the same
// shape as a single create or amend. An item with no current submission for its
// scheme, member, year and quarter is created, any other is amended. The whole
// batch commits or fails together. See EB232-scenarios.md.
//
// Not covered: idempotency on a reference (AC1) and a per-member `rejected`
// outcome (AC4) are struck out in the ticket, and the declaration is not
// implemented yet.
// The batch-limit scenarios (1500 items, 10 MB) are checked by hand.

const url = `${base}/upsert-batch`
const objectIdPattern = /^[0-9a-f]{24}$/

const upsert = (request, accessToken, data) =>
  request.post(url, { headers: authHeaders(accessToken), data })

// Posts a batch that must succeed, and returns the results.
async function upserted(request, accessToken, items) {
  const response = await upsert(request, accessToken, items)
  expect(response.status(), 'upsert batch').toBe(200)
  return response.json()
}

// One item. Every test uses its own scheme, and its own members.
const itemFor = (schemeOrgId, memberOrgId, overrides = {}) =>
  submissionFor({ schemeOrgId, memberOrgId, ...overrides })

// A batch is for one scheme and one compliance year (currentYear), with
// different members and quarters.
const quarters = ['Q1', 'Q2', 'Q3', 'Q4']

const membersOf = (count) => Array.from({ length: count }, () => objectId())

// Every version of a scheme's submissions, current and superseded.
const allVersions = async (request, accessToken, schemeOrgId) =>
  (await list(request, accessToken, { schemeOrgId, returnCurrentOnly: false }))
    .items

const currentOnly = (items) => items.filter((item) => item.isCurrent)

// For each key, the versions are 1, 2, 3 and so on, each one superseding the
// one before it, and exactly one is current.
function expectUnbrokenChains(items) {
  const byKey = Object.groupBy(
    items,
    (item) =>
      `${item.memberOrgId}/${item.compliancePeriodYear}/${item.compliancePeriodQuarter}`
  )
  for (const versions of Object.values(byKey)) {
    versions.sort((a, b) => a.version - b.version)
    expect(versions.map((item) => item.version)).toEqual(
      versions.map((_, index) => index + 1)
    )
    expect(currentOnly(versions)).toHaveLength(1)
    expect(versions.at(-1).isCurrent).toBe(true)
    versions.slice(1).forEach((item, index) => {
      expect(item.supersedesSubmissionId).toBe(versions[index].id)
    })
  }
}

// Errors of a single create, keyed the way a batch keys them for item `index`.
const withIndex = (errors, index) =>
  Object.fromEntries(
    Object.entries(errors).map(([field, messages]) => [
      `[${index}].${field}`,
      messages
    ])
  )

test.describe('POST /pom-submissions/upsert-batch: creating', () => {
  test(
    'Should create every item in the batch and report them in request order',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const [m0, m1, m2] = membersOf(3)

      const results = await upserted(request, accessToken, [
        itemFor(schemeOrgId, m0, { year: currentYear, quarter: 'Q1' }),
        itemFor(schemeOrgId, m1, { year: currentYear, quarter: 'Q2' }),
        itemFor(schemeOrgId, m2, { year: currentYear, quarter: 'Q4' })
      ])

      expect(results).toHaveLength(3)
      expect(results).toEqual([
        {
          requestIndex: 0,
          id: expect.stringMatching(objectIdPattern),
          schemeOrgId,
          memberOrgId: m0,
          compliancePeriodYear: currentYear,
          compliancePeriodQuarter: 'Q1',
          action: 'Created'
        },
        {
          requestIndex: 1,
          id: expect.stringMatching(objectIdPattern),
          schemeOrgId,
          memberOrgId: m1,
          compliancePeriodYear: currentYear,
          compliancePeriodQuarter: 'Q2',
          action: 'Created'
        },
        {
          requestIndex: 2,
          id: expect.stringMatching(objectIdPattern),
          schemeOrgId,
          memberOrgId: m2,
          compliancePeriodYear: currentYear,
          compliancePeriodQuarter: 'Q4',
          action: 'Created'
        }
      ])
      expect(new Set(results.map((result) => result.id)).size).toBe(3)
    }
  )

  test(
    'Should return only a short result for each item',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const [result] = await upserted(request, accessToken, [
        itemFor(objectId(), objectId())
      ])

      expect(Object.keys(result).sort()).toEqual([
        'action',
        'compliancePeriodQuarter',
        'compliancePeriodYear',
        'id',
        'memberOrgId',
        'requestIndex',
        'schemeOrgId'
      ])
    }
  )

  test(
    'Should save each created item as version 1 and current, with the posted values',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const [m0, m1] = membersOf(2)
      const posted = [
        itemFor(schemeOrgId, m0, { tonnage: [['Alkaline', '1.250']] }),
        itemFor(schemeOrgId, m1, {
          memberName: 'Second Member Ltd',
          tonnage: [['Lithium', '7.000']]
        })
      ]

      const results = await upserted(request, accessToken, posted)

      for (const [index, result] of results.entries()) {
        const saved = await getById(request, accessToken, result.id)
        expect(saved).toMatchObject({
          id: result.id,
          version: 1,
          isCurrent: true,
          supersedesSubmissionId: null,
          schemeOrgId,
          memberOrgId: posted[index].memberOrgId,
          memberName: posted[index].memberName,
          compliancePeriodYear: currentYear,
          compliancePeriodQuarter: 'Q1',
          dataBasis: 'Actual',
          tonnageEntries: [
            {
              classification: posted[index].tonnageEntries[0].classification,
              tonnes: posted[index].tonnageEntries[0].tonnes
            }
          ]
        })
      }
    }
  )

  test(
    'Should create several members across the quarters of one year',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const [m0, m1] = membersOf(2)
      const periods = [
        [m0, currentYear, 'Q1'],
        [m0, currentYear, 'Q2'],
        [m0, currentYear, 'Q4'],
        [m1, currentYear, 'Q1'],
        [m1, currentYear, 'Q3']
      ]

      await upserted(
        request,
        accessToken,
        periods.map(([member, year, quarter]) =>
          itemFor(schemeOrgId, member, { year, quarter })
        )
      )

      const page = await list(request, accessToken, { schemeOrgId })
      expect(page.totalCount).toBe(5)
      expect(
        page.items
          .map(
            (item) =>
              `${item.memberOrgId} ${item.compliancePeriodYear} ${item.compliancePeriodQuarter}`
          )
          .sort()
      ).toEqual(
        periods
          .map(([member, year, quarter]) => `${member} ${year} ${quarter}`)
          .sort()
      )
    }
  )

  test(
    'Should accept a batch of one',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const results = await upserted(request, accessToken, [
        itemFor(objectId(), objectId())
      ])

      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({ requestIndex: 0, action: 'Created' })
    }
  )

  test(
    'Should create a submission for each member of the same quarter',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const members = membersOf(4)

      await upserted(
        request,
        accessToken,
        members.map((member) => itemFor(schemeOrgId, member))
      )

      const page = await list(request, accessToken, { schemeOrgId })
      expect(page.items.map((item) => item.memberOrgId).sort()).toEqual(
        [...members].sort()
      )
    }
  )

  test(
    'Should give every item in a batch the same created time and no updated time',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()

      await upserted(
        request,
        accessToken,
        membersOf(3).map((member) => itemFor(schemeOrgId, member))
      )

      const { items } = await list(request, accessToken, { schemeOrgId })
      expect(new Set(items.map((item) => item.createdAtUtc)).size).toBe(1)
      expect(items.every((item) => item.updatedAtUtc === null)).toBe(true)
    }
  )
})

test.describe('POST /pom-submissions/upsert-batch: amending', () => {
  test(
    'Should amend an item that already has a current submission and report it as Amended',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const key = { schemeOrgId: objectId(), memberOrgId: objectId() }
      const v1 = await create(request, accessToken, key)

      const [result] = await upserted(request, accessToken, [
        itemFor(key.schemeOrgId, key.memberOrgId, {
          tonnage: [['Alkaline', '99.000']]
        })
      ])

      expect(result).toMatchObject({ requestIndex: 0, action: 'Amended' })
      expect(result.id).not.toBe(v1.id)
      expect(await getById(request, accessToken, result.id)).toMatchObject({
        version: 2,
        isCurrent: true,
        supersedesSubmissionId: v1.id,
        tonnageEntries: [
          { classification: { chemistry: 'Alkaline' }, tonnes: '99.000' }
        ]
      })
    }
  )

  test(
    'Should keep the old version unchanged apart from losing current status',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const key = { schemeOrgId: objectId(), memberOrgId: objectId() }
      const v1 = await create(request, accessToken, key)

      await upserted(request, accessToken, [
        itemFor(key.schemeOrgId, key.memberOrgId, {
          tonnage: [['Alkaline', '99.000']]
        })
      ])

      const old = await getById(request, accessToken, v1.id)
      expect(old.isCurrent).toBe(false)
      expect(old.updatedAtUtc).not.toBeNull()
      expect(toMillisecond(old.createdAtUtc)).toBe(
        toMillisecond(v1.createdAtUtc)
      )
      expect(old).toMatchObject({
        id: v1.id,
        version: 1,
        schemeOrgId: key.schemeOrgId,
        memberOrgId: key.memberOrgId,
        memberName: v1.memberName,
        supersedesSubmissionId: null,
        tonnageEntries: v1.tonnageEntries
      })
    }
  )

  test(
    'Should tie the old and new versions together with their timestamps',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const key = { schemeOrgId: objectId(), memberOrgId: objectId() }
      const v1 = await create(request, accessToken, key)

      const [result] = await upserted(request, accessToken, [
        itemFor(key.schemeOrgId, key.memberOrgId)
      ])

      const old = await getById(request, accessToken, v1.id)
      const current = await getById(request, accessToken, result.id)
      expect(toMillisecond(old.updatedAtUtc)).toBe(
        toMillisecond(current.createdAtUtc)
      )
    }
  )

  test(
    'Should report each item of a mixed batch as Created or Amended',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const [existingA, newMember, existingB] = membersOf(3)
      await create(request, accessToken, {
        schemeOrgId,
        memberOrgId: existingA
      })
      await create(request, accessToken, {
        schemeOrgId,
        memberOrgId: existingB
      })

      const results = await upserted(request, accessToken, [
        itemFor(schemeOrgId, existingA),
        itemFor(schemeOrgId, newMember),
        itemFor(schemeOrgId, existingB),
        // A different quarter of an existing member has no current row.
        itemFor(schemeOrgId, existingA, { quarter: 'Q2' })
      ])

      expect(
        results.map(({ requestIndex, memberOrgId, action }) => [
          requestIndex,
          memberOrgId,
          action
        ])
      ).toEqual([
        [0, existingA, 'Amended'],
        [1, newMember, 'Created'],
        [2, existingB, 'Amended'],
        [3, existingA, 'Created']
      ])
    }
  )

  test(
    'Should accept the same data again and save it as a new version',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const key = { schemeOrgId: objectId(), memberOrgId: objectId() }
      const v1 = await create(request, accessToken, key)

      const [result] = await upserted(request, accessToken, [
        itemFor(key.schemeOrgId, key.memberOrgId)
      ])

      expect(result.action).toBe('Amended')
      expect(result.id).not.toBe(v1.id)
      const current = await getById(request, accessToken, result.id)
      expect(current.version).toBe(2)
      expect(current.tonnageEntries.map((entry) => entry.tonnes)).toEqual(
        v1.tonnageEntries.map((entry) => entry.tonnes)
      )
    }
  )

  test(
    'Should add a version each time the same batch is posted',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const members = membersOf(2)
      const batch = members.map((member) => itemFor(schemeOrgId, member))

      const first = await upserted(request, accessToken, batch)
      const second = await upserted(request, accessToken, batch)
      const third = await upserted(request, accessToken, batch)

      expect(first.map((result) => result.action)).toEqual([
        'Created',
        'Created'
      ])
      expect(second.map((result) => result.action)).toEqual([
        'Amended',
        'Amended'
      ])
      expect(third.map((result) => result.action)).toEqual([
        'Amended',
        'Amended'
      ])
      const items = await allVersions(request, accessToken, schemeOrgId)
      expect(items).toHaveLength(6)
      expectUnbrokenChains(items)
      expect(items.map((item) => item.version).sort()).toEqual([
        1, 1, 2, 2, 3, 3
      ])
    }
  )

  test(
    'Should leave the other members of the batch scheme and other quarters alone',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const [amended, other, another] = membersOf(3)
      const created = await Promise.all([
        create(request, accessToken, { schemeOrgId, memberOrgId: amended }),
        create(request, accessToken, { schemeOrgId, memberOrgId: other }),
        create(request, accessToken, {
          schemeOrgId,
          memberOrgId: amended,
          quarter: 'Q2'
        }),
        create(request, accessToken, { schemeOrgId, memberOrgId: another })
      ])

      await upserted(request, accessToken, [itemFor(schemeOrgId, amended)])

      const current = currentOnly(
        await allVersions(request, accessToken, schemeOrgId)
      )
      const byId = new Map(current.map((item) => [item.id, item]))
      for (const untouched of [created[1], created[2], created[3]]) {
        expect(byId.get(untouched.id)).toMatchObject({
          version: 1,
          isCurrent: true
        })
      }
      expect(byId.has(created[0].id)).toBe(false)
    }
  )

  test(
    'Should list only the new versions by default and both with returnCurrentOnly=false',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const key = { schemeOrgId: objectId(), memberOrgId: objectId() }
      const v1 = await create(request, accessToken, key)
      const [result] = await upserted(request, accessToken, [
        itemFor(key.schemeOrgId, key.memberOrgId)
      ])

      const byDefault = await list(request, accessToken, {
        schemeOrgId: key.schemeOrgId
      })
      const everything = await list(request, accessToken, {
        schemeOrgId: key.schemeOrgId,
        returnCurrentOnly: false
      })

      expect(byDefault.items.map((item) => item.id)).toEqual([result.id])
      expect(everything.items.map((item) => item.id).sort()).toEqual(
        [v1.id, result.id].sort()
      )
    }
  )
})

test.describe('POST /pom-submissions/upsert-batch: validation', () => {
  // Each invalid item is also sent to create. The batch must report the same
  // errors, with the item position in front of each field.
  const invalidItems = {
    'an empty member name': { memberName: '' },
    'a scheme id that is not an ObjectId': { schemeOrgId: 'not-an-id' },
    'a member id that is not an ObjectId': { memberOrgId: 'not-an-id' },
    'a BPRN in the wrong format': { memberBprn: `BPRN-XX-${currentYear}-1` },
    'a BPRN year that differs from the compliance year': {
      memberBprn: `BPRN-EA-${currentYear - 1}-000001`
    },
    'an empty scheme membership reference': { schemeMembershipRef: '' },
    'an empty data basis': { dataBasis: '' },
    'tonnes without three decimals': {
      tonnageEntries: [
        { classification: { chemistry: 'Alkaline' }, tonnes: '12.5' }
      ]
    },
    'an empty chemistry': {
      tonnageEntries: [{ classification: { chemistry: '' }, tonnes: '1.000' }]
    },
    'a classification reported twice': {
      tonnageEntries: [
        { classification: { chemistry: 'Alkaline' }, tonnes: '1.000' },
        { classification: { chemistry: 'Alkaline' }, tonnes: '2.000' }
      ]
    },
    'no tonnage entries': { tonnageEntries: [] }
  }

  for (const [description, overrides] of Object.entries(invalidItems)) {
    test(
      `Should report the same error as create for ${description}`,
      { tag: ['@batch', '@api'] },
      async ({ request, accessToken }) => {
        const schemeOrgId = objectId()
        const valid = itemFor(schemeOrgId, objectId())
        const invalid = { ...itemFor(schemeOrgId, objectId()), ...overrides }

        const created = await request.post(base, {
          headers: authHeaders(accessToken),
          data: invalid
        })
        const response = await upsert(request, accessToken, [valid, invalid])

        expect(created.status()).toBe(400)
        expect(response.status()).toBe(400)
        const { errors } = await response.json()
        expect(errors).toEqual(withIndex((await created.json()).errors, 1))
      }
    )
  }

  test(
    'Should return the errors of every invalid item in one response',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()

      const response = await upsert(request, accessToken, [
        itemFor(schemeOrgId, objectId()),
        itemFor(schemeOrgId, objectId(), { memberName: '' }),
        itemFor(schemeOrgId, objectId()),
        {
          ...itemFor(schemeOrgId, objectId()),
          memberBprn: `BPRN-XX-${currentYear}-1`
        }
      ])

      expect(response.status()).toBe(400)
      expect((await response.json()).errors).toEqual({
        '[1].MemberName': ["'Member Name' must not be empty."],
        '[3].MemberBprn': [
          'memberBprn must match BPRN-{EA|NRW|SEPA|NIEA}-{year}-{6 digits}.'
        ]
      })
    }
  )

  test(
    'Should return every error of a single invalid item',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const invalid = {
        ...itemFor(schemeOrgId, objectId()),
        memberName: '',
        memberBprn: `BPRN-XX-${currentYear}-1`,
        dataBasis: '',
        tonnageEntries: [{ classification: { chemistry: '' }, tonnes: '12.5' }]
      }

      const created = await request.post(base, {
        headers: authHeaders(accessToken),
        data: invalid
      })
      const response = await upsert(request, accessToken, [invalid])

      expect(response.status()).toBe(400)
      const { errors } = await response.json()
      expect(Object.keys(errors)).toHaveLength(5)
      expect(errors).toEqual(withIndex((await created.json()).errors, 0))
    }
  )

  test(
    'Should refuse two items for the same scheme, member, year and quarter',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const memberOrgId = objectId()

      const response = await upsert(request, accessToken, [
        itemFor(schemeOrgId, memberOrgId),
        itemFor(schemeOrgId, objectId()),
        itemFor(schemeOrgId, memberOrgId, {
          tonnage: [['Alkaline', '5.000']]
        })
      ])

      expect(response.status()).toBe(400)
      expect((await response.json()).errors).toEqual({
        '[2].Submission': [
          'This submission repeats [0] for the same scheme, member, year and quarter.'
        ]
      })
    }
  )

  test(
    'Should refuse an empty array',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const response = await upsert(request, accessToken, [])

      expect(response.status()).toBe(400)
      expect((await response.json()).errors).toEqual({
        Submissions: ['At least one submission is required.']
      })
    }
  )

  test(
    'Should refuse a null item',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const response = await upsert(request, accessToken, [
        itemFor(objectId(), objectId()),
        null
      ])

      expect(response.status()).toBe(400)
      expect((await response.json()).errors).toEqual({
        '[1].Submission': ['A submission must not be empty.']
      })
    }
  )

  test(
    'Should refuse an unknown property on an item',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const memberOrgId = objectId()

      const response = await upsert(request, accessToken, [
        {
          ...itemFor(schemeOrgId, memberOrgId),
          supersedesSubmissionId: objectId()
        }
      ])

      expect(response.status()).toBe(400)
      expect(await allVersions(request, accessToken, schemeOrgId)).toHaveLength(
        0
      )
    }
  )

  test(
    'Should refuse a body that is an object, not an array',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()

      const response = await upsert(
        request,
        accessToken,
        itemFor(schemeOrgId, objectId())
      )

      expect(response.status()).toBe(400)
      expect(await allVersions(request, accessToken, schemeOrgId)).toHaveLength(
        0
      )
    }
  )

  test(
    'Should refuse a request with no body',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const response = await request.post(url, {
        headers: authHeaders(accessToken)
      })

      expect(response.status()).toBe(400)
    }
  )
})

test.describe('POST /pom-submissions/upsert-batch: all or nothing', () => {
  test(
    'Should save none of the valid new items when one item is invalid',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()

      const response = await upsert(request, accessToken, [
        itemFor(schemeOrgId, objectId()),
        itemFor(schemeOrgId, objectId(), { memberName: '' }),
        itemFor(schemeOrgId, objectId())
      ])

      expect(response.status()).toBe(400)
      expect(await allVersions(request, accessToken, schemeOrgId)).toHaveLength(
        0
      )
    }
  )

  test(
    'Should leave existing submissions current at their old version when one item is invalid',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const [a, b, c] = membersOf(3)
      const created = await Promise.all([
        create(request, accessToken, { schemeOrgId, memberOrgId: a }),
        create(request, accessToken, { schemeOrgId, memberOrgId: b })
      ])

      const response = await upsert(request, accessToken, [
        itemFor(schemeOrgId, a, { tonnage: [['Alkaline', '99.000']] }),
        itemFor(schemeOrgId, b, { tonnage: [['Alkaline', '99.000']] }),
        itemFor(schemeOrgId, c, { memberName: '' })
      ])

      expect(response.status()).toBe(400)
      const items = await allVersions(request, accessToken, schemeOrgId)
      expect(items.map((item) => item.id).sort()).toEqual(
        created.map((submission) => submission.id).sort()
      )
      for (const item of items) {
        expect(item).toMatchObject({
          version: 1,
          isCurrent: true,
          updatedAtUtc: null
        })
      }
    }
  )

  test(
    'Should save nothing when a key is repeated',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const memberOrgId = objectId()

      const response = await upsert(request, accessToken, [
        itemFor(schemeOrgId, memberOrgId),
        itemFor(schemeOrgId, objectId()),
        itemFor(schemeOrgId, memberOrgId)
      ])

      expect(response.status()).toBe(400)
      expect(await allVersions(request, accessToken, schemeOrgId)).toHaveLength(
        0
      )
    }
  )

  test(
    'Should leave exactly one current submission for each key after a batch',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const [a, b] = membersOf(2)
      await create(request, accessToken, { schemeOrgId, memberOrgId: a })

      await upserted(request, accessToken, [
        itemFor(schemeOrgId, a),
        itemFor(schemeOrgId, b)
      ])

      const items = await allVersions(request, accessToken, schemeOrgId)
      expect(items).toHaveLength(3)
      expectUnbrokenChains(items)
    }
  )

  test(
    'Should accept the corrected batch after a rejected one',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const [a, b] = membersOf(2)

      const rejected = await upsert(request, accessToken, [
        itemFor(schemeOrgId, a),
        itemFor(schemeOrgId, b, { memberName: '' })
      ])
      const accepted = await upsert(request, accessToken, [
        itemFor(schemeOrgId, a),
        itemFor(schemeOrgId, b)
      ])

      expect(rejected.status()).toBe(400)
      expect(accepted.status()).toBe(200)
      expect((await accepted.json()).map((result) => result.action)).toEqual([
        'Created',
        'Created'
      ])
    }
  )
})

// The outcome of two requests at once depends on timing, so these assert only
// what must always hold: each response is 200 or 400, and every key ends with
// exactly one current version in an unbroken chain.
test.describe('POST /pom-submissions/upsert-batch: concurrency', () => {
  test(
    'Should leave one current version when two batches create the same keys together',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const members = membersOf(3)
      const batch = members.map((member) => itemFor(schemeOrgId, member))

      const responses = await Promise.all([
        upsert(request, accessToken, batch),
        upsert(request, accessToken, batch)
      ])

      for (const response of responses) {
        expect([200, 400]).toContain(response.status())
      }
      expect(responses.map((response) => response.status())).toContain(200)
      const items = await allVersions(request, accessToken, schemeOrgId)
      expectUnbrokenChains(items)
      expect(currentOnly(items)).toHaveLength(3)
    }
  )

  test(
    'Should leave one current version when two batches amend the same keys together',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const members = membersOf(3)
      await Promise.all(
        members.map((memberOrgId) =>
          create(request, accessToken, { schemeOrgId, memberOrgId })
        )
      )
      const batch = members.map((member) => itemFor(schemeOrgId, member))

      const responses = await Promise.all([
        upsert(request, accessToken, batch),
        upsert(request, accessToken, batch)
      ])

      for (const response of responses) {
        expect([200, 400]).toContain(response.status())
      }
      expect(responses.map((response) => response.status())).toContain(200)
      const items = await allVersions(request, accessToken, schemeOrgId)
      expectUnbrokenChains(items)
      expect(currentOnly(items)).toHaveLength(3)
    }
  )

  test(
    'Should leave one current version when a batch and a single amendment arrive together',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const key = { schemeOrgId: objectId(), memberOrgId: objectId() }
      await create(request, accessToken, key)

      const responses = await Promise.all([
        upsert(request, accessToken, [
          itemFor(key.schemeOrgId, key.memberOrgId)
        ]),
        patch(request, accessToken, itemFor(key.schemeOrgId, key.memberOrgId))
      ])

      for (const response of responses) {
        expect([200, 400]).toContain(response.status())
      }
      const items = await allVersions(request, accessToken, key.schemeOrgId)
      expectUnbrokenChains(items)
      expect(currentOnly(items)).toHaveLength(1)
    }
  )
})

test.describe('POST /pom-submissions/upsert-batch: authentication', () => {
  const credentials = {
    'no Authorization header': undefined,
    'an empty bearer': 'Bearer ',
    'a garbage token': 'Bearer abc'
  }

  for (const [description, authorization] of Object.entries(credentials)) {
    test(
      `Should return 401 for ${description}`,
      { tag: ['@batch', '@api'] },
      async ({ request, accessToken }) => {
        const schemeOrgId = objectId()

        const response = await request.post(url, {
          headers: {
            ...backendHeaders,
            ...(viaGateway && { 'Accept-Encoding': 'identity' }),
            ...(authorization && { Authorization: authorization })
          },
          data: [itemFor(schemeOrgId, objectId())]
        })

        expect(response.status()).toBe(401)
        expect(
          await allVersions(request, accessToken, schemeOrgId)
        ).toHaveLength(0)
      }
    )
  }
})

test.describe('POST /pom-submissions/upsert-batch: size and scope', () => {
  // The largest real batch: a scheme has at most 250 members and files all four
  // quarters of one year (1000 items), each with up to 4 tonnage entries. The
  // test uses 300 members, 1200 items, for a margin.
  test(
    'Should save a full year for 300 members, with 4 tonnage entries each, and keep the response short',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const tonnage = [
        ['Alkaline', '12.500'],
        ['Lithium', '3.250'],
        ['Nickel metal hydride', '1.750'],
        ['Zinc carbon', '0.500']
      ]
      const batch = membersOf(300).flatMap((member) =>
        quarters.map((quarter) =>
          itemFor(schemeOrgId, member, { year: currentYear, quarter, tonnage })
        )
      )
      expect(batch).toHaveLength(1200)

      const response = await upsert(request, accessToken, batch)

      expect(response.status()).toBe(200)
      const results = await response.json()
      expect(results).toHaveLength(1200)
      expect(results.every((result) => result.action === 'Created')).toBe(true)
      expect(results.map((result) => result.requestIndex)).toEqual(
        results.map((_, index) => index)
      )
      const page = await list(request, accessToken, { schemeOrgId })
      expect(page.totalCount).toBe(1200)
    }
  )

  test(
    'Should leave a member missing from a later batch unchanged',
    { tag: ['@batch', '@api'] },
    async ({ request, accessToken }) => {
      const schemeOrgId = objectId()
      const [a, b, c] = membersOf(3)
      const first = await upserted(request, accessToken, [
        itemFor(schemeOrgId, a),
        itemFor(schemeOrgId, b),
        itemFor(schemeOrgId, c)
      ])

      const second = await upserted(request, accessToken, [
        itemFor(schemeOrgId, a),
        itemFor(schemeOrgId, b)
      ])

      expect(second.map((result) => result.action)).toEqual([
        'Amended',
        'Amended'
      ])
      const current = currentOnly(
        await allVersions(request, accessToken, schemeOrgId)
      )
      const missing = current.find((item) => item.memberOrgId === c)
      expect(missing).toMatchObject({ id: first[2].id, version: 1 })
    }
  )
})
