import { describe, expect, it } from 'vitest'
import { incomeAnalysisView } from './incomeAnalysis'

describe('Income Analysis PDF contents', () => {
  const view = incomeAnalysisView({
    borrowerName: 'Pat TEST',
    label: 'Salary · Excel',
    typeLabel: 'Salary',
    where: 'Excel',
    lines: [
      { label: 'Pay per period', amount: 2000 },
      { label: 'Less 50% expense factor', amount: -500, kind: 'subtract' },
      { label: 'Annual', amount: 52000, kind: 'subtotal' },
      { label: 'Qualifying monthly', amount: 4333.33, kind: 'result' },
    ],
    monthly: 4333.33,
    warnings: [],
    notes: ['From the pay stub dated Oct 31, 2026'],
    sources: ['oct-stub.pdf'],
    draft: true,
    pushedOn: null,
    preparedOn: '2026-11-12',
  })
  it('facts, with the draft status spelled out', () => {
    expect(view.facts).toEqual([
      { label: 'Income', value: 'Salary' },
      { label: 'Employer / business', value: 'Excel' },
      { label: 'Qualifying monthly', value: '$4,333.33' },
      { label: 'Annual', value: '$52,000' },
      { label: 'Status', value: 'Draft, not yet on the 1003' },
    ])
  })
  it('lines keep their sign and weight', () => {
    expect(view.lines.map((l) => [l.amount, l.negative, l.kind])).toEqual([
      [2000, false, 'row'],
      [500, true, 'row'],
      [52000, false, 'sub'],
      [4333.33, false, 'total'],
    ])
  })
  it('a safe file name', () => {
    expect(view.fileName).toBe('Income Analysis - Pat TEST - Salary · Excel.pdf')
  })
  it('v2: sources table with quotes cut to about 60 characters, changes, reviewed by', () => {
    const v = incomeAnalysisView({
      borrowerName: 'Pat TEST', label: 'Salary · Excel', typeLabel: 'Salary', where: 'Excel', lines: [], monthly: 4000, warnings: [], notes: [], sources: [], draft: false, pushedOn: null, preparedOn: '2026-11-13',
      figureSources: [{ figure: 'Pay amount', document: 'oct-stub.pdf', page: 1, quote: 'Regular Pay 80.00 30.00 2,400.00 and a lot more words that run long' }],
      changes: [{ figure: 'Pay amount', aiValue: '$2,400.00', newValue: '$2,450.00' }],
      reviewed: { name: 'Connor Jacquart', on: '2026-11-13' },
    })
    expect(v.figureSources[0]).toEqual({ figure: 'Pay amount', document: 'oct-stub.pdf', page: '1', quote: 'Regular Pay 80.00 30.00 2,400.00 and a lot more words that…' })
    expect(v.showQuotes).toBe(true)
    expect(v.changes).toEqual(['Pay amount: AI read $2,400.00 → $2,450.00'])
    expect(v.reviewed).toBe('Reviewed by Connor Jacquart on Nov 13, 2026')
  })
})
