import { describe, expect, it } from 'vitest'
import { application, coBorrower, loan, organization, originator, primary, properties } from '@/lib/mismo/testFixture'
import { validateApplication } from './urla'
import { buildWorkflow, daysWaiting, milestoneView, type StepMark, type StepTemplate, type WorkflowFacts } from './workflow'

describe('1003 validation', () => {
  const base = { loan, app: application, properties, organization, originator }

  it('lists missing fields by section, with the borrower named', () => {
    const v = validateApplication(base)
    const fields = (section: string) => v.issues.filter((i) => i.section === section).map((i) => `${i.field}${i.borrower ? ` · ${i.borrower}` : ''}`)
    // The co-borrower is missing most person facts; the primary is nearly complete.
    expect(fields('borrower')).toContain('Date of birth · Test Coborrower')
    expect(fields('borrower').some((f) => f.endsWith('Test Borrower'))).toBe(false)
    expect(fields('credit')).toEqual(['Credit score · Test Coborrower'])
    expect(v.totalMissing).toBe(v.issues.length)
    const borrowerSection = v.sections.find((s) => s.id === 'borrower')!
    expect(borrowerSection.missing).toBe(fields('borrower').length)
  })

  it('flags loan terms, the subject home on a refinance, and Settings gaps', () => {
    const v = validateApplication({
      ...base,
      loan: { ...loan, details: { ...loan.details, noteRate: null, subjectPropertyId: null } },
      organization: { ...organization, nmls: null },
    })
    expect(v.issues.filter((i) => i.section === 'loan').map((i) => i.field)).toEqual(['Interest rate'])
    expect(v.issues.some((i) => i.section === 'property' && i.field === 'Subject property')).toBe(true)
    expect(v.issues.some((i) => i.field === 'Company NMLS (Settings)')).toBe(true)
  })

  it('lets a purchase be TBD on the home and shows empty optional sections as not started', () => {
    const v = validateApplication({
      ...base,
      loan: { ...loan, purpose: 'purchase', details: { ...loan.details, purchasePrice: 400_000, subjectPropertyId: null } },
      app: { ...application, assets: [], liabilities: [] },
      properties: [],
    })
    expect(v.issues.some((i) => i.section === 'property')).toBe(false)
    expect(v.sections.find((s) => s.id === 'assets')).toMatchObject({ missing: 0, started: false })
    expect(v.sections.find((s) => s.id === 'reo')).toMatchObject({ missing: 0, started: false })
  })

  it('a complete application has nothing missing', () => {
    const no = { borrowingUndisclosedMoney: false, applyingOtherMortgage: false, applyingNewCredit: false, subjectToPriorityLien: false, cosignerOrGuarantor: false, outstandingJudgments: false, delinquentFederalDebt: false, partyToLawsuit: false, deedInLieuPast7Years: false, shortSalePast7Years: false, foreclosurePast7Years: false }
    const answered = { ...primary.declarations, ...no }
    const complete = { ...coBorrower, estimatedCreditScore: 700, person: { ...coBorrower.person, dateOfBirth: '1990-01-01', citizenship: 'us_citizen' as const, maritalStatus: 'married' as const, phone: '214-555-0101' }, addresses: primary.addresses, employments: coBorrower.employments.map((e) => ({ ...e, startDate: '2019-01-01' })), declarations: answered }
    const v = validateApplication({ ...base, app: { ...application, borrowers: [{ ...primary, declarations: answered }, complete] } })
    expect(v.issues).toEqual([])
    expect(v.sections.every((s) => s.missing === 0)).toBe(true)
  })
})

const t = (key: string, group: StepTemplate['group'], over: Partial<StepTemplate> = {}): StepTemplate => ({
  key, name: key, group, owner: 'loan_officer', purposes: null, sortOrder: 0, requires: [], ruleKey: null, milestone: null, actionLabel: 'Mark done', actionTarget: null, ...over,
})
const templates: StepTemplate[] = [
  t('prequal', 'origination', { sortOrder: 10, ruleKey: 'prequal' }),
  t('application', 'origination', { sortOrder: 20, ruleKey: 'urla_complete', milestone: 'application' }),
  t('credit', 'origination', { sortOrder: 30 }),
  t('preapproval', 'origination', { sortOrder: 50, purposes: ['purchase'], requires: ['application', 'credit'] }),
  t('disclosures', 'disclosure_setup', { sortOrder: 10, requires: ['application'] }),
  t('submit', 'disclosure_setup', { sortOrder: 50, requires: ['disclosures'], ruleKey: 'ready_to_submit' }),
  t('funded', 'closing_funding', { requires: ['submit'] }),
]
const facts: WorkflowFacts = { purpose: 'purchase', prequalReady: true, urlaMissing: 2, urlaStarted: true, hasContract: false, hasLoanAmount: true, hasRate: true, stageSince: '2026-10-20' }

describe('workflow', () => {
  it('works out done, ready, not started and blocked', () => {
    const w = buildWorkflow(templates, [], facts)
    const status = Object.fromEntries(w.steps.map((s) => [s.key, s.status]))
    expect(status).toEqual({ prequal: 'done', application: 'ready', credit: 'ready', preapproval: 'not_started', disclosures: 'not_started', submit: 'blocked', funded: 'not_started' })
    expect(w.steps.find((s) => s.key === 'prequal')?.auto).toBe(true)
    expect(w.steps.find((s) => s.key === 'application')?.reason).toBe('2 required fields missing')
    expect(w.steps.find((s) => s.key === 'submit')?.reason).toBe("Can't submit: the 1003 is missing 2 required fields.")
  })

  it('picks the current group and next step, and counts progress', () => {
    const w = buildWorkflow(templates, [], facts)
    expect(w.currentGroup).toBe('origination')
    expect(w.next?.key).toBe('application')
    expect(w.alsoReady.map((s) => s.key)).toEqual(['credit'])
    expect([w.doneCount, w.totalCount]).toEqual([1, 7])
  })

  it('moves on as steps are marked, and not-applicable steps drop out of the count', () => {
    const marks: StepMark[] = [
      { stepKey: 'credit', status: 'done', doneOn: '2026-10-21' },
      { stepKey: 'preapproval', status: 'na', doneOn: null },
    ]
    const w = buildWorkflow(templates, marks, { ...facts, urlaMissing: 0 })
    expect(w.steps.find((s) => s.key === 'application')?.status).toBe('done')
    expect(w.currentGroup).toBe('disclosure_setup')
    expect(w.next?.key).toBe('disclosures')
    expect([w.doneCount, w.totalCount]).toEqual([3, 6])
  })

  it('leaves out steps for other loan purposes', () => {
    const w = buildWorkflow(templates, [], { ...facts, purpose: 'refinance_cash_out' })
    expect(w.steps.some((s) => s.key === 'preapproval')).toBe(false)
  })

  it('counts days waiting from the last done step or the stage change', () => {
    expect(daysWaiting([], '2026-10-20', '2026-10-25')).toBe(5)
    expect(daysWaiting([{ stepKey: 'credit', status: 'done', doneOn: '2026-10-23' }], '2026-10-20', '2026-10-25')).toBe(2)
    expect(daysWaiting([], '2026-10-25', '2026-10-25')).toBe(0)
  })
})

describe('milestones', () => {
  it('marks reached ones done with dates and the next one current', () => {
    const v = milestoneView([{ milestone: 'application', reachedOn: '2026-10-20' }])
    expect(v.slice(0, 3).map((m) => [m.id, m.state, m.date])).toEqual([
      ['application', 'done', '2026-10-20'],
      ['disclosures_sent', 'current', null],
      ['submitted', 'future', null],
    ])
    expect(milestoneView([])[0].state).toBe('current')
    // A refinance skips Application: it still shows as passed once Disclosures sent is reached.
    expect(milestoneView([{ milestone: 'disclosures_sent', reachedOn: '2026-10-22' }]).slice(0, 3).map((m) => [m.state, m.date])).toEqual([
      ['done', null],
      ['done', '2026-10-22'],
      ['current', null],
    ])
  })
})

describe('header metrics', () => {
  it('reads the shared summary and shows the credit tier', async () => {
    const { headerMetrics, qualifyingScore } = await import('./metrics')
    const { applicationSummary } = await import('@/lib/urla/summary')
    const summary = applicationSummary(loan, application, properties)
    const m = headerMetrics(loan, summary, qualifyingScore([700, null]))
    expect(m.map((x) => x.label)).toEqual(['Loan amount', 'Loan type', 'Credit score', 'LTV', 'CLTV', 'DTI', 'Property'])
    expect(m[0].value).toBe('$350,000')
    expect(m[2]).toMatchObject({ value: '700', note: 'Good', tone: 'green' })
    expect(m[3].value).toBe('70%')
    expect(m[6].value).toBe('123 Test Lane, Dallas, TX')
    const heloc = headerMetrics({ ...loan, purpose: 'heloc' }, summary, null)
    expect(heloc.some((x) => x.label === 'LTV')).toBe(false)
    expect(heloc[2].value).toBe('—')
  })
})

describe('complete fields', () => {
  it('gives editable issues a target and groups typed values by record', async () => {
    const { groupFieldChanges, fixKey } = await import('./urla')
    const v = validateApplication({ loan: { ...loan, details: { ...loan.details, noteRate: null } }, app: application, properties, organization, originator })
    const dob = v.issues.find((i) => i.field === 'Date of birth')!
    expect(dob.fix).toEqual({ kind: 'person', contactId: 'c-2', field: 'dateOfBirth' })
    const rate = v.issues.find((i) => i.field === 'Interest rate')!
    const score = v.issues.find((i) => i.section === 'credit')!
    // Address and demographics have no inline fix: they're done on the 1003.
    expect(v.issues.find((i) => i.section === 'demographics')?.fix).toBeUndefined()
    const changes = groupFieldChanges(v.issues, {
      [fixKey(rate.fix!)]: 6.75,
      [fixKey(dob.fix!)]: '1990-05-01',
      [fixKey(score.fix!)]: 690,
      'person:c-2:citizenship': '',
    })
    expect(changes.loan).toEqual({ noteRate: 6.75 })
    expect(changes.people).toEqual({ 'c-2': { dateOfBirth: '1990-05-01' } })
    expect(changes.scores).toEqual({ 'c-2': 690 })
  })
})

describe('Select lender & program', () => {
  const withStep = [...templates, t('select_program', 'origination', { sortOrder: 55, ruleKey: 'program_chosen', actionLabel: 'Open pricing', actionTarget: 'loan' })]
  const ready = { ...facts, urlaMissing: 0 }
  it('is done once a program is chosen on Loan · Pricing', () => {
    expect(buildWorkflow(withStep, [], { ...ready, hasProgram: true }).steps.find((s) => s.key === 'select_program')).toMatchObject({ status: 'done', auto: true })
    expect(buildWorkflow(withStep, [], { ...ready, hasProgram: false }).steps.find((s) => s.key === 'select_program')?.reason).toBe('Compare quotes on Loan · Pricing and choose one')
  })
  it("blocks Submit until a lender is chosen: \"Can't submit: no lender/program selected\"", () => {
    const marks: StepMark[] = [{ stepKey: 'disclosures', status: 'done', doneOn: '2026-10-21' }]
    expect(buildWorkflow(withStep, marks, { ...ready, hasProgram: false }).steps.find((s) => s.key === 'submit')).toMatchObject({ status: 'blocked', reason: "Can't submit: no lender/program selected." })
    expect(buildWorkflow(withStep, marks, { ...ready, hasProgram: true }).steps.find((s) => s.key === 'submit')?.status).not.toBe('blocked')
  })
})

describe('Pre-approval letter step', () => {
  const withRule = templates.map((x) => (x.key === 'preapproval' ? { ...x, ruleKey: 'preapproval_letter', actionLabel: 'Open letters', actionTarget: 'letters' } : x))
  const ready = { ...facts, urlaMissing: 0 }
  it('is done once a letter is issued', () => {
    const marks: StepMark[] = [{ stepKey: 'credit', status: 'done', doneOn: '2026-10-21' }]
    expect(buildWorkflow(withRule, marks, { ...ready, hasPreapprovalLetter: true }).steps.find((s) => s.key === 'preapproval')).toMatchObject({ status: 'done', auto: true })
    expect(buildWorkflow(withRule, marks, { ...ready, hasPreapprovalLetter: false }).steps.find((s) => s.key === 'preapproval')?.status).not.toBe('done')
  })
})
