import { describe, expect, it } from 'vitest'
import { concessionLimit } from '@/lib/calc'
import { contractFlags, daysBetween, type ContractFacts } from './flags'

describe('concessionLimit', () => {
  it('conventional depends on LTV, using the lower of price and value', () => {
    expect(concessionLimit('conventional', 'primary', 400_000, null, 380_000)).toEqual({ maxPct: 3, basis: 400_000, maxAmount: 12_000, approximate: false })
    expect(concessionLimit('conventional', 'primary', 400_000, null, 360_000)?.maxPct).toBe(6) // 90% exactly
    expect(concessionLimit('conventional', 'primary', 400_000, null, 300_000)?.maxPct).toBe(9) // 75% exactly
    expect(concessionLimit('conventional', 'primary', 400_000, 390_000, 300_000)).toEqual({ maxPct: 6, basis: 390_000, maxAmount: 23_400, approximate: false }) // 76.9%
    expect(concessionLimit(null, 'primary', 400_000, null, null)?.maxPct).toBe(3)
  })
  it('investment homes are 2%', () => {
    expect(concessionLimit('conventional', 'investment', 400_000, null, 300_000)?.maxAmount).toBe(8_000)
  })
  it('FHA 6% of price, VA 4% of value, USDA 6%', () => {
    expect(concessionLimit('fha', 'primary', 350_000, 340_000, 337_750)).toEqual({ maxPct: 6, basis: 350_000, maxAmount: 21_000, approximate: false })
    expect(concessionLimit('va', 'primary', 350_000, 340_000, 350_000)).toEqual({ maxPct: 4, basis: 340_000, maxAmount: 13_600, approximate: true })
    expect(concessionLimit('usda_rural', 'primary', 250_000, null, 250_000)?.maxAmount).toBe(15_000)
  })
  it('needs a price', () => {
    expect(concessionLimit('fha', 'primary', null, 300_000, 290_000)).toBeNull()
  })
})

const base: ContractFacts = {
  mortgageType: 'conventional',
  occupancy: 'primary',
  purchasePrice: 400_000,
  loanAmount: 380_000,
  contractFinancingAmount: 380_000,
  sellerCredits: 8_000,
  propertyValue: null,
  contractDate: '2026-11-01',
  optionEndDate: '2026-11-08',
  financingDeadline: '2026-11-21',
  surveyDeadline: '2026-11-11',
  closingDate: '2026-12-05',
  dti: 41.2,
}

describe('contractFlags', () => {
  it('finds nothing on a clean contract', () => {
    expect(contractFlags(base)).toEqual([])
  })
  it('says nothing about values that are not filled in', () => {
    const empty = Object.fromEntries(Object.keys(base).map((k) => [k, null])) as unknown as ContractFacts
    expect(contractFlags({ ...empty, occupancy: 'primary' })).toEqual([])
  })
  it('flags a financing amount that differs from the loan amount', () => {
    const [f] = contractFlags({ ...base, contractFinancingAmount: 375_000 })
    expect(f.key).toBe('financing_amount')
    expect(f.detail).toBe("The financing addendum says $375,000; the file's loan amount is $380,000.")
  })
  it('flags concessions over the limit (red), or VA as a check (amber)', () => {
    const [f] = contractFlags({ ...base, sellerCredits: 12_500 })
    expect(f).toMatchObject({ key: 'concessions', tone: 'red' })
    expect(f.detail).toContain("$12,500 is over conventional's 3% limit ($12,000)")
    expect(contractFlags({ ...base, sellerCredits: 12_000 })).toEqual([])
    expect(contractFlags({ ...base, mortgageType: 'va', loanAmount: 400_000, contractFinancingAmount: 400_000, sellerCredits: 17_000, dti: 45 })[0]).toMatchObject({ key: 'concessions', tone: 'amber' })
  })
  it('flags DTI over the loan type max', () => {
    expect(contractFlags({ ...base, dti: 45.04 })[0]).toMatchObject({ key: 'dti', detail: 'DTI is 45.04%, over the 45% conventional max.' })
    expect(contractFlags({ ...base, dti: 47.25 })[0].detail).toBe('DTI is 47.25%, over the 45% conventional max.')
    expect(contractFlags({ ...base, mortgageType: 'fha', dti: 47.25, sellerCredits: 0 })).toEqual([])
  })
  it('flags a closing date tighter than the normal turn time', () => {
    expect(daysBetween('2026-11-01', '2026-11-20')).toBe(19)
    const flags = contractFlags({ ...base, closingDate: '2026-11-20', financingDeadline: null })
    expect(flags).toEqual([{ key: 'tight_closing', tone: 'amber', title: 'Tight closing date', detail: 'Closing is 19 days after the effective date; a normal turn time is 21 days or more.' }])
    expect(contractFlags({ ...base, closingDate: '2026-11-22', financingDeadline: null })).toEqual([])
  })
  it('flags dates in the wrong order, red before amber', () => {
    const flags = contractFlags({ ...base, closingDate: '2026-10-30', optionEndDate: '2026-10-28' })
    expect(flags.map((f) => f.key)).toEqual(['closing_before_contract', 'option_before_contract', 'financing_after_closing', 'survey_after_closing'])
    expect(flags[2].detail).toBe('Financing deadline is Nov 21, 2026; closing is Oct 30, 2026.')
  })
})
