import { describe, expect, it } from 'vitest'
import { doneSections, fillBlanks, handoffPrefill, liveSummary, readyToSubmit, sectionFill, SECTIONS, withLo } from './sections'

// Connor's mockup: Maria, Frisco, ~$385k, offer out.
const maria = {
  call: { borrowerName: 'Maria Lopez', realtor: { name: 'Amy Lee' }, followUpMethod: 'text', toldSecurePortal: true },
  goal: { goal: 'purchase', location: 'Frisco', expectedPrice: 385000, contractStatus: 'offer_submitted', keyDates: 'answer by Fri', currentHousing: 1850, targetPayment: 2600, downPayment: 15000, downPaymentSource: 'savings' },
  credit: { scoreReported: 680, debts: [{ creditor: 'Toyota', type: 'auto', monthly: 455 }, { creditor: 'Chase', type: 'card', monthly: 65 }] },
  assets: { funds: { gift: { amount: '', source: 'parents, amount unknown' } } },
  income: { sources: [{ type: 'w2', employer: 'Bright Smiles Dental' }, { type: '1099', payer: 'Events' }] },
  changes: { concerns: 'Will the student loans hurt me?', missingDocs: [{ item: '30 days paystubs', owner: 'Maria' }] },
  meta: { done: ['call', 'goal'] },
}

describe('intake sections', () => {
  it('has the seven sections in the script order, each with notes', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual(['call', 'goal', 'credit', 'assets', 'income', 'changes', 'handoff'])
    for (const s of SECTIONS) expect(s.fields.some((f) => f.key === 'notes')).toBe(true)
  })

  it('puts the loan officer in the spoken prompts', () => {
    expect(withLo(SECTIONS[0].prompt, 'Dave')).toContain("I'm working with Dave")
    expect(withLo('{LO} will review', '')).toBe('the loan officer will review')
  })

  it('counts what is filled', () => {
    expect(sectionFill(maria, 'credit')).toEqual({ filled: 2, of: 9 })
    expect(sectionFill({}, 'handoff').filled).toBe(0)
  })

  it('builds the live summary like the mockup', () => {
    expect(liveSummary(maria)).toEqual([
      'Purchase · Frisco area · ~$385k',
      'Under contract? Offer submitted',
      'Rent now $1,850 · target ≤ $2,600',
      'Down: ~$15k + savings + possible gift',
      'Score ~680 (self-reported)',
      'Debts: 2 · $520/mo',
      'Income: W-2 + 1099',
      'Realtor: Amy Lee',
      'Missing docs: 1',
    ])
    expect(liveSummary({})).toEqual([])
  })

  it('opens Submit only after section 7', () => {
    expect(doneSections(maria)).toEqual(['call', 'goal'])
    expect(readyToSubmit(maria)).toBe(false)
    expect(readyToSubmit({ meta: { done: ['handoff'] } })).toBe(true)
  })

  it('prefills the hand-off from sections 1–6, blanks only', () => {
    const p = handoffPrefill(maria, 'Jamie')
    expect(p).toMatchObject({
      urgency: 'time_sensitive',
      urgencyReason: 'Offer submitted: answer by Fri',
      unresolvedQuestions: 'Will the student loans hurt me?',
      followUpOwner: 'Jamie',
      followUpMethod: 'text',
      checkSummary: true,
      checkCredit: true,
      checkIncome: true,
      checkFunds: true,
      checkDocs: true,
    })
    expect(fillBlanks({ followUpOwner: 'Dave', urgency: '' }, p)).toMatchObject({ followUpOwner: 'Dave', urgency: 'time_sensitive' })
  })
})
