import { describe, expect, it } from 'vitest'
import type { IncomeDoc } from './fromDocuments'
import { reconcileJob } from './reconcile'

const today = '2026-11-12'
const f = (v: string | number) => ({ value: v, quote: String(v) })
const stub = (over: IncomeDoc['fields'] = {}): IncomeDoc => ({
  documentId: 's',
  fileName: 's.pdf',
  kind: 'paystub',
  fields: { employer_name: f('Excel Inc'), pay_date: f('2026-10-31'), pay_frequency: f('biweekly'), base_pay_current: f(2000), ytd_gross: f(45000), ...over },
})
const w2 = (year: number, wages: number, over: IncomeDoc['fields'] = {}): IncomeDoc => ({ documentId: `w${year}`, fileName: `${year}.pdf`, kind: 'w2', fields: { employer_name: f('EXCEL'), tax_year: f(year), w2_wages: f(wages), ...over } })
const job = { employerName: 'Excel', startDate: '2023-01-01' }

describe('documents that disagree', () => {
  it('everything lines up: no warnings', () => {
    // Pace 45,000 / 10 × 12 = 54,000; base 2,000 × 26 = 52,000; W-2s 52,000 and 50,000.
    expect(reconcileJob({ docs: [stub(), w2(2025, 52000), w2(2024, 50000)], job, today })).toEqual([])
  })
  it('a pace well below last year’s W-2', () => {
    expect(reconcileJob({ docs: [stub(), w2(2025, 70000), w2(2024, 68000)], job, today })).toEqual([
      "This year's pace $54,000 (YTD $45,000 over 10 months) is 23% below the 2025 W-2 $70,000: income may be falling; the underwriter will ask why.",
    ])
  })
  it('a raise: the stated base 20%+ above the W-2', () => {
    const w = reconcileJob({ docs: [stub({ base_pay_current: f(2600), ytd_gross: f(40000) }), w2(2025, 50000), w2(2024, 49000)], job, today })
    expect(w).toEqual(['The stated base, $67,600 a year, is 35% above the 2025 W-2 $50,000: likely a raise or a new pay rate. Get a WVOE or the offer letter.'])
  })
  it('another employer, an old stub, a missing W-2 year, box 1 well below box 5', () => {
    const w = reconcileJob({ docs: [stub({ employer_name: f('Truco Services'), pay_date: f('2026-09-15'), ytd_gross: f(39000) }), w2(2025, 52000, { w2_medicare_wages: f(62000) })], job, today })
    expect(w).toEqual([
      "The pay stub's employer (Truco Services) doesn't match the W-2's (EXCEL).",
      'The latest pay stub is 58 days old (paid 2026-09-15): get one from the last 30 days.',
      'Excel started before 2025, but only the 2025 W-2 has been analyzed: add the other year’s W-2.'.replace('’', "'"),
      '2025 W-2 box 1 $52,000 is 16% below box 5 $62,000: large pre-tax deductions; look before using box 1.',
    ])
  })
  it('a new job (started this year) with one W-2 or none is fine', () => {
    expect(reconcileJob({ docs: [stub()], job: { employerName: 'Excel', startDate: '2026-02-01' }, today })).toEqual([])
  })
})
