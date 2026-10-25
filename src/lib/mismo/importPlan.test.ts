import { describe, expect, it } from 'vitest'
import { emptyDeclarations, type ApplicationBorrower } from '@/lib/api/urla'
import { defaultTargets, nameMismatch, personChanges, sameAddress } from './importPlan'
import type { ImportedBorrower } from './parse'
import { person } from './testFixture'

const existing = (id: string, role: 'primary' | 'co_borrower', over: Parameters<typeof person>[0]): ApplicationBorrower => ({
  contactId: id, role, person: person(over), addresses: [], employments: [], otherIncomes: [], declarations: emptyDeclarations,
})
const imported = (isPrimary: boolean, over: Parameters<typeof person>[0]): ImportedBorrower => ({
  isPrimary, person: person(over), addresses: [], employments: [], otherIncomes: [], declarations: emptyDeclarations,
})

describe('defaultTargets', () => {
  const loanBorrowers = [existing('p', 'primary', { firstName: 'Jane', lastName: 'Doe', email: 'jane@x.com' }), existing('c', 'co_borrower', { firstName: 'John', lastName: 'Doe', phone: '214-555-0101' })]

  it('matches by email, phone or name before position', () => {
    const file = [imported(true, { firstName: 'John', lastName: 'Doe', phone: '(214) 555 0101' }), imported(false, { firstName: 'J', lastName: 'D', email: 'JANE@x.com' })]
    expect(defaultTargets(file, loanBorrowers)).toEqual([{ kind: 'update', contactId: 'c' }, { kind: 'update', contactId: 'p' }])
  })

  it('falls back to primary-to-primary, then co-borrowers in order, then new', () => {
    const file = [imported(true, { firstName: 'Ana', lastName: 'Lopez' }), imported(false, { firstName: 'Luis', lastName: 'Lopez' }), imported(false, { firstName: 'Extra', lastName: 'Person' })]
    expect(defaultTargets(file, loanBorrowers)).toEqual([{ kind: 'update', contactId: 'p' }, { kind: 'update', contactId: 'c' }, { kind: 'new' }])
  })

  it('flags when an update would overwrite a different name', () => {
    expect(nameMismatch(imported(true, { firstName: 'Ana', lastName: 'Lopez' }), loanBorrowers[0])).toBe(true)
    expect(nameMismatch(imported(true, { firstName: 'jane', lastName: 'DOE' }), loanBorrowers[0])).toBe(false)
  })
})

describe('personChanges', () => {
  it('only writes values the file actually has', () => {
    const changes = personChanges(person({ firstName: 'Jane', lastName: 'Doe', dateOfBirth: '1990-01-01', email: null }))
    expect(changes).toMatchObject({ firstName: 'Jane', lastName: 'Doe', dateOfBirth: '1990-01-01' })
    expect('email' in changes).toBe(false)
    expect('militaryActiveDuty' in changes).toBe(false)
  })

  it('writes military flags when the file answered the military question', () => {
    expect(personChanges(person({ militaryService: true, militaryRetired: true }))).toMatchObject({ militaryService: true, militaryRetired: true, militaryActiveDuty: false })
  })
})

describe('sameAddress', () => {
  it('ignores case, punctuation and spacing', () => {
    expect(sameAddress({ addressLine: '123 Test Ln.', zip: '75201' }, { addressLine: ' 123  test ln', zip: '75201-1234' })).toBe(true)
    expect(sameAddress({ addressLine: '123 Test Ln', zip: '75201' }, { addressLine: '123 Test Ln', zip: '75024' })).toBe(false)
    expect(sameAddress({ addressLine: '123 Test Ln', zip: null }, { addressLine: '123 Test Ln', zip: '75024' })).toBe(true)
    expect(sameAddress({ addressLine: '', zip: null }, { addressLine: '', zip: null })).toBe(false)
  })
})
