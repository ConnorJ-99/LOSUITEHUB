import { describe, expect, it } from 'vitest'
import { planTransfer, transferRefusal, type TransferAsk } from './transfer'

const now = new Date('2026-11-16T22:00:00Z')
const ask: TransferAsk = { role: 'loan_officer', callerId: 'me', toLoId: 'lo2', assignedNow: 'lo2', lastChange: { changedBy: 'me', newValue: 'lo2', changedAt: '2026-11-16T21:55:00Z' }, now }

describe('who may move GHL ownership', () => {
  it('owners and admins', () => {
    expect(transferRefusal({ ...ask, role: 'admin', lastChange: null })).toBeNull()
    expect(transferRefusal({ ...ask, role: 'owner', lastChange: null })).toBeNull()
  })
  it('the loan officer who just handed it over', () => {
    expect(transferRefusal(ask)).toBeNull()
    expect(transferRefusal({ ...ask, lastChange: { ...ask.lastChange!, changedAt: '2026-11-16T21:00:00Z' } })).toMatch(/Only an owner/)
    expect(transferRefusal({ ...ask, lastChange: { ...ask.lastChange!, changedBy: 'someone' } })).toMatch(/Only an owner/)
  })
  it('only to whoever the file belongs to now', () => {
    expect(transferRefusal({ ...ask, role: 'admin', assignedNow: 'lo3' })).toMatch(/isn't assigned/)
    expect(transferRefusal({ ...ask, role: 'admin', toLoId: null, assignedNow: null })).toMatch(/no loan officer/)
  })
})

describe('what moves', () => {
  const isTest = (f: string | null, l: string | null) => /\btest\b/i.test(`${f} ${l}`)
  const people = [
    { id: 'a', firstName: 'Ann', lastName: 'TEST', ghlContactId: 'g1', ghlOpportunityId: 'o1', primary: true },
    { id: 'b', firstName: 'Bob', lastName: 'TEST', ghlContactId: 'g2', ghlOpportunityId: 'o2', primary: false },
    { id: 'c', firstName: 'Cy', lastName: 'TEST', ghlContactId: null, ghlOpportunityId: null, primary: false },
    { id: 'd', firstName: 'Dee', lastName: 'Real', ghlContactId: 'g4', ghlOpportunityId: null, primary: false },
  ]
  it('every linked borrower, the primary borrower\'s opportunity', () => {
    const p = planTransfer(people, false, isTest)
    expect(p.contacts.map((c) => c.ghlContactId)).toEqual(['g1', 'g2', 'g4'])
    expect(p.opportunities).toEqual(['o1'])
    expect(p.notes).toEqual([expect.stringMatching(/^Cy TEST isn't in GHL/)])
  })
  it('test mode: TEST names only', () => {
    const p = planTransfer(people, true, isTest)
    expect(p.contacts.map((c) => c.ghlContactId)).toEqual(['g1', 'g2'])
    expect(p.notes.some((n) => n.startsWith('Dee Real: test mode'))).toBe(true)
  })
})
