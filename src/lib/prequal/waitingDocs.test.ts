import { describe, expect, it } from 'vitest'
import { nextStep } from './nextStep'
import { readiness, type ReadinessInput } from './readiness'

const ready: ReadinessInput = {
  today: '2026-10-26',
  isPurchase: true,
  mortgageType: 'conventional',
  incomeDocType: null,
  creditScore: 700,
  backDtiPct: 38,
  maxDtiPct: 45,
  totalIncome: 9000,
  ltvTooHigh: false,
  cashNeeded: 30000,
  funds: 45000,
  saleProceeds: 0,
  jobs: [{ employerName: 'Sample Co', borrowerName: 'Jane', selfEmployed: false, startDate: '2019-01-01', hasIncome: true, hasWorksheet: true }],
  creditEvents: [],
  creditPulled: true,
  hasAssets: true,
}

describe('documents still waiting', () => {
  it('lists requested documents that have not come in', () => {
    const r = readiness({ ...ready, outstandingDocs: ['pay stubs (Jane)', 'W-2s (Jane)'] })
    expect(r.level).toBe('needs_documents')
    expect(r.reasons).toEqual([{ level: 'needs_documents', text: 'Still waiting on: pay stubs (Jane), W-2s (Jane).', missing: 'documents' }])
    expect(nextStep(r, 'pre_qualified')).toMatchObject({ action: 'request_documents', title: 'Follow up on documents' })
  })
  it('shortens a long list', () => {
    const r = readiness({ ...ready, outstandingDocs: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] })
    expect(r.reasons[0].text).toBe('Still waiting on: a, b, c, d, e, f and 2 more.')
  })
  it('other missing items still come first in the next step', () => {
    const r = readiness({ ...ready, creditPulled: false, outstandingDocs: ['pay stubs'] })
    expect(nextStep(r, 'lead')?.title).toBe('Pull credit')
  })
  it('nothing waiting: still ready', () => {
    expect(readiness({ ...ready, outstandingDocs: [] }).level).toBe('ready')
  })
})
