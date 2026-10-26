import { describe, expect, it } from 'vitest'
import {
  buildUserPrompt,
  complianceIssues,
  emailSignature,
  fillTemplate,
  finalBody,
  parseRequest,
  validateDraft,
  type FileFacts,
  type NoteFact,
  type Signer,
} from './followUp'

const LOAN = '11111111-2222-3333-4444-555555555555'

const facts: FileFacts = {
  today: '2026-10-25',
  borrowerFirstName: 'Jane',
  borrowerName: 'Jane Test',
  coBorrowerNames: [],
  stage: 'pre_qualified',
  purpose: 'purchase',
  mortgageType: 'fha',
  purchasePrice: 350000,
  loanAmount: 337750,
  cashOutAmount: null,
  contractDate: null,
  optionEndDate: null,
  closingDate: null,
  propertyAddress: null,
  openTasks: [{ title: 'Collect pay stubs', dueOn: '2026-10-28' }],
}

const notes: NoteFact[] = [
  { id: 'n1', kind: 'call', body: 'Jane said she is touring homes in Frisco this weekend and will send pay stubs Monday.', createdAt: '2026-10-24T15:00:00Z' },
]

const signer: Signer = { loName: 'Sample Officer', loNmls: '123456', loPhone: '(555) 555-0100', companyName: 'MPS Mortgage LLC', companyNmls: '2501110' }

describe('parseRequest', () => {
  it('accepts a follow-up request', () => {
    expect(parseRequest({ task: 'follow_up', loanId: LOAN, channel: 'text', instructions: '  check in  ' })).toEqual({ task: 'follow_up', loanId: LOAN, channel: 'text', templateId: null, instructions: 'check in' })
  })
  it('rejects bad input in plain English', () => {
    expect(parseRequest({ task: 'other' })).toEqual({ error: 'Unknown assistant task.' })
    expect(parseRequest({ task: 'follow_up', loanId: 'x', channel: 'text' })).toEqual({ error: 'Missing or invalid loan.' })
    expect(parseRequest({ task: 'follow_up', loanId: LOAN, channel: 'fax' })).toEqual({ error: 'Pick text or email.' })
    expect(parseRequest({ task: 'follow_up', loanId: LOAN, channel: 'text', instructions: 'x'.repeat(501) })).toHaveProperty('error')
  })
})

describe('fillTemplate', () => {
  it('fills known merge fields and leaves unknown ones', () => {
    expect(fillTemplate('Hi {{first_name}}, {{lo_name}} here. {{mystery}}', facts, signer)).toBe('Hi Jane, Sample Officer here. {{mystery}}')
  })
})

describe('buildUserPrompt', () => {
  it('includes the file facts, notes and request, without empty fields', () => {
    const p = buildUserPrompt('text', facts, notes, null, 'ask about the weekend', signer)
    expect(p).toContain('Stage: pre qualified')
    expect(p).toContain('Purchase price: $350,000')
    expect(p).toContain('touring homes in Frisco')
    expect(p).toContain('Collect pay stubs (due 2026-10-28)')
    expect(p).toContain('ask about the weekend')
    expect(p).not.toContain('Closing date')
  })
  it('says when there are no notes', () => {
    expect(buildUserPrompt('email', facts, [], null, null, signer)).toContain('no notes on this file yet')
  })
})

describe('validateDraft', () => {
  it('keeps real quotes and drops made-up ones, lowering confidence', () => {
    const r = validateDraft(
      {
        subject: 'ignored for texts',
        body: ' Hi Jane, how did the Frisco tours go? ',
        confidence: 'high',
        sources: [
          { label: 'Call 10/24', quote: 'touring homes in  Frisco this weekend' },
          { label: 'Call', quote: 'she wants a pool' },
        ],
      },
      'text',
      notes,
    )
    expect(r).toEqual({ draft: { subject: null, body: 'Hi Jane, how did the Frisco tours go?', confidence: 'medium', sources: [{ label: 'Call 10/24', quote: 'touring homes in  Frisco this weekend' }] } })
  })
  it('rejects empty bodies and emails without a subject', () => {
    expect(validateDraft({ body: ' ', confidence: 'low', sources: [] }, 'text', notes)).toHaveProperty('error')
    expect(validateDraft({ subject: '', body: 'Hi', confidence: 'low', sources: [] }, 'email', notes)).toEqual({ error: 'The email draft has no subject.' })
  })
})

describe('complianceIssues', () => {
  it('passes a plain check-in', () => {
    expect(complianceIssues('text', { subject: null, body: 'Hi Jane, how did the Frisco tours go? Send the pay stubs when you can.' })).toEqual([])
  })
  it('flags rate promises, guarantees and payments', () => {
    const issues = complianceIssues('email', { subject: 'Guaranteed approval', body: 'Rates are at 6.25% and your payment is $2,100/mo.' })
    expect(issues).toContain('The message says "guarantee".')
    expect(issues).toContain('The message mentions a percentage.')
    expect(issues).toContain('The message quotes a monthly payment.')
    expect(complianceIssues('text', { subject: null, body: 'We have the lowest rates in DFW' })).toEqual(['The message makes a rate claim.'])
  })
  it('flags long texts and leftover merge fields', () => {
    expect(complianceIssues('text', { subject: null, body: 'a'.repeat(321) })).toEqual(['The text is 321 characters; keep it under 320.'])
    expect(complianceIssues('text', { subject: null, body: 'Hi {{first_name}}' })).toEqual(['The message has an unfilled merge field.'])
  })
})

describe('signature', () => {
  it('always carries the company NMLS on emails', () => {
    expect(emailSignature(signer)).toBe('Sample Officer, NMLS #123456\nLoan Officer\nMPS Mortgage LLC, NMLS #2501110\n(555) 555-0100')
    expect(emailSignature({ ...signer, loName: null, loPhone: null })).toBe('Loan Officer\nMPS Mortgage LLC, NMLS #2501110')
    expect(finalBody('email', 'Hi Jane', signer)).toContain('NMLS #2501110')
    expect(finalBody('text', 'Hi Jane', signer)).toBe('Hi Jane')
  })
})
