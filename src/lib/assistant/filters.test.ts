import { describe, expect, it } from 'vitest'
import type { ContactSummary, PipelineLoan } from '@/lib/api/types'
import { borrowerMatches, filterBorrowers } from './filters'

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
