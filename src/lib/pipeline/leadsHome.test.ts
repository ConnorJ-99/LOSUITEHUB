import { describe, expect, it } from 'vitest'
import { pipelineTiles, priorityLeads } from './leadsHome'
import type { LoanPurpose, PipelineStage } from './stages'

const now = new Date('2026-10-27T17:00:00Z')
const ago = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000 - 60_000).toISOString()
const file = (id: string, purpose: LoanPurpose, stage: PipelineStage, over: { days?: number; priority?: boolean; loanAmount?: number | null; purchasePrice?: number | null } = {}) => ({
  id,
  purpose,
  stage,
  stageChangedAt: ago(over.days ?? 1),
  priority: over.priority ?? false,
  loanAmount: over.loanAmount ?? null,
  purchasePrice: over.purchasePrice ?? null,
})

describe('Priority Leads', () => {
  it('starred files still being worked, most recently moved first, with their pipeline', () => {
    const files = [
      file('a', 'purchase', 'home_search', { priority: true, days: 5 }),
      file('b', 'refinance_cash_out', 'contacted', { priority: true, days: 1 }),
      file('c', 'purchase', 'contacted'),
      file('d', 'heloc', 'lost', { priority: true }),
      file('e', 'purchase', 'closed', { priority: true }),
      file('f', 'investment_dscr', 'nurture', { priority: true, days: 10 }),
    ]
    expect(priorityLeads(files, now).map((x) => [x.file.id, x.pipeline])).toEqual([
      ['b', 'refinance'],
      ['a', 'purchase'],
      ['f', 'nurture'],
    ])
  })
})

describe('pipeline tiles', () => {
  it('count and dollar total for every pipeline, in order', () => {
    const tiles = pipelineTiles(
      [
        file('a', 'purchase', 'lead', { loanAmount: 300000 }),
        file('b', 'purchase', 'pre_qualified', { purchasePrice: 400000 }),
        file('c', 'purchase', 'home_search', { loanAmount: 380000, purchasePrice: 400000 }),
        file('d', 'refinance_rate_term', 'processing', { loanAmount: 250000 }),
        file('e', 'heloan', 'lost', { days: 9, loanAmount: 50000 }),
        file('f', 'purchase', 'closed', { days: 45, loanAmount: 999999 }),
      ],
      now,
    )
    expect(tiles).toEqual([
      { id: 'new_leads', count: 1, total: 300000 },
      { id: 'purchase', count: 2, total: 780000 },
      { id: 'refinance', count: 0, total: 0 },
      { id: 'investment', count: 0, total: 0 },
      { id: 'heloc', count: 0, total: 0 },
      { id: 'in_process', count: 1, total: 250000 },
      { id: 'nurture', count: 0, total: 0 },
      { id: 'lost', count: 1, total: 50000 },
    ])
  })
})
