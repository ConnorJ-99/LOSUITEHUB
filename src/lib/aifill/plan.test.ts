import { describe, expect, it } from 'vitest'
import type { FillFact } from '../../../supabase/functions/assistant/summaryFill'
import { emptyDeclarations, type Application, type ApplicationBorrower } from '@/lib/api/urla'
import { fillSummary, monthlyPay, planFill, startDateFrom, tenure, type FieldChange, type NewRow } from './plan'

const person = (firstName: string): ApplicationBorrower['person'] => ({
  firstName, middleName: null, lastName: 'TEST', suffix: null, email: null, phone: null, homePhone: null, workPhone: null, workPhoneExt: null,
  dateOfBirth: null, citizenship: null, maritalStatus: null, dependentsCount: null, dependentsAges: null, militaryService: null,
  militaryActiveDuty: false, militaryServiceExpiresOn: null, militaryRetired: false, militaryReserveOnly: false, militarySurvivingSpouse: false,
})
const borrower = (contactId: string, firstName: string, role: 'primary' | 'co_borrower', extra: Partial<ApplicationBorrower> = {}): ApplicationBorrower => ({
  contactId, role, estimatedCreditScore: null, person: person(firstName), addresses: [], employments: [], otherIncomes: [], declarations: emptyDeclarations, ...extra,
})

let n = 0
const fact = (fieldPath: string, value: FillFact['value'], extra: Partial<FillFact> = {}): FillFact => ({
  id: `f${++n}`, section: 'borrower', fieldPath, record: '', contactId: 'p1', value, sourceText: 'x', displayLabel: '', confidence: 'high', ...extra,
})

const loan = { purchasePrice: null, loanAmount: null, mortgageType: null, occupancy: 'primary' as const, cashOutAmount: null, incomeDocType: null, timeline: null }
const app: Application = {
  borrowers: [
    borrower('p1', 'Jordan', 'primary', {
      addresses: [{ id: 'a1', contactId: 'p1', kind: 'current', addressLine: '1 Main St', unit: null, city: 'Dallas', state: 'TX', zip: '75201', country: 'US', housing: null, monthlyRent: null, monthsAtAddress: null }],
    }),
    borrower('c1', 'Maya', 'co_borrower'),
  ],
  assets: [],
  liabilities: [{ id: 'l1', loanId: 'L', contactId: 'p1', isJoint: false, liabilityType: 'revolving', creditorName: 'Chase', accountLast4: null, unpaidBalance: 900, monthlyPayment: 35, monthsRemaining: null, toBePaidOff: false, description: null }],
}
const input = { app, loan, isPurchase: true, today: '2026-11-19' }

describe('AI Fill math (app code, not the AI)', () => {
  it('hourly pay matches the Income tab: $14.80 × 40 = $2,565.33/mo', () => {
    expect(monthlyPay(14.8, 'hourly', 40)).toBe(2565.33)
    expect(monthlyPay(62000, 'annual', null)).toBeCloseTo(5166.67, 2)
    expect(monthlyPay(14.8, 'hourly', null)).toBeNull()
  })

  it('time on the job becomes a start date and words', () => {
    expect(startDateFrom('2026-11-19', 2)).toBe('2024-11-01')
    expect(startDateFrom('2026-01-05', 1.5)).toBe('2024-07-01')
    expect(tenure(2)).toBe('2 yrs')
    expect(tenure(1.5)).toBe('1 yr 6 mo')
  })
})

describe('planning the fill', () => {
  const facts = [
    fact('person.maritalStatus', 'married'),
    fact('person.dependentsCount', 2),
    fact('job.employerName', 'Excel Mobile', { record: 'job1' }),
    fact('job.payRate', 14.8, { record: 'job1' }),
    fact('job.payFrequency', 'hourly', { record: 'job1' }),
    fact('job.hoursPerWeek', 40, { record: 'job1' }),
    fact('job.yearsOnJob', 2, { record: 'job1' }),
    fact('job.employerName', 'Baylor Scott & White', { record: 'job2', contactId: 'c1' }),
    fact('job.payRate', 62000, { record: 'job2', contactId: 'c1' }),
    fact('job.payFrequency', 'annual', { record: 'job2', contactId: 'c1' }),
    fact('liability.description', 'Auto loan', { record: 'debt1' }),
    fact('liability.liabilityType', 'installment', { record: 'debt1' }),
    fact('liability.monthlyPayment', 480, { record: 'debt1' }),
    fact('liability.unpaidBalance', 12000, { record: 'debt1' }),
    fact('liability.unpaidBalance', 1200, { record: 'existing:l1' }),
    fact('asset.assetType', 'checking', { record: 'acct1' }),
    fact('asset.institutionName', 'Chase', { record: 'acct1' }),
    fact('address.housing', 'rent'),
    fact('address.monthlyRent', 1350),
    fact('address.yearsAtAddress', 3),
    fact('loan.purchasePrice', 250000),
    fact('loan.mortgageType', 'fha'),
    fact('loan.downPaymentPct', 3.5),
    fact('property.city', 'Fort Worth'),
    fact('declarations.bankruptcyPast7Years', false),
    fact('loan.occupancy', 'primary'),
  ]
  const plan = planFill(facts, input)
  const fieldsOf = (kind: FieldChange['target']['kind']) => plan.changes.filter((c): c is FieldChange => c.kind === 'field' && c.target.kind === kind)
  const newRows = plan.changes.filter((c): c is NewRow => c.kind === 'new_row')

  it('adds a job with base income worked out in code and a start date', () => {
    const job = newRows.find((r) => r.values.employerName === 'Excel Mobile')!
    expect(job).toMatchObject({ table: 'employments', contactId: 'p1', values: { contactId: 'p1', employerName: 'Excel Mobile', startDate: '2024-11-01', baseIncome: 2565.33, status: 'current' } })
    expect(job.display).toBe('Excel Mobile · 2 yrs · $14.80/hr × 40 = $2,565.33/mo')
    const maya = newRows.find((r) => r.contactId === 'c1')!
    expect(maya.values.baseIncome).toBeCloseTo(5166.67, 2)
  })

  it('adds a debt with what was said, leaving the rest blank', () => {
    const debt = newRows.find((r) => r.table === 'liabilities')!
    expect(debt.values).toEqual({ contactId: 'p1', description: 'Auto loan', liabilityType: 'installment', unpaidBalance: 12000, monthlyPayment: 480 })
    expect(debt.display).toBe('Auto loan · $12,000 bal · $480/mo')
  })

  it("doesn't add an account with no balance: it goes to the notes", () => {
    expect(newRows.some((r) => r.table === 'assets')).toBe(false)
    expect(plan.toNotes.some((x) => x.text.includes('Checking · Chase') && x.text.includes('no balance'))).toBe(true)
  })

  it('fills empty fields and flags different ones as conflicts, never silently', () => {
    expect(fieldsOf('person').map((c) => [c.label, c.after, c.conflict])).toEqual([
      ['Marital status', 'married', false],
      ['Dependents', 2, false],
    ])
    const balance = fieldsOf('row')[0]
    expect(balance).toMatchObject({ target: { table: 'liabilities', rowId: 'l1', field: 'unpaidBalance' }, before: 900, after: 1200, conflict: true, beforeDisplay: '$900' })
  })

  it('works out the loan amount from the price and down payment, and skips values already the same', () => {
    const loanFields = fieldsOf('loan')
    expect(loanFields.map((c) => c.target.kind === 'loan' && c.target.field)).toEqual(['purchasePrice', 'mortgageType', 'loanAmount'])
    expect(loanFields[2]).toMatchObject({ after: 241250, display: '$241,250 ($250,000 − 3.5% down)' })
  })

  it('fills the current address, turning years into months', () => {
    expect(fieldsOf('address').map((c) => [c.target.kind === 'address' && c.target.field, c.after])).toEqual([
      ['housing', 'rent'],
      ['monthlyRent', 1350],
      ['monthsAtAddress', 36],
    ])
  })

  it('keeps where they want to buy in the notes for now, and fills declarations', () => {
    expect(plan.toNotes.some((x) => x.text.includes('Fort Worth'))).toBe(true)
    expect(fieldsOf('declaration')[0]).toMatchObject({ after: false, display: 'No' })
  })

  it('counts filled fields and sections (new rows count each field)', () => {
    const s = fillSummary(plan.changes.filter((c) => c.kind === 'new_row' || !c.conflict))
    expect(s.sections).toBe(5)
    expect(s.fields).toBeGreaterThan(15)
  })

  it('sends housing to the notes when there is no current address yet', () => {
    const p = planFill([fact('address.monthlyRent', 1350, { contactId: 'c1' })], input)
    expect(p.changes).toEqual([])
    expect(p.toNotes[0].text).toContain('no address on the 1003 yet')
  })
})
