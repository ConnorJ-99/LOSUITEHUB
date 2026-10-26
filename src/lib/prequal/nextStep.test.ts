import { describe, expect, it } from 'vitest'
import type { Signer } from '../../../supabase/functions/assistant/followUp'
import { documentChecklist, documentRequest, nextStep, requestIssues, type ChecklistInput } from './nextStep'
import type { Readiness } from './readiness'

const signer: Signer = { loName: 'Sample Officer', loNmls: '123456', loPhone: '(555) 555-0100', companyName: 'MPS Mortgage LLC', companyNmls: '2501110' }

describe('nextStep', () => {
  const r = (over: Partial<Readiness>): Readiness => ({ level: 'ready', reasons: [], nurture: [], ...over })
  it('follows the readiness result', () => {
    expect(nextStep(r({ level: 'not_ready', nurture: ['credit', 'dti'] }), 'lead')).toMatchObject({ action: 'nurture', detail: 'Not ready yet: credit, dti. Set a check-back date.' })
    expect(nextStep(r({ level: 'manual_review' }), 'lead')?.action).toBe('request_documents')
    expect(nextStep(r({ level: 'needs_documents', reasons: [{ level: 'needs_documents', text: '', missing: 'credit' }, { level: 'needs_documents', text: '', missing: 'assets' }] }), 'lead')).toMatchObject({ action: 'pull_credit', title: 'Pull credit' })
    expect(nextStep(r({ level: 'needs_documents', reasons: [{ level: 'needs_documents', text: '', missing: 'income_docs' }] }), 'lead')).toMatchObject({ action: 'request_documents', title: 'Request documents' })
    expect(nextStep(r({ level: 'needs_documents', reasons: [{ level: 'needs_documents', text: '', missing: 'score' }, { level: 'needs_documents', text: '', missing: 'credit' }] }), 'lead')?.title).toBe('Finish the prequal')
    expect(nextStep(r({}), 'contacted')?.action).toBe('pre_approve')
    expect(nextStep(r({}), 'pre_approved')).toBeNull()
  })
})

describe('documentChecklist', () => {
  const marcus: ChecklistInput = {
    people: [{ firstName: 'Marcus', jobs: [{ employerName: 'Reyes Landscaping', selfEmployed: true }], otherIncomes: [], assetTypes: ['checking'], creditEvents: ['late_payment'] }],
    incomeDocType: null,
    homes: [{ addressLine: '1200 Elm St', rented: false }],
  }
  const keys = (i: ChecklistInput) => documentChecklist(i).map((g) => `${g.title}: ${g.items.map((x) => x.key).join(', ')}`)

  it('self-employed full doc: returns, business returns and a P&L', () => {
    expect(keys(marcus)).toEqual(['Marcus: id, tax_returns, business_returns, pl, bank_statements, explanation', 'Homes you own: home_statements'])
  })
  it('bank-statement income swaps returns for statements and proof of business', () => {
    expect(keys({ ...marcus, incomeDocType: 'bank_statement' })[0]).toBe('Marcus: id, bank_statements_income, business_proof, bank_statements, explanation')
  })
  it('W-2 earner with Social Security, a gift, a bankruptcy and a rental', () => {
    const groups = keys({
      people: [
        { firstName: 'Jane', jobs: [{ employerName: 'A', selfEmployed: false }, { employerName: 'B', selfEmployed: false }], otherIncomes: ['social_security', 'child_support'], assetTypes: ['savings', 'retirement', 'gift_cash'], creditEvents: ['bankruptcy_ch7'] },
        { firstName: 'Sam', jobs: [], otherIncomes: [], assetTypes: [], creditEvents: [] },
      ],
      incomeDocType: 'full_doc',
      homes: [{ addressLine: '55 Oak', rented: true }],
    })
    expect(groups).toEqual([
      'Jane: id, paystubs, w2s, award_social_security, support_order, bank_statements, investment_statements, gift_letter, bankruptcy',
      'Sam: id',
      'Homes you own: home_statements, leases',
    ])
    expect(documentChecklist({ ...marcus, people: [{ ...marcus.people[0], jobs: [{ employerName: 'A', selfEmployed: false }, { employerName: 'B', selfEmployed: false }] }] })[0].items[1].full).toBe('Pay stubs covering the last 30 days from each job')
  })
  it('DSCR asks for leases instead of income documents', () => {
    expect(keys({ ...marcus, incomeDocType: 'dscr', homes: [] })).toEqual(['Marcus: id, bank_statements, explanation', 'Homes you own: leases'])
  })
})

describe('documentRequest', () => {
  const groups = documentChecklist({
    people: [{ firstName: 'Marcus', jobs: [{ employerName: 'Reyes Landscaping', selfEmployed: false }], otherIncomes: [], assetTypes: ['checking'], creditEvents: [] }],
    incomeDocType: null,
    homes: [],
  })
  it('a short text lists the documents', () => {
    const d = documentRequest('text', { firstName: 'Marcus', contact: '214-555-0177' }, groups, signer)
    expect(d.body).toBe("Hi Marcus, it's Sample. To keep your pre-approval moving I'll need a photo of your ID, pay stubs (last 30 days), W-2s (2 years) and bank statements (2 months). Photos or PDFs are fine. Thanks!")
    expect(d.to).toBe('Marcus · 214-555-0177')
    expect(requestIssues(d, signer)).toEqual([])
  })
  it('a long list in a text points to the email instead', () => {
    const long = documentChecklist({
      people: [{ firstName: 'Jane', jobs: [{ employerName: 'A', selfEmployed: true }], otherIncomes: ['social_security', 'child_support'], assetTypes: ['savings', 'retirement', 'gift_cash'], creditEvents: ['bankruptcy_ch7', 'late_payment'] }],
      incomeDocType: null,
      homes: [{ addressLine: 'x', rented: true }],
    })
    const d = documentRequest('text', { firstName: 'Jane', contact: null }, long, signer)
    expect(d.body).toContain("I'm emailing you the list")
    expect(d.body.length).toBeLessThanOrEqual(320)
  })
  it('an email lists everything with the signature', () => {
    const d = documentRequest('email', { firstName: 'Marcus', contact: 'marcus@example.com' }, groups, signer)
    expect(d.subject).toBe('Documents for your pre-approval')
    expect(d.body).toContain('- W-2s for the last 2 years')
    expect(d.body).toContain('MPS Mortgage LLC, NMLS #2501110')
    expect(d.body).not.toContain('Marcus:') // one person: no headings
    const two = documentRequest('email', { firstName: 'Jane', contact: null }, [{ title: 'Jane', contactId: null, items: groups[0].items }, { title: 'Sam', contactId: null, items: groups[0].items.slice(0, 1) }, { title: 'Homes you own', contactId: null, items: groups[0].items.slice(0, 1) }], signer)
    expect(two.body).toContain('From you:')
    expect(two.body).toContain('From Sam:')
    expect(two.body).toContain('Homes you own:')
    expect(requestIssues(d, signer)).toEqual([])
  })
})
