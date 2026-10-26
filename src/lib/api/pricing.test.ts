import { describe, expect, it } from 'vitest'
import { feeKeyFrom, scenarioRow } from './pricing'

describe('pricing data', () => {
  it('every scenario field has a column in the database', () => {
    const scripts = import.meta.glob<string>('/supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true })
    const sql = Object.values(scripts).join('\n')
    const table = /create table if not exists public\.pricing_scenarios \(([\s\S]*?)\n\);/.exec(sql)![1]
    const columns = new Set([...table.matchAll(/^\s{2}([a-z_]+)\s/gm)].map((m) => m[1]))
    const all = scenarioRow(Object.fromEntries(
      ['loanId', 'propertyId', 'name', 'lenderName', 'programName', 'mortgageType', 'amortizationType', 'interestOnly', 'termMonths', 'noteRate', 'qualifyingRate', 'buydown', 'lockDays', 'loanAmount', 'purchasePrice', 'propertyValue', 'taxesValue', 'taxesFactor', 'insuranceValue', 'insuranceFactor', 'supplementalInsuranceMonthly', 'monthlyHoa', 'monthlyMi', 'otherPaymentMonthly', 'otherPaymentLabel', 'impoundWaiver', 'estimatedFundingDate', 'firstPaymentDate', 'pointsPct', 'lenderCredit', 'prepaidInterestDays', 'hoiPrepaidMonths', 'taxPrepaidMonths', 'hoiReserveMonths', 'taxReserveMonths', 'miReserveMonths', 'aggregateAdjustment', 'notes'].map((k) => [k, null]),
    ))
    for (const column of Object.keys(all)) expect(columns, column).toContain(column)
  })
  it('fee keys come from the name', () => {
    expect(feeKeyFrom("Title - Lender's Policy")).toBe('title_lender_s_policy')
    expect(feeKeyFrom('  ')).toBe('fee')
  })
})
