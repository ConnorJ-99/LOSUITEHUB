import { describe, expect, it } from 'vitest'
import { documentMessage, isSendableKind } from './documentMessages'

describe('messages that go with a sent document', () => {
  it('only estimates and pre-approval letters can be sent', () => {
    expect(isSendableKind('preapproval_letter')).toBe(true)
    expect(isSendableKind('fee_worksheet')).toBe(true)
    expect(isSendableKind('loan_comparison')).toBe(true)
    expect(isSendableKind('prequal_results')).toBe(true)
    expect(isSendableKind('paystub')).toBe(false)
  })

  it('a pre-approval letter email and heads-up text', () => {
    const m = documentMessage('preapproval_letter', 'Jordan', 'Connor')
    expect(m.subject).toBe('Your pre-approval letter — MPS Mortgage')
    expect(m.body).toBe(
      'Hi Jordan,\n\nAttached is your pre-approval letter. When you find a home and make an offer, send me the address and I can update the letter to match. Let me know if you have any questions.\n\nConnor\nMPS Mortgage',
    )
    expect(m.text).toBe('Hi Jordan, I just emailed your pre-approval letter. Let me know if you have any questions!')
  })

  it('the Fee Worksheet says it is not the official Loan Estimate', () => {
    expect(documentMessage('fee_worksheet', 'Jordan', 'Connor').body).toContain('not your official Loan Estimate')
  })

  it('works without a first name or loan officer, and the text never carries a link', () => {
    const m = documentMessage('loan_comparison', null, null)
    expect(m.body.startsWith('Hi,\n\n')).toBe(true)
    expect(m.body.endsWith('\n\nMPS Mortgage')).toBe(true)
    expect(m.text).not.toMatch(/https?:|www\./)
  })
})
