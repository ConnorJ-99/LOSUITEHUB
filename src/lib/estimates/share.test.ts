import { describe, expect, it } from 'vitest'
import type { FeeWorksheet } from '@/lib/documents/feeWorksheet'
import type { ScenarioFigures } from '@/lib/pricing/scenario'
import { fillLink, shareExpiry, shareMessage, shareSnapshot, shareStatus, shareUrl, type ShareSource } from './share'

const worksheet: FeeWorksheet = {
  number: 'W-1',
  preparedAt: '2026-11-11T15:00:00Z',
  borrowers: 'Pat TEST',
  facts: [],
  loanCosts: [
    { letter: 'A', title: 'Origination charges', total: 1200, rows: [{ label: 'Underwriting', note: null, amount: 1200 }] },
    { letter: 'B', title: "Services you can't shop for", total: 650, rows: [{ label: 'Appraisal', note: null, amount: 650 }, { label: 'Survey', note: 'paid by seller', amount: 450 }] },
    { letter: 'C', title: 'Services you can shop for', total: 0, rows: [] },
  ],
  otherCosts: [],
  totals: { D: 1850, I: 0, J: 1850, lenderCredits: 0 },
  payment: { lines: [{ label: 'Principal and interest', amount: 2100 }, { label: 'Property taxes', amount: 600 }], total: 2700 },
  cash: { title: 'Estimated cash to close', lines: [{ label: 'Purchase price', amount: 400000 }, { label: 'Loan amount', amount: 386000, negative: true }], total: 15850 },
}
const figures = { totalLoanAmount: 392755, payment: { principalAndInterest: 2100 } } as unknown as ScenarioFigures
const source = (id: string): ShareSource => ({ estimateId: id, program: 'FHA 30-year fixed', ratePct: 6.25, pointsPct: 0.5, lenderCredit: 0, loanAmount: 386000, purchasePrice: 400000, worksheet, figures, pdfDocumentId: 'doc-1' })

describe('the frozen copy', () => {
  it('names options in order and never the lender', () => {
    const s = shareSnapshot([source('a'), source('b')], '2026-11-11T15:00:00Z')
    expect(s.options.map((o) => o.name)).toEqual(['Option 1', 'Option 2'])
    expect(JSON.stringify(s)).not.toMatch(/lender(Name|Id)/)
  })
  it('matches the PDF: payment, cash and sections the borrower pays', () => {
    const o = shareSnapshot([source('a')], '2026-11-11T15:00:00Z').options[0]
    expect(o.payment.total).toBe(2700)
    expect(o.cash.lines[1]).toEqual({ label: 'Loan amount', amount: 386000, minus: true })
    expect(o.sections.map((x) => x.letter)).toEqual(['A', 'B'])
    expect(o.sections[1].rows).toEqual([{ label: 'Appraisal', amount: 650 }])
    expect(o.loanAmount).toBe(392755)
    expect(o.downPayment).toBe(14000)
    expect(o.aprPct).toBeNull()
  })
  it('takes 1 to 5', () => {
    expect(() => shareSnapshot([], 'x')).toThrow()
    expect(() => shareSnapshot(['a', 'b', 'c', 'd', 'e', 'f'].map(source), 'x')).toThrow()
  })
})

describe('the link and message', () => {
  it('builds the link', () => {
    expect(shareUrl('https://app.mps.mortgage/', 'abc')).toBe('https://app.mps.mortgage/e/abc')
  })
  it('puts the link where {link} is, or at the end', () => {
    const m = shareMessage('Pat', 'Connor', 2)
    expect(fillLink(m, 'URL')).toBe("Hi Pat, here are the loan options we went over: URL You'll confirm your email to open them. Rates are as of today and can change. - Connor")
    expect(fillLink('See these', 'URL')).toBe('See these URL')
  })
  it('expiry stays between 1 and 60 days', () => {
    const now = new Date('2026-11-11T00:00:00Z')
    expect(shareExpiry(7, now)).toBe('2026-11-18T00:00:00.000Z')
    expect(shareExpiry(200, now)).toBe('2027-01-10T00:00:00.000Z')
    expect(shareExpiry(0, now)).toBe('2026-11-18T00:00:00.000Z')
  })
  it('status', () => {
    const now = new Date('2026-11-11T00:00:00Z')
    const base = { revokedAt: null, expiresAt: '2026-11-18T00:00:00Z', pickedEstimateId: null, firstOpenedAt: null }
    expect(shareStatus(base, now)).toBe('not_opened')
    expect(shareStatus({ ...base, firstOpenedAt: '2026-11-11' }, now)).toBe('opened')
    expect(shareStatus({ ...base, pickedEstimateId: 'a' }, now)).toBe('picked')
    expect(shareStatus({ ...base, expiresAt: '2026-11-10T00:00:00Z' }, now)).toBe('expired')
    expect(shareStatus({ ...base, revokedAt: '2026-11-10' }, now)).toBe('revoked')
  })
})
