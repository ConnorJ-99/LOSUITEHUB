import { describe, expect, it } from 'vitest'
import {
  daysSince,
  emptyFilters,
  formatDaysInStage,
  formatPhone,
  fullName,
  isOnBoard,
  matchesFilters,
  phoneDigits,
  type SearchableLoan,
} from './helpers'
import { STAGES, purposeLabel, stageLabel } from './stages'

const now = new Date('2026-10-25T15:00:00Z')

describe('stages', () => {
  it('lists the 8 main stages in order, then Nurture and Lost', () => {
    expect(STAGES.filter((s) => s.kind === 'main').map((s) => s.value)).toEqual([
      'lead', 'contacted', 'pre_qualified', 'pre_approved', 'under_contract', 'processing', 'clear_to_close', 'closed',
    ])
    expect(STAGES.filter((s) => s.kind === 'side').map((s) => s.value)).toEqual(['nurture', 'lost'])
  })

  it('has labels', () => {
    expect(stageLabel('clear_to_close')).toBe('Approved / CTC')
    expect(purposeLabel('refinance_cash_out')).toBe('Cash-Out Refi')
  })
})

describe('days in stage', () => {
  it('counts whole days', () => {
    expect(daysSince('2026-10-25T09:00:00Z', now)).toBe(0)
    expect(daysSince('2026-10-24T14:00:00Z', now)).toBe(1)
    expect(daysSince('2026-10-13T15:00:00Z', now)).toBe(12)
  })

  it('never goes negative', () => {
    expect(daysSince('2026-10-26T00:00:00Z', now)).toBe(0)
  })

  it('formats', () => {
    expect(formatDaysInStage(0)).toBe('Today')
    expect(formatDaysInStage(1)).toBe('1 day')
    expect(formatDaysInStage(5)).toBe('5 days')
  })
})

describe('phones and names', () => {
  it('normalizes phone digits', () => {
    expect(phoneDigits('(214) 555-0100')).toBe('2145550100')
    expect(phoneDigits('  ')).toBeNull()
    expect(phoneDigits(null)).toBeNull()
  })

  it('formats US numbers and leaves others alone', () => {
    expect(formatPhone('2145550100')).toBe('(214) 555-0100')
    expect(formatPhone('+1 214 555 0100')).toBe('(214) 555-0100')
    expect(formatPhone('555-0100')).toBe('555-0100')
  })

  it('builds full names', () => {
    expect(fullName({ firstName: 'Jane', lastName: 'Smith' })).toBe('Jane Smith')
    expect(fullName({ firstName: 'Cher', lastName: '' })).toBe('Cher')
    expect(fullName(null)).toBe('No borrower')
  })
})

describe('board visibility', () => {
  it('keeps active stages forever', () => {
    expect(isOnBoard('lead', '2025-01-01T00:00:00Z', now)).toBe(true)
  })

  it('drops Closed and Lost after 30 days', () => {
    expect(isOnBoard('closed', '2026-10-01T00:00:00Z', now)).toBe(true)
    expect(isOnBoard('closed', '2026-09-01T00:00:00Z', now)).toBe(false)
    expect(isOnBoard('lost', '2026-09-01T00:00:00Z', now)).toBe(false)
  })
})

describe('matchesFilters', () => {
  const loan: SearchableLoan = {
    stage: 'pre_approved',
    purpose: 'purchase',
    assignedLoId: 'lo-1',
    referralSource: 'Realtor Amy Lee',
    borrower: { firstName: 'Jane', lastName: 'Smith', email: 'jane@example.com', phone: '(214) 555-0100' },
  }
  const f = (over: Partial<typeof emptyFilters>) => ({ ...emptyFilters, ...over })

  it('matches everything with no filters', () => {
    expect(matchesFilters(loan, emptyFilters)).toBe(true)
  })

  it('searches name, email and referral source, any word order', () => {
    expect(matchesFilters(loan, f({ search: 'smith jane' }))).toBe(true)
    expect(matchesFilters(loan, f({ search: 'JANE@EXAMPLE' }))).toBe(true)
    expect(matchesFilters(loan, f({ search: 'amy' }))).toBe(true)
    expect(matchesFilters(loan, f({ search: 'bob' }))).toBe(false)
  })

  it('searches phone in any format', () => {
    expect(matchesFilters(loan, f({ search: '214-555' }))).toBe(true)
    expect(matchesFilters(loan, f({ search: '5550100' }))).toBe(true)
    expect(matchesFilters(loan, f({ search: '999' }))).toBe(false)
  })

  it('applies dropdown filters', () => {
    expect(matchesFilters(loan, f({ stage: 'pre_approved' }))).toBe(true)
    expect(matchesFilters(loan, f({ stage: 'lead' }))).toBe(false)
    expect(matchesFilters(loan, f({ purpose: 'heloc' }))).toBe(false)
    expect(matchesFilters(loan, f({ assignedLoId: 'lo-2' }))).toBe(false)
  })
})
