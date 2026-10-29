import { describe, expect, it } from 'vitest'
import { keyDates, upcomingHolidays } from './keyDates'
import { closingYears, NOT_RECORDED, production, type ProductionLoan } from './production'

const labels = { loanType: (v: string) => v.toUpperCase(), purpose: (v: string) => v }
const loan = (over: Partial<ProductionLoan>): ProductionLoan => ({ closingDate: '2025-03-01', loanAmount: 300000, lender: 'Lender A', loName: 'Connor', loanType: 'fha', purpose: 'purchase', ...over })

describe('production', () => {
  const loans = [
    loan({}),
    loan({ loanAmount: 500000, lender: 'Lender B', loanType: 'conventional' }),
    loan({ closingDate: '2024-06-01', loanAmount: 200000, loName: 'Dave' }),
    loan({ loanAmount: null, lender: null, loanType: null }),
  ]

  it('lists closing years newest first', () => {
    expect(closingYears([...loans, loan({ closingDate: null })])).toEqual([2025, 2024])
  })

  it('totals loans and volume, and groups by lender, loan officer and loan type', () => {
    const p = production(loans, labels)
    expect(p).toMatchObject({ count: 4, volume: 1_000_000, average: 333_333, missingAmount: 1 })
    expect(p.byLender.map((g) => [g.label, g.count, g.volume])).toEqual([
      ['Lender A', 2, 500_000],
      ['Lender B', 1, 500_000],
      [NOT_RECORDED, 1, 0],
    ])
    expect(p.byLo.map((g) => [g.label, g.count, g.share])).toEqual([
      ['Connor', 3, 0.75],
      ['Dave', 1, 0.25],
    ])
    expect(p.byLoanType.map((g) => g.label)).toEqual(['FHA', 'CONVENTIONAL', NOT_RECORDED])
  })

  it('handles no loans', () => {
    expect(production([], labels)).toMatchObject({ count: 0, volume: 0, average: null, byLender: [] })
  })
})

describe('keyDates', () => {
  const facts = { closingDate: '2026-10-27', firstPaymentDate: '2026-12-01', birthday: '1985-11-15', insuranceRenewalDate: '2026-10-27', homesteadFiled: null, occupancy: 'primary' }

  it('lists a new client\'s dates for the next year, soonest first', () => {
    expect(keyDates(facts, '2026-10-29', 365).map((d) => [d.date, d.kind])).toEqual([
      ['2026-10-30', 'thank_you'],
      ['2026-11-15', 'birthday'],
      ['2026-11-24', 'first_payment'],
      ['2027-01-02', 'homestead'],
      ['2027-09-27', 'insurance'],
      ['2027-10-27', 'anniversary'],
    ])
  })

  it('names the anniversary year and drops one-time dates once they pass', () => {
    const later = keyDates({ ...facts, closingDate: '2023-05-01', firstPaymentDate: '2023-06-01', homesteadFiled: true }, '2026-10-29', 365)
    expect(later.find((d) => d.kind === 'anniversary')).toMatchObject({ date: '2027-05-01', label: '4th home anniversary' })
    expect(later.some((d) => ['thank_you', 'first_payment', 'homestead'].includes(d.kind))).toBe(false)
  })

  it('skips the homestead reminder when it is filed or the home is not a primary residence', () => {
    expect(keyDates({ ...facts, homesteadFiled: true }, '2026-10-29', 365).some((d) => d.kind === 'homestead')).toBe(false)
    expect(keyDates({ ...facts, occupancy: 'investment' }, '2026-10-29', 365).some((d) => d.kind === 'homestead')).toBe(false)
  })

  it('moves a Feb 29 birthday to Feb 28 in other years', () => {
    expect(keyDates({ ...facts, birthday: '1992-02-29' }, '2026-10-29', 365).find((d) => d.kind === 'birthday')?.date).toBe('2027-02-28')
  })

  it('keeps to the window and makes a source key per date', () => {
    const month = keyDates(facts, '2026-10-29', 30)
    expect(month.map((d) => d.sourceKey)).toEqual(['followup:thank_you:2026-10-30', 'followup:birthday:2026-11-15', 'followup:first_payment:2026-11-24'])
  })

  it('adds holidays when asked, with Thanksgiving on the fourth Thursday', () => {
    expect(upcomingHolidays('2026-10-29').map((h) => [h.label, h.date])).toEqual([
      ["New Year's Day", '2027-01-01'],
      ['Fourth of July', '2027-07-04'],
      ['Thanksgiving', '2026-11-26'],
      ['Christmas', '2026-12-25'],
    ])
    expect(upcomingHolidays('2027-01-01').find((h) => h.label === 'Thanksgiving')?.date).toBe('2027-11-25')
    expect(keyDates(facts, '2026-10-29', 40, { holidays: true }).filter((d) => d.kind === 'holiday').map((d) => d.label)).toEqual(['Thanksgiving'])
  })
})
