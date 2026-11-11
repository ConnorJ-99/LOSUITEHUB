import { describe, expect, it } from 'vitest'
import { borrowerIntro, milestoneForStage, milestoneForStep, milestoneUpdate, partnerIntro } from './updates'

describe('intro texts', () => {
  it('borrower: work number, and the personal cell when there is one', () => {
    expect(borrowerIntro({ borrowerFirst: 'Pat', loName: 'Connor Jacquart', personalCell: '2145550101' })).toBe(
      "Hi Pat, this is Connor with MPS Mortgage. This is my work number. I'll send your loan updates from here, but for anything else my personal cell is (214) 555-0101.",
    )
    expect(borrowerIntro({ borrowerFirst: 'Pat', loName: 'Connor', personalCell: null })).toBe("Hi Pat, this is Connor with MPS Mortgage. This is my work number. I'll send your loan updates from here.")
  })
  it('partner: names the borrower and the address', () => {
    expect(partnerIntro({ partnerName: 'Amy Lee', loName: 'Connor Jacquart', borrowerFirst: 'Pat', address: '123 Main St', personalCell: '+1 214 555 0101' })).toBe(
      "Hi Amy, this is Connor with MPS Mortgage, working with Pat on 123 Main St. I'll send loan updates from this number; my personal cell is (214) 555-0101 anytime.",
    )
    expect(partnerIntro({ partnerName: 'Amy', loName: 'Connor', borrowerFirst: null, address: null, personalCell: null })).toBe("Hi Amy, this is Connor with MPS Mortgage. I'll send loan updates from this number.")
  })
})

describe('milestones', () => {
  it('from a stage', () => {
    expect(milestoneForStage('clear_to_close')).toBe('clear_to_close')
    expect(milestoneForStage('processing')).toBe('submitted')
    expect(milestoneForStage('contacted')).toBeNull()
  })
  it('from a step or task name', () => {
    expect(milestoneForStep('Order appraisal')).toBe('appraisal_ordered')
    expect(milestoneForStep('Appraisal received')).toBe('appraisal_received')
    expect(milestoneForStep('Clear to close')).toBe('clear_to_close')
    expect(milestoneForStep('Conditional approval')).toBe('approved')
    expect(milestoneForStep('Pre-approval letter')).toBeNull()
    expect(milestoneForStep('Pull credit')).toBeNull()
  })
})

describe('update texts', () => {
  const f = { loName: 'Connor', borrowerFirst: 'Pat', address: '123 Main St', closingDate: '2026-12-05' }
  it('to the borrower, about their loan', () => {
    expect(milestoneUpdate('clear_to_close', { kind: 'borrower', name: 'Pat' }, f)).toBe('Hi Pat, great news: your loan is clear to close, on track for Dec 5, 2026. - Connor, MPS Mortgage')
  })
  it("to a realtor, about the borrower's loan on the address", () => {
    expect(milestoneUpdate('appraisal_ordered', { kind: 'partner', name: 'Amy Lee' }, f)).toBe("Hi Amy, quick update: the appraisal has been ordered for Pat's loan on 123 Main St. - Connor, MPS Mortgage")
  })
  it('never carries figures', () => {
    for (const m of ['appraisal_ordered', 'appraisal_received', 'submitted', 'approved', 'clear_to_close', 'closing_date_changed', 'closed'] as const) {
      expect(milestoneUpdate(m, { kind: 'partner', name: 'Amy' }, f)).not.toMatch(/\$|%|rate|credit|income/i)
    }
  })
})
