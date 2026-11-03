import { describe, expect, it } from 'vitest'
import { conditionMessage, draftContactId, pickChannel, planConditionDrafts, planKeyDateDrafts, type AutomatedLoan, type ConditionLoan, type DraftPerson, type ExistingDraft } from './drafts'

const person = (over: Partial<DraftPerson> = {}): DraftPerson => ({
  contactId: 'c1',
  firstName: 'Marcus',
  lastName: 'TEST',
  phone: '2145550100',
  email: 'marcus@example.com',
  smsConsent: true,
  emailConsent: true,
  smsOptedOut: false,
  emailOptedOut: false,
  ...over,
})

const closed = (over: Partial<AutomatedLoan> = {}, borrower: Partial<AutomatedLoan['borrower']> = {}): AutomatedLoan => ({
  loanId: 'l1',
  organizationId: 'o1',
  closingDate: '2024-03-15',
  firstPaymentDate: '2024-05-01',
  insuranceRenewalDate: null,
  homesteadFiled: true,
  occupancy: 'primary',
  street: '100 Sample St',
  loName: 'Connor Example',
  borrower: { ...person(), birthday: null, ...borrower },
  ...over,
})

const existing = (over: Partial<ExistingDraft>): ExistingDraft => ({ loanId: 'l1', sourceKey: 'x', status: 'approved', dueOn: null, contactId: 'c1', ...over })

describe('pickChannel', () => {
  it('uses text, then email, only with consent', () => {
    expect(pickChannel(person())).toBe('text')
    expect(pickChannel(person({ smsConsent: null }))).toBe('email')
    expect(pickChannel(person({ smsConsent: true, smsOptedOut: true }))).toBe('email')
    expect(pickChannel(person({ smsConsent: null, emailConsent: null }))).toBeNull()
  })

  it('with fallback, uses any address nobody said no to', () => {
    expect(pickChannel(person({ smsConsent: null, emailConsent: null }), true)).toBe('text')
    expect(pickChannel(person({ smsConsent: false, emailConsent: null }), true)).toBe('email')
    expect(pickChannel(person({ smsConsent: false, emailConsent: false }), true)).toBeNull()
    expect(pickChannel(person({ phone: null, email: null }), true)).toBeNull()
  })
})

describe('planKeyDateDrafts', () => {
  it('drafts the anniversary on the day, as a text signed with the LO first name', () => {
    const [d, ...rest] = planKeyDateDrafts([closed()], [], '2026-03-15')
    expect(rest).toEqual([])
    expect(d).toMatchObject({ loanId: 'l1', sourceKey: 'keydate:l1:anniversary:2026-03-15', dueOn: '2026-03-15', title: '2nd home anniversary · Marcus TEST' })
    expect(d.payload).toMatchObject({ channel: 'text', subject: null, contactId: 'c1', to: 'Marcus TEST (text)' })
    expect(d.payload.body).toBe("Hi Marcus, happy 2nd home anniversary! Hard to believe it's been 2 years since you closed on 100 Sample St. If you ever have questions about your mortgage, I'm here.\n– Connor")
  })

  it('still drafts up to 2 days late, not 3', () => {
    expect(planKeyDateDrafts([closed()], [], '2026-03-17')).toHaveLength(1)
    expect(planKeyDateDrafts([closed()], [], '2026-03-18')).toHaveLength(0)
    expect(planKeyDateDrafts([closed()], [], '2026-03-14')).toHaveLength(0)
  })

  it('never makes the same draft twice', () => {
    expect(planKeyDateDrafts([closed()], [existing({ sourceKey: 'keydate:l1:anniversary:2026-03-15', status: 'dismissed', dueOn: '2026-03-15' })], '2026-03-16')).toEqual([])
  })

  it('uses email when there is no text consent, and skips people with no consent', () => {
    const [d] = planKeyDateDrafts([closed({}, { smsConsent: null })], [], '2026-03-15')
    expect(d.payload).toMatchObject({ channel: 'email', subject: 'Happy home anniversary!' })
    expect(planKeyDateDrafts([closed({}, { smsConsent: null, emailConsent: false })], [], '2026-03-15')).toEqual([])
  })

  it('makes one birthday and holiday draft per person, even with two loans', () => {
    const loans = [closed({}, { birthday: '1990-12-25' }), closed({ loanId: 'l2', closingDate: '2025-06-01' }, { birthday: '1990-12-25' })]
    const drafts = planKeyDateDrafts(loans, [], '2026-12-25')
    expect(drafts.map((d) => d.sourceKey)).toEqual(['keydate:c1:birthday:2026-12-25', 'keydate:c1:holiday:2026-12-25'])
    expect(drafts[1].payload.body).toBe('Merry Christmas, Marcus! Wishing you and your family a great holiday.\n– Connor')
  })

  it('caps each person at 2 a week, keeping the more personal dates', () => {
    // Birthday on Christmas plus the anniversary on the same day: the holiday loses.
    const loan = closed({ closingDate: '2020-12-25' }, { birthday: '1990-12-25' })
    expect(planKeyDateDrafts([loan], [], '2026-12-25').map((d) => d.sourceKey)).toEqual(['keydate:c1:birthday:2026-12-25', 'keydate:l1:anniversary:2026-12-25'])
    // One already drafted this week (even if skipped) leaves room for one.
    const week = [existing({ sourceKey: 'keydate:l1:insurance:2026-12-20', status: 'dismissed', dueOn: '2026-12-20' })]
    expect(planKeyDateDrafts([loan], week, '2026-12-25').map((d) => d.sourceKey)).toEqual(['keydate:c1:birthday:2026-12-25'])
    // Older than 7 days doesn't count.
    const old = [existing({ sourceKey: 'keydate:l1:insurance:2026-12-18', dueOn: '2026-12-18' })]
    expect(planKeyDateDrafts([loan], old, '2026-12-25')).toHaveLength(2)
  })

  it('covers first payment, insurance renewal and homestead, but not the thank-you', () => {
    const loan = closed({ closingDate: '2026-10-01', firstPaymentDate: '2026-12-01', insuranceRenewalDate: '2026-10-01', homesteadFiled: false })
    expect(planKeyDateDrafts([loan], [], '2026-10-04')).toEqual([]) // thank-you day
    const [pay] = planKeyDateDrafts([loan], [], '2026-11-24')
    expect(pay.sourceKey).toBe('keydate:l1:first_payment:2026-11-24')
    expect(pay.payload.body).toContain('due December 1')
    expect(planKeyDateDrafts([loan], [], '2027-01-02').map((d) => d.sourceKey)).toEqual(['keydate:l1:homestead:2027-01-02'])
    expect(planKeyDateDrafts([loan], [], '2027-09-01').map((d) => d.sourceKey)).toEqual(['keydate:l1:insurance:2027-09-01'])
  })
})

const conditionLoan = (over: Partial<ConditionLoan> = {}): ConditionLoan => ({
  loanId: 'l9',
  organizationId: 'o1',
  loName: 'Connor Example',
  borrower: person({ firstName: 'Rita', contactId: 'c9' }),
  conditions: [
    { body: 'Two most recent bank statements', status: 'outstanding', since: '2026-11-01' },
    { body: 'Letter of explanation for the March deposit', status: 'requested', since: '2026-11-02' },
  ],
  ...over,
})

describe('planConditionDrafts', () => {
  it('waits 3 days after a condition is requested, then drafts a list', () => {
    expect(planConditionDrafts([conditionLoan()], [], '2026-11-03')).toEqual([])
    const [d] = planConditionDrafts([conditionLoan()], [], '2026-11-04')
    expect(d).toMatchObject({ loanId: 'l9', sourceKey: 'conditions:l9:2026-11-04', dueOn: '2026-11-04', title: 'Condition reminder (2 still needed) · Rita TEST' })
    expect(d.payload.body).toBe(
      "Hi Rita, a quick reminder that we're still waiting on a few items for your loan:\n- Two most recent bank statements\n- Letter of explanation for the March deposit\nSend them over whenever you can. Thank you!\n– Connor",
    )
  })

  it('repeats every 3 days after the last reminder, never with one still waiting', () => {
    const sent = existing({ loanId: 'l9', sourceKey: 'conditions:l9:2026-11-04', dueOn: '2026-11-04' })
    expect(planConditionDrafts([conditionLoan()], [sent], '2026-11-06')).toEqual([])
    expect(planConditionDrafts([conditionLoan()], [sent], '2026-11-07')).toHaveLength(1)
    expect(planConditionDrafts([conditionLoan()], [{ ...sent, status: 'pending' }], '2026-11-10')).toEqual([])
  })

  it('skips files with no borrower conditions or no way to reach them', () => {
    expect(planConditionDrafts([conditionLoan({ conditions: [] })], [], '2026-11-10')).toEqual([])
    expect(planConditionDrafts([conditionLoan({ borrower: null })], [], '2026-11-10')).toEqual([])
    expect(planConditionDrafts([conditionLoan({ borrower: person({ phone: null, email: null }) })], [], '2026-11-10')).toEqual([])
  })

  it('still drafts a text when no consent is recorded (the send screen asks for it)', () => {
    const [d] = planConditionDrafts([conditionLoan({ borrower: person({ smsConsent: null, emailConsent: null }) })], [], '2026-11-10')
    expect(d.payload.channel).toBe('text')
  })

  it('lists 5 items at most and shortens long ones', () => {
    const conditions = Array.from({ length: 7 }, (_, i) => ({ body: i === 0 ? 'x'.repeat(200) : `Item ${i}`, status: 'outstanding' as const, since: '2026-11-01' }))
    const body = conditionMessage(conditionLoan({ conditions }), person()).body
    expect(body).toContain(`- ${'x'.repeat(119)}…`)
    expect(body).toContain('- and 2 more')
    expect(body).not.toContain('Item 5')
  })
})

describe('draftContactId', () => {
  it('reads the contact from a draft', () => {
    expect(draftContactId({ channel: 'text', body: 'hi', contactId: 'c1' })).toBe('c1')
    expect(draftContactId({ channel: 'text', body: 'hi' })).toBeNull()
    expect(draftContactId(null)).toBeNull()
  })
})
