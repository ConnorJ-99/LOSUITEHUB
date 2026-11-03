import { describe, expect, it } from 'vitest'
import type { FeeTemplate } from '@/lib/calc'
import { prequalFeeEstimate, selectedClosingCosts } from './prequal'

describe('prequal closing costs', () => {
  const none = { pricingScenarioId: null, estimatedClosingCosts: null, prepaidItemsAmount: null, discountPointsAmount: null, lenderCredits: null }

  it('uses the Selected estimate’s full closing costs', () => {
    expect(selectedClosingCosts({ pricingScenarioId: 'e1', estimatedClosingCosts: 4_000, prepaidItemsAmount: 5_000, discountPointsAmount: 600, lenderCredits: 500 })).toBe(9_100)
  })

  it('keeps a figure already on a loan with no estimate, and is null with nothing', () => {
    expect(selectedClosingCosts({ ...none, estimatedClosingCosts: 9_000 })).toBe(9_000)
    expect(selectedClosingCosts(none)).toBeNull()
  })

  it('estimates with Smart Fees before any estimate exists', () => {
    const fee: FeeTemplate = { key: 'appraisal', section: 'B', name: 'Appraisal', amountType: 'fixed', amount: 650, purposes: null, mortgageTypes: null, paidBy: 'B', apr: false, paidTo: null, sortOrder: 1, active: true }
    expect(prequalFeeEstimate({ id: 'l', purpose: 'purchase', details: {} as never }, [])).toBeUndefined()
    const est = prequalFeeEstimate({ id: 'l', purpose: 'purchase', details: { mortgageType: 'conventional', termMonths: 360, noteRate: 6.5, estimatedTaxRatePct: 2.2, estimatedAnnualInsurance: 3_600 } as never }, [fee])!
    // Appraisal + a year of insurance + 3 months of insurance and taxes in escrow, at least.
    expect(est(400_000, 380_000, {})).toBeGreaterThan(650 + 3_600)
  })
})
