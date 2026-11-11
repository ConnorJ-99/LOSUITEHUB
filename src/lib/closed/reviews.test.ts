import { describe, expect, it } from 'vitest'
import { DEFAULT_REVIEW_EMAIL, DEFAULT_REVIEW_TEXT, fillReview, firstRequest, followUpRequest, reviewLink, reviewWordingProblem, type ReviewLoan, type ReviewSettings } from './reviews'

const s: ReviewSettings = { enabled: true, companyLink: 'https://g.page/r/mps', secondLink: null, daysAfterFunding: 3, followUp: true, followUpDays: 7, draftsFrom: '2026-11-01' }
const loan = (o: Partial<ReviewLoan> = {}): ReviewLoan => ({ fundingDate: '2026-11-06', closingDate: '2026-11-06', status: 'not_requested', skip: false, requestedAt: null, smsOk: true, emailOk: true, lastAskedElsewhereAt: null, ...o })

describe('first request', () => {
  it('drafts on funding + 3 days, by text when they agreed to texts', () => {
    expect(firstRequest(loan(), s, '2026-11-08')).toMatchObject({ draft: false })
    expect(firstRequest(loan(), s, '2026-11-09')).toEqual({ draft: true, channel: 'text' })
  })
  it('falls back to the closing date when there is no funding date', () => {
    expect(firstRequest(loan({ fundingDate: null, closingDate: '2026-11-02' }), s, '2026-11-05')).toEqual({ draft: true, channel: 'text' })
  })
  it('email when only email consent; nothing without consent', () => {
    expect(firstRequest(loan({ smsOk: false }), s, '2026-11-10')).toEqual({ draft: true, channel: 'email' })
    expect(firstRequest(loan({ smsOk: false, emailOk: false }), s, '2026-11-10')).toMatchObject({ draft: false, why: 'No text or email consent' })
  })
  it("never when \"Don't ask\" is on, already asked, or reviews are off", () => {
    expect(firstRequest(loan({ skip: true }), s, '2026-11-10').draft).toBe(false)
    expect(firstRequest(loan({ status: 'drafted' }), s, '2026-11-10').draft).toBe(false)
    expect(firstRequest(loan(), { ...s, companyLink: null }, '2026-11-10').draft).toBe(false)
  })
  it('a repeat client asked within 12 months is not asked again', () => {
    expect(firstRequest(loan({ lastAskedElsewhereAt: '2026-03-01T15:00:00Z' }), s, '2026-11-10')).toMatchObject({ draft: false, why: 'Asked for a review in the last 12 months' })
    expect(firstRequest(loan({ lastAskedElsewhereAt: '2025-10-01T15:00:00Z' }), s, '2026-11-10').draft).toBe(true)
  })
  it('no backfill: loans funded before the start day are left for the manual button', () => {
    expect(firstRequest(loan({ fundingDate: '2026-10-20', closingDate: '2026-10-20' }), s, '2026-11-10')).toMatchObject({ draft: false })
  })
})

describe('follow-up', () => {
  const asked = loan({ status: 'requested', requestedAt: '2026-11-09T16:00:00Z' })
  it('one follow-up after 7 days', () => {
    expect(followUpRequest(asked, s, '2026-11-15').draft).toBe(false)
    expect(followUpRequest(asked, s, '2026-11-16')).toEqual({ draft: true, channel: 'text' })
  })
  it('never more than 2 asks, never after received, never when follow-ups are off', () => {
    expect(followUpRequest({ ...asked, status: 'follow_up_sent' }, s, '2026-12-30')).toMatchObject({ draft: false, why: 'Already followed up (2 asks)' })
    expect(followUpRequest({ ...asked, status: 'received' }, s, '2026-12-30').draft).toBe(false)
    expect(followUpRequest(asked, { ...s, followUp: false }, '2026-12-30').draft).toBe(false)
  })
})

describe('wording', () => {
  it('fills the placeholders, with the LO link first and the second link as "or here"', () => {
    const link = reviewLink({ companyLink: 'https://g.page/r/mps', secondLink: 'https://zillow.com/x' }, null)
    expect(link).toBe('https://g.page/r/mps or here: https://zillow.com/x')
    expect(reviewLink({ companyLink: 'https://g.page/r/mps', secondLink: null }, 'https://g.page/r/connor')).toBe('https://g.page/r/connor')
    expect(fillReview(DEFAULT_REVIEW_TEXT, { first: 'Pat', lo: 'Connor', link: 'L' })).toBe("Hi Pat, it's Connor. Congrats again on closing! If you have a minute, would you leave a quick review of your experience? L Thank you!")
  })
  it('the defaults are neutral, and gating or incentives are refused', () => {
    expect(reviewWordingProblem(DEFAULT_REVIEW_TEXT)).toBeNull()
    expect(reviewWordingProblem(DEFAULT_REVIEW_EMAIL)).toBeNull()
    expect(reviewWordingProblem('Only if you were happy, leave a review')).toMatch(/neutral/)
    expect(reviewWordingProblem('Leave a 5-star review!')).toMatch(/neutral/)
    expect(reviewWordingProblem('Review us for a $25 gift card')).toMatch(/incentives/)
  })
})
