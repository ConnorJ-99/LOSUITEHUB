import { describe, expect, it } from 'vitest'
import { aiEdits, inputAt } from './edits'
import type { InputSources } from './fromDocuments'

const sources: InputSources = {
  amount: { documentId: 'd', field: 'base_pay_current', value: 2400, quote: 'Regular 2,400.00', page: 1 },
  frequency: { documentId: 'd', field: 'pay_frequency', value: 'biweekly', quote: 'Bi-Weekly' },
  'recent.netProfit': { documentId: 'r', field: 'sch_c_net_profit', value: 80000, quote: 'Line 31 80,000' },
}

describe('changes to AI figures', () => {
  it('a changed figure is one edit with the AI value and quote', () => {
    expect(aiEdits(sources, { amount: 2400, frequency: 'biweekly' }, { amount: 2450, frequency: 'biweekly' })).toEqual([{ input: 'amount', aiValue: 2400, aiQuote: 'Regular 2,400.00', newValue: 2450 }])
  })
  it('saving again without a change logs nothing; changing back to the AI value logs nothing', () => {
    expect(aiEdits(sources, { amount: 2450 }, { amount: 2450 })).toEqual([])
    expect(aiEdits(sources, { amount: 2450 }, { amount: 2400 })).toEqual([])
  })
  it('a second change after an earlier one is logged again', () => {
    expect(aiEdits(sources, { amount: 2450 }, { amount: 2500 })).toEqual([{ input: 'amount', aiValue: 2400, aiQuote: 'Regular 2,400.00', newValue: 2500 }])
  })
  it('nested inputs and clearing a figure; text inputs are not logged', () => {
    expect(aiEdits(sources, { recent: { netProfit: 80000 }, frequency: 'biweekly' }, { recent: { netProfit: null }, frequency: 'monthly' })).toEqual([{ input: 'recent.netProfit', aiValue: 80000, aiQuote: 'Line 31 80,000', newValue: null }])
    expect(inputAt({ recent: { netProfit: 5 } }, 'recent.netProfit')).toBe(5)
    expect(inputAt({ recent: null }, 'recent.netProfit')).toBeUndefined()
  })
  it('a worksheet typed by hand has no sources, so nothing is logged', () => {
    expect(aiEdits({}, { amount: 1 }, { amount: 2 })).toEqual([])
  })
})
