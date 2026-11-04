import { describe, expect, it } from 'vitest'
import type { ContactSummary, PipelineLoan } from '@/lib/api/types'
import type { ProgramListItem } from '@/lib/api/estimates'
import { borrowerMatches, filterBorrowers, matchProgram } from './filters'

const person = (id: string, firstName: string, lastName: string, email: string | null, phone: string | null): ContactSummary =>
  ({ id, firstName, lastName, email, phone, createdAt: '2026-01-01', loans: [] }) as ContactSummary

describe('borrowerMatches', () => {
  const people = [
    person('1', 'Rita', 'TEST', 'rita.test@example.com', '(214) 555-0101'),
    person('2', 'Marcus', 'TEST', 'marcus.test@example.com', '214-555-0100'),
    person('3', 'Ritaann', 'Other TEST', null, null),
  ]
  it('finds by full name first, then partial', () => {
    expect(borrowerMatches(people, 'rita test').map((p) => p.id)).toEqual(['1', '3'])
  })
  it('finds by phone in any format', () => {
    expect(borrowerMatches(people, '2145550100').map((p) => p.id)).toEqual(['2'])
  })
  it('finds by email', () => {
    expect(borrowerMatches(people, 'marcus.test@example.com').map((p) => p.id)).toEqual(['2'])
  })
  it('never matches on one letter or nothing', () => {
    expect(borrowerMatches(people, 'r')).toEqual([])
    expect(borrowerMatches(people, '  ')).toEqual([])
  })
})

const loan = (id: string, o: Partial<PipelineLoan>): PipelineLoan =>
  ({ id, purpose: 'purchase', stage: 'lead', closingDate: null, borrower: { id: `c${id}`, firstName: 'A', lastName: 'TEST', email: null, phone: null }, ...o }) as PipelineLoan

describe('filterBorrowers', () => {
  const loans = [
    loan('1', { stage: 'closed', closingDate: '2024-05-01' }),
    loan('2', { stage: 'closed', closingDate: '2025-02-01' }),
    loan('3', { stage: 'lead' }),
    loan('4', { stage: 'lead', purpose: 'refinance_rate_term' }),
  ]
  const none = { lastContact: new Map<string, string>(), lenders: new Map<string, string | null>(), now: new Date('2026-11-03T12:00:00Z') }
  it('closed in 2024', () => {
    expect(filterBorrowers(loans, { stages: ['closed'], closingFrom: '2024-01-01', closingTo: '2024-12-31' }, none).rows.map((r) => r.loan.id)).toEqual(['1'])
  })
  it('leads with no contact in 30 days (and leads never contacted)', () => {
    const lastContact = new Map([
      ['c3', '2026-10-30T00:00:00Z'],
      ['c4', '2026-09-01T00:00:00Z'],
    ])
    expect(filterBorrowers(loans, { stages: ['lead'], noContactDays: 30 }, { ...none, lastContact }).rows.map((r) => r.loan.id)).toEqual(['4'])
    expect(filterBorrowers(loans, { stages: ['lead'], noContactDays: 30 }, none).rows.map((r) => r.loan.id)).toEqual(['3', '4'])
  })
  it('by purpose and lender', () => {
    expect(filterBorrowers(loans, { purposes: ['refinance_rate_term'] }, none).rows.map((r) => r.loan.id)).toEqual(['4'])
    expect(filterBorrowers(loans, { lender: 'uwm' }, { ...none, lenders: new Map([['2', 'UWM']]) }).rows.map((r) => r.loan.id)).toEqual(['2'])
  })
  it('caps the list but keeps the total', () => {
    const r = filterBorrowers(loans, { limit: 2 }, none)
    expect(r.rows.length).toBe(2)
    expect(r.total).toBe(4)
  })
})

describe('matchProgram', () => {
  const p = (id: string, lenderName: string, name: string, family = 'conventional') => ({ id, name, family, lien: 'first', active: true, lenderId: `L-${lenderName}`, lenderName, lenderStatus: 'approved' }) as ProgramListItem
  const catalog = [p('1', 'UWM', 'Conventional 30 Fixed'), p('2', 'UWM', 'Conventional 15 Fixed'), p('3', 'UWM', 'FHA 30', 'fha'), p('4', 'Rocket', 'Conventional 30 Fixed')]
  it('finds one by lender and program words', () => {
    expect(matchProgram(catalog, null, 'UWM conventional 30')).toEqual({ program: { id: '1', name: 'Conventional 30 Fixed', family: 'conventional', lenderId: 'L-UWM', lenderName: 'UWM' } })
    expect('program' in matchProgram(catalog, null, 'uwm fha')).toBe(true)
  })
  it('asks when several match', () => {
    const r = matchProgram(catalog, null, 'UWM conventional')
    expect('error' in r && r.error).toMatch(/More than one.*Conventional 30 Fixed.*Conventional 15 Fixed/)
  })
  it('says when none match, with close ones', () => {
    const r = matchProgram(catalog, null, 'Chase jumbo')
    expect('error' in r && r.error).toMatch(/No program matches/)
  })
  it('takes an id', () => {
    expect('program' in matchProgram(catalog, '4', null)).toBe(true)
    expect(matchProgram(catalog, 'nope', null)).toEqual({ error: 'That program is not in the catalog.' })
  })
})

describe('matchProgram exact names', () => {
  const p = (id: string, name: string) => ({ id, name, family: 'conventional', lien: 'first', active: true, lenderId: 'L1', lenderName: 'Pennymac', lenderStatus: 'approved' }) as ProgramListItem
  it('prefers the program named exactly what was said', () => {
    const catalog = [p('1', 'Conventional'), p('2', 'HomeReady'), p('3', 'HomePossible')]
    expect(matchProgram(catalog, null, 'Pennymac conventional')).toEqual({ program: { id: '1', name: 'Conventional', family: 'conventional', lenderId: 'L1', lenderName: 'Pennymac' } })
  })
})
