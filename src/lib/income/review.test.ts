import { describe, expect, it } from 'vitest'
import type { InputSources } from './fromDocuments'
import { checkProgress, figureLabel, figures, withChecked } from './review'

const sources: InputSources = {
  amount: { documentId: 'd', field: 'base_pay_current', value: 2400, quote: 'Regular 2,400.00', page: 1 },
  frequency: { documentId: 'd', field: 'pay_frequency', value: 'biweekly', quote: 'Bi-Weekly' },
  'recent.netProfit': { documentId: 'r', field: 'sch_c_net_profit', value: 80000, quote: 'Line 31', checkedBy: 'me', checkedAt: '2026-11-13T15:00:00Z' },
}

describe('checking a draft’s figures', () => {
  it('a changed figure counts as checked; a ticked one is checked', () => {
    const list = figures(sources, { amount: 2450, frequency: 'biweekly', recent: { netProfit: 80000 } })
    expect(list.map((f) => [f.path, f.changed, f.checked])).toEqual([
      ['amount', true, true],
      ['frequency', false, false],
      ['recent.netProfit', false, true],
    ])
    expect(checkProgress(list)).toEqual({ done: 2, total: 3, ready: false })
  })
  it('ticking and unticking', () => {
    const ticked = withChecked(sources, 'frequency', true, 'me', '2026-11-13T16:00:00Z')
    expect(ticked.frequency).toMatchObject({ checkedBy: 'me', checkedAt: '2026-11-13T16:00:00Z' })
    expect(checkProgress(figures(ticked, { amount: 2450, frequency: 'biweekly', recent: { netProfit: 80000 } })).ready).toBe(true)
    expect(withChecked(ticked, 'frequency', false, 'me', 'x').frequency).not.toHaveProperty('checkedAt')
    expect(withChecked(sources, 'nope', true, 'me', 'x')).toBe(sources)
  })
  it('labels, with the tax year', () => {
    expect(figureLabel('amount')).toBe('Pay amount')
    expect(figureLabel('recent.netProfit', 2025)).toBe('Net profit (line 31), 2025')
    expect(figureLabel('older.netProfit', 2025)).toBe('Net profit (line 31), 2024')
  })
  it('no figures from documents = ready (worksheets typed by hand)', () => {
    expect(checkProgress(figures({}, {}))).toEqual({ done: 0, total: 0, ready: true })
  })
})
