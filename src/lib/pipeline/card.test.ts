import { describe, expect, it } from 'vitest'
import { amountLine, daysInStage, matchesQuick, matchesSearch, sortCards, stepInfo, timelineLine, type CardFile } from './card'
import { leadTypeFor, LEAD_TYPES } from './leadType'

const now = new Date('2026-11-13T18:00:00Z')
const today = '2026-11-13'
const base: CardFile = {
  id: 'a', purpose: 'purchase', stage: 'lead', stageChangedAt: '2026-11-01T18:00:00Z', createdAt: '2026-10-03T18:00:00Z', currentStep: 1, priority: false, onHoldAt: null, occupancy: 'primary',
  loanAmount: null, purchasePrice: null, homeValue: null, maxPrice: null, timeline: null, contractDate: null, closingDate: null, preapprovalExpiresOn: null,
  leadType: null, programFamily: null, mortgageType: null, incomeDocType: null,
}

describe('lead type', () => {
  it("Connor's pick wins; else from HELOC, DSCR, bank statement, Non-QM, jumbo, FHA/VA/USDA; else CONV", () => {
    expect(leadTypeFor({ ...base, leadType: 'va', purpose: 'heloc' })).toBe('va')
    expect(leadTypeFor({ ...base, purpose: 'heloan' })).toBe('heloc')
    expect(leadTypeFor({ ...base, incomeDocType: 'dscr' })).toBe('dscr')
    expect(leadTypeFor({ ...base, incomeDocType: 'bank_statement' })).toBe('bank_stmt')
    expect(leadTypeFor({ ...base, programFamily: 'non_qm' })).toBe('nonqm_other')
    expect(leadTypeFor({ ...base, programFamily: 'jumbo' })).toBe('jumbo')
    expect(leadTypeFor({ ...base, mortgageType: 'usda_rural' })).toBe('usda')
    expect(leadTypeFor({ ...base, mortgageType: 'fha' })).toBe('fha')
    expect(leadTypeFor(base)).toBe('conv')
    expect(leadTypeFor({ ...base, leadType: 'nonsense' })).toBe('conv')
  })
  it('nine types, each with a color', () => {
    expect(LEAD_TYPES.map((t) => `${t.label} ${t.color}`)).toEqual(['CONV #1d5fc4', 'FHA #0f766e', 'VA #6d28d9', 'USDA #4d7c0f', 'JUMBO #334155', 'DSCR #c2410c', 'BANK STMT #be185d', 'NON-QM OTHER #a16207', 'HELOC #15803d'])
  })
})

describe('the card', () => {
  it('step X of Y with its name; a step past the end shows the last', () => {
    expect(stepInfo({ ...base, stage: 'contacted', currentStep: 2 })).toEqual({ n: 2, total: 3, name: 'Discovery call' })
    expect(stepInfo({ ...base, stage: 'under_contract', currentStep: 9 })).toEqual({ n: 4, total: 4, name: 'Submitted to lender' })
    expect(stepInfo({ ...base, stage: 'nurture' })).toBeNull()
  })
  it('days in stage', () => {
    expect(daysInStage('2026-11-01T18:00:00Z', now)).toBe(12)
  })
  it('amount: est. early, Max when pre-approved, amount and LTV under contract', () => {
    expect(amountLine({ ...base, purchasePrice: 400000 })).toBe('$400K est.')
    expect(amountLine({ ...base, stage: 'pre_approved', maxPrice: 450000, purchasePrice: 400000 })).toBe('Max $450K')
    expect(amountLine({ ...base, stage: 'under_contract', loanAmount: 380000, purchasePrice: 400000, homeValue: 410000 })).toBe('$380K · 95% LTV')
    expect(amountLine(base)).toBeNull()
  })
  it('timeline: lead and target, approved and expiry, contract and close', () => {
    expect(timelineLine({ ...base, timeline: '1–3 months' })).toBe('Lead Oct 3 · target 1–3 months')
    expect(timelineLine({ ...base, stage: 'pre_approved', stageChangedAt: '2026-10-20T18:00:00Z', preapprovalExpiresOn: '2027-01-18' })).toBe('Approved Oct 20 · exp Jan 18')
    expect(timelineLine({ ...base, stage: 'processing', contractDate: '2026-10-28', closingDate: '2026-11-30' })).toBe('Contract Oct 28 · close Nov 30')
    expect(timelineLine({ ...base, stage: 'processing' })).toBeNull()
  })
  it('priority first, then the longest in stage', () => {
    const files = [
      { id: 'new', priority: false, stageChangedAt: '2026-11-10T00:00:00Z' },
      { id: 'old', priority: false, stageChangedAt: '2026-10-01T00:00:00Z' },
      { id: 'star', priority: true, stageChangedAt: '2026-11-12T00:00:00Z' },
    ]
    expect(sortCards(files).map((f) => f.id)).toEqual(['star', 'old', 'new'])
  })
  it('quick filters and search', () => {
    expect(matchesQuick({ ...base, stageChangedAt: '2026-10-20T00:00:00Z' }, 'stuck', now, today)).toBe(true)
    expect(matchesQuick(base, 'stuck', now, today)).toBe(false)
    expect(matchesQuick({ ...base, closingDate: '2026-11-30' }, 'closing_month', now, today)).toBe(true)
    expect(matchesQuick({ ...base, preapprovalExpiresOn: '2026-11-20' }, 'expiring', now, today)).toBe(true)
    expect(matchesQuick({ ...base, preapprovalExpiresOn: '2026-12-20' }, 'expiring', now, today)).toBe(false)
    expect(matchesSearch('pine  valley', ['Pat TEST', '2142 Pine Valley Dr', null])).toBe(true)
    expect(matchesSearch('ARV-1', ['Pat', null, 'arv-12345'])).toBe(true)
    expect(matchesSearch('zzz', ['Pat'])).toBe(false)
  })
})

describe('totals', () => {
  it('count, volume, closing this month, average days in stage', async () => {
    const { boardStats } = await import('./card')
    const files = [
      { ...base, loanAmount: 300000, closingDate: '2026-11-20', stageChangedAt: '2026-11-03T18:00:00Z' },
      { ...base, purchasePrice: 200000, stageChangedAt: '2026-11-11T18:00:00Z' },
    ]
    expect(boardStats(files, now, today)).toEqual({ count: 2, volume: 500000, closingThisMonth: 1, avgDays: 6 })
    expect(boardStats([], now, today).avgDays).toBeNull()
  })
})
