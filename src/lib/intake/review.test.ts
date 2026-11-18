import { describe, expect, it } from 'vitest'
import { APPROVAL_WORDS, intakeMapping, monthlyFromSource, summarizeIntake } from './review'

// Connor's mockup (page 5): Maria, Frisco, offer out, answer by Friday.
const today = new Date('2026-11-17T12:00:00')
const maria = {
  call: { borrowerName: 'Maria Lopez', phone: '(214) 555-0142', email: 'maria@example.test', referralSource: 'Inbound call for Dave', realtor: { partnerId: 'p1', name: 'Amy Lee', phone: '2145550101' } },
  goal: { goal: 'purchase', location: 'Frisco', propertyType: 'sfr', expectedPrice: 385000, contractStatus: 'offer_submitted', keyDates: 'response expected Fri', currentHousing: 1850, targetPayment: 2600, downPayment: 15000 },
  credit: {
    scoreReported: 680,
    collections: { answer: 'yes', details: 'medical ~$400 (2024), being paid' },
    latePayments: { answer: 'no' },
    debts: [
      { creditor: 'Toyota', type: 'auto', balance: 18200, monthly: 455 },
      { creditor: 'Chase', type: 'card', balance: 2100, monthly: 65 },
      { creditor: 'Nelnet', type: 'student', balance: 24000, status: 'deferred to Mar' },
    ],
  },
  assets: { accounts: [{ type: 'checking', owners: 'Maria', balance: 4000 }, { type: 'savings', owners: 'Maria', balance: 11000 }], funds: { gift: { source: 'parents, amount unknown' } } },
  income: {
    sources: [
      { type: 'w2', employer: 'Bright Smiles Dental', payType: 'salary', payAmount: 57600, startDate: '2023-04-01' },
      { type: '1099', payer: 'Event photography', grossMonthly: 1200, startDate: '2026-03-01' },
    ],
  },
  changes: { concerns: 'Will the student loans hurt me?', missingDocs: [{ item: '30 days paystubs' }, { item: '2025 W-2' }] },
  handoff: { urgency: 'time_sensitive', urgencyReason: 'offer out, answer by Fri', urgencyDate: '2026-11-20', unresolvedQuestions: 'Wants to know cash to close' },
}

describe('intake summary (code)', () => {
  const s = summarizeIntake(maria, today)

  it('works out the key numbers from what was reported', () => {
    expect(s.key_numbers).toEqual({ price: 385000, down_payment: 15000, target_payment: 2600, current_housing: 1850, reported_score: 680, monthly_income_reported: 6000, monthly_debts_reported: 520 })
  })

  it('labels the rough DTI as not a qualification and names what is missing', () => {
    expect(s.rough_dti_note).toBe('Rough DTI at the target payment using all reported income: ~52%, before the deferred student loan payment. Borrower-reported numbers only, not a qualification.')
  })

  it('raises the flags from the list', () => {
    expect(s.flags.map((f) => `${f.severity}: ${f.text}`)).toEqual([
      'review: Deferred or income-driven student loan (Nelnet): a payment must be counted',
      'review: 1099 income under 2 years (8 months)',
      'review: Gift funds unconfirmed',
      'info: Collections / charge-offs reported: medical ~$400 (2024), being paid',
      'review: Deadline within 7 days (2026-11-20): offer out, answer by Fri',
    ])
  })

  it('lists missing docs, open questions, urgency and one income line per stream', () => {
    expect(s.missing_docs).toEqual(['30 days paystubs', '2025 W-2'])
    expect(s.open_questions).toEqual(['Wants to know cash to close', 'Will the student loans hurt me?'])
    expect(s.urgency).toEqual({ level: 'time_sensitive', reason: 'offer out, answer by Fri', date: '2026-11-20' })
    expect(s.breakdown.income).toEqual(['A · W-2, Bright Smiles Dental, $57,600/yr, since 2023-04', 'B · 1099, Event photography, ~$1,200/mo, since 2026-03'])
    expect(s.breakdown.realtor_source).toBe('Inbound call for Dave · realtor: Amy Lee, 2145550101')
    expect(s.headline).toBe('Maria · Purchase · Frisco · ~$385,000 · offer submitted')
  })

  it('handles an empty interview', () => {
    const e = summarizeIntake({}, today)
    expect(e.rough_dti_note).toBe('Not enough reported numbers for a rough DTI.')
    expect(e.flags).toEqual([])
    expect(e.urgency.level).toBe('routine')
  })

  it('figures hourly pay and leaves business income to documents', () => {
    expect(monthlyFromSource({ type: 'w2', payType: 'hourly', payAmount: 20, hoursPerWeek: 40 })).toBeCloseTo(3466.67, 1)
    expect(monthlyFromSource({ type: 'business', name: 'X' })).toBeNull()
  })

  it('catches approval language', () => {
    expect(APPROVAL_WORDS.test('She should qualify easily')).toBe(true)
    expect(APPROVAL_WORDS.test('Salaried W-2 for 3 years')).toBe(false)
  })
})

describe('what Accept writes into the file', () => {
  it('maps people, jobs, accounts, debts and the realtor; skips what has no number', () => {
    const m = intakeMapping(maria)
    expect(m.person).toEqual({ email: 'maria@example.test', phone: '2145550142' })
    expect(m.loan).toEqual({ purchasePrice: 385000, estimatedScore: 680 })
    expect(m.jobs).toEqual([
      { employer: 'Bright Smiles Dental', title: null, startDate: '2023-04-01', monthlyIncome: 4800, selfEmployed: false, ownershipPct: null },
      { employer: 'Event photography', title: null, startDate: '2026-03-01', monthlyIncome: 1200, selfEmployed: true, ownershipPct: null },
    ])
    expect(m.assets).toEqual([{ kind: 'checking', amount: 4000, institution: null }, { kind: 'savings', amount: 11000, institution: null }])
    // The deferred student loan has no payment, so it isn't added (the flag says so).
    expect(m.debts).toEqual([
      { kind: 'installment', creditor: 'Toyota', balance: 18200, monthlyPayment: 455 },
      { kind: 'revolving', creditor: 'Chase', balance: 2100, monthlyPayment: 65 },
    ])
    expect(m.realtor).toEqual({ partnerId: 'p1', name: 'Amy Lee', phone: '2145550101' })
  })
})
