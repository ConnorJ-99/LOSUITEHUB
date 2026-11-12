import { describe, expect, it } from 'vitest'
import { borrowerDocStatus, docProgress, groupByHome, homeRequestProblem, portalStep, stepMessage, type HomeRequestInput, type PortalDoc } from './portal'

describe('portal steps', () => {
  it('a new lead is Application received; pre-qual through under contract is In review', () => {
    expect(portalStep('lead', [])).toBe('application_received')
    expect(portalStep('contacted', [])).toBe('application_received')
    expect(portalStep('pre_approved', [])).toBe('in_review')
    expect(portalStep('under_contract', ['application'])).toBe('in_review')
  })
  it('milestones move it forward: submitted, conditions, clear to close, closed', () => {
    expect(portalStep('processing', [])).toBe('submitted')
    expect(portalStep('under_contract', ['submitted'])).toBe('submitted')
    expect(portalStep('processing', ['submitted', 'approved_conditions'])).toBe('conditions')
    expect(portalStep('processing', ['conditions_submitted'])).toBe('conditions')
    expect(portalStep('clear_to_close', [])).toBe('clear_to_close')
    expect(portalStep('processing', ['docs_out'])).toBe('clear_to_close')
    expect(portalStep('closed', [])).toBe('closed')
    expect(portalStep('clear_to_close', ['funded'])).toBe('closed')
  })
  it("the message is Connor's wording when typed, else the default", () => {
    expect(stepMessage('in_review', { in_review: '  Reviewing now.  ' })).toBe('Reviewing now.')
    expect(stepMessage('in_review', { in_review: '' })).toBe("We're reviewing your file and documents.")
    expect(stepMessage('closed', null)).toBe('Congratulations, your loan has closed!')
  })
})

describe('documents', () => {
  it('borrower words for each status', () => {
    expect(['requested', 'received', 'reviewed', 'rejected', 'waived'].map((s) => borrowerDocStatus(s as never))).toEqual(['Needed', 'Under review', 'Accepted', 'Needs replacement', null])
  })
  it('progress counts uploads and acceptances, not waived items', () => {
    expect(docProgress([{ status: 'requested' }, { status: 'received' }, { status: 'reviewed' }, { status: 'rejected' }, { status: 'waived' }])).toEqual({ done: 2, total: 4, pct: 50 })
    expect(docProgress([])).toEqual({ done: 0, total: 0, pct: 0 })
  })
})

describe('letters and estimates by home', () => {
  const doc = (id: string, propertyId: string | null): PortalDoc => ({ id, kind: 'preapproval_letter', name: `${id}.pdf`, propertyId, publishedAt: '2026-11-12T00:00:00Z' })
  const req = (id: string, propertyId: string | null, createdAt = '2026-11-10T00:00:00Z') => ({ id, propertyId, address: `${id} St`, price: 400000, status: 'requested' as const, wantsLetter: true, wantsEstimate: false, createdAt })
  it('groups by home, newest request per home, homes with nothing are left out, unlinked documents under General', () => {
    const homes = [
      { id: 'h1', address: '123 Main St', price: 410000 },
      { id: 'h2', address: '9 Elm', price: null },
      { id: 'h3', address: 'Nothing here', price: 1 },
    ]
    const out = groupByHome(homes, [req('old', 'h1', '2026-11-01T00:00:00Z'), req('new', 'h1'), req('gone', null)], [doc('a', 'h1'), doc('b', 'h2'), doc('c', null)])
    expect(out.map((h) => [h.address, h.request?.id ?? null, h.docs.map((d) => d.id)])).toEqual([
      ['123 Main St', 'new', ['a']],
      ['9 Elm', null, ['b']],
      ['gone St', 'gone', []],
      ['General', null, ['c']],
    ])
    expect(out[0].price).toBe(400000)
  })
})

describe('home request checks', () => {
  const base: HomeRequestInput = { address: '123 Main St', city: 'Dallas', state: 'TX', zip: '75201', price: 400000, downMode: 'percent', down: 5, wantsLetter: true, wantsEstimate: false, notes: '' }
  it('a complete request is fine', () => expect(homeRequestProblem(base)).toBeNull())
  it('says what is missing or wrong', () => {
    expect(homeRequestProblem({ ...base, address: ' ' })).toBe('Enter the address.')
    expect(homeRequestProblem({ ...base, price: null })).toBe('Enter the price.')
    expect(homeRequestProblem({ ...base, zip: '7520' })).toBe('Use a 5-digit ZIP code.')
    expect(homeRequestProblem({ ...base, state: 'Texas' })).toBe('Use the two-letter state, like TX.')
    expect(homeRequestProblem({ ...base, down: 120 })).toBe('The down payment percent must be 100 or less.')
    expect(homeRequestProblem({ ...base, downMode: 'amount', down: 500000 })).toBe("The down payment can't be more than the price.")
    expect(homeRequestProblem({ ...base, wantsLetter: false })).toBe('Pick a pre-approval letter, a payment estimate, or both.')
  })
})
