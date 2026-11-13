import { describe, expect, it } from 'vitest'
import { blankAnswers, blankJob, blankOwnedHome, hasSsn, historyMonths, historyNote, intakePayload, jobIncome, normalizeAnswers, normalizeJob, stepProblems, stepsFor, submitProblems, thankYouDrafts, withHistorySlot, type ApplicationAnswers } from './form'

const today = '2026-11-13'

function filled(): ApplicationAnswers {
  const a = blankAnswers()
  a.borrower = { firstName: 'Pat', lastName: 'TEST', email: 'pat@example.test', phone: '(214) 555-0150', dateOfBirth: '1990-05-01', maritalStatus: 'married', dependents: 1, citizenship: 'us_citizen', military: false }
  a.address = { ...a.address, line: '1 Main St', unit: '', city: 'Dallas', state: 'TX', zip: '75201', housing: 'rent', monthlyRent: 1800, years: 3, months: 0 }
  a.ownsOtherHomes = false
  a.jobs = [{ ...blankJob(), employer: 'Excel', title: 'Analyst', startDate: '2023-06-15', annualSalary: 78000 }]
  a.assets = [{ owner: 'borrower', kind: 'checking', institution: 'Chase', last4: '1234', amount: 20000 }]
  a.loan = { purpose: 'purchase', occupancy: 'primary', price: 400000, downMode: 'percent', down: 5, balance: null, cashOut: null, state: 'TX', timeline: '1-3 months', creditScore: 700 }
  for (const k of ['willOccupyAsPrimary', 'ownedPropertyPast3Years', 'outstandingJudgments', 'delinquentFederalDebt', 'partyToLawsuit', 'bankruptcyPast7Years', 'foreclosurePast7Years', 'shortSalePast7Years', 'cosignerOrGuarantor', 'borrowingUndisclosedMoney'] as const) a.declarations[k] = k === 'willOccupyAsPrimary'
  a.creditAuthorized = true
  return a
}

describe('the borrower application', () => {
  it('a complete application has no problems', () => {
    expect(submitProblems(filled(), today)).toEqual([])
  })
  it("the co-borrower's work step only shows with a co-borrower", () => {
    expect(stepsFor(filled()).map((s) => s.id)).not.toContain('co_work')
    expect(stepsFor({ ...filled(), hasCoBorrower: true }).map((s) => s.id)).toContain('co_work')
  })
  it('never accepts a Social Security number (a phone number is fine)', () => {
    expect(hasSsn(filled())).toBe(false)
    const a = filled()
    a.jobs[0].title = 'my ssn is 123-45-6789'
    expect(hasSsn(a)).toBe(true)
    expect(stepProblems('you', a, today)).toEqual(["Please don't enter a Social Security number. We'll ask for it securely later."])
  })
  it('under 2 years of work is a note, not a stop; an empty previous-job slot is added', () => {
    const a = filled()
    a.jobs[0].startDate = '2025-08-01'
    expect(historyMonths(a.jobs, today)).toBe(15)
    expect(stepProblems('work', a, today)).toEqual([])
    expect(historyNote(a.jobs, today)).toMatch(/^These dates cover 1 yr 3 mo\./)
    const slots = withHistorySlot(a.jobs, today)
    expect(slots).toHaveLength(2)
    expect(slots[1].current).toBe(false)
    // The empty slot is ignored by the checks and isn't added twice.
    expect(stepProblems('work', { ...a, jobs: slots }, today)).toEqual([])
    expect(withHistorySlot(slots, today)).toBe(slots)
    // School covers the rest, with a gap: fine.
    const school = [...a.jobs, { ...blankJob(false), kind: 'school' as const, employer: 'UNT', startDate: '2021-08-20', endDate: '2025-05-10' }]
    expect(historyNote(school, today)).toBeNull()
    expect(withHistorySlot(school, today)).toBe(school)
  })
  it('W-2 pay: salary, hourly with overtime and bonus, or a monthly figure; 1099 and own business use last year\'s net', () => {
    expect(jobIncome({ ...blankJob(), annualSalary: 78000 }).base).toBe(6500)
    expect(jobIncome({ ...blankJob(), payType: 'hourly', hourlyRate: 25, hoursPerWeek: 40, overtimeYearly: 6000, bonusYearly: 2400 })).toEqual({ base: 4333.33, overtime: 500, bonus: 200, commission: null, selfEmployed: null })
    expect(normalizeJob({ ...blankJob(), payType: 'monthly', monthlyIncome: 5000 }).monthlyIncome).toBe(5000)
    expect(normalizeJob({ ...blankJob(), kind: '1099', netYearly: 60000 })).toMatchObject({ selfEmployed: true, monthlyIncome: 5000 })
    expect(normalizeJob({ ...blankJob(), kind: 'school', annualSalary: 1000 }).monthlyIncome).toBeNull()
    const a = filled()
    a.jobs[0] = { ...a.jobs[0], kind: 'self_employed', netYearly: 90000, ownershipPct: null }
    expect(stepProblems('work', a, today)).toEqual(['Enter your ownership share, 1 to 100%.'])
    a.jobs[0].ownershipPct = 50
    expect(stepProblems('work', a, today)).toEqual([])
    const h = filled()
    h.jobs[0] = { ...h.jobs[0], payType: 'hourly', annualSalary: null, hourlyRate: 25, hoursPerWeek: null }
    expect(stepProblems('work', h, today)).toEqual(['Enter the hourly rate and hours a week.'])
  })
  it('no job is fine with other income (retired)', () => {
    const a = filled()
    a.jobs = [blankJob()]
    expect(stepProblems('work', a, today)).toEqual(['Add your current job, school, or other income.'])
    a.otherIncome = [{ kind: 'social_security', monthly: 2100 }]
    expect(stepProblems('work', a, today)).toEqual([])
  })
  it('owning where they live asks about the mortgage; a payment without taxes and insurance asks for them', () => {
    const a = filled()
    a.address.housing = 'own'
    a.address.monthlyRent = null
    expect(stepProblems('home', a, today)).toEqual(["Enter the home's estimated value.", 'Is there a mortgage on it?', 'Do you plan to sell it?'])
    a.address.owned = { ...a.address.owned, value: 350000, hasMortgage: true, mortgageBalance: 210000, mortgagePayment: 1450, paymentIncludesEscrow: false, selling: false }
    expect(stepProblems('home', a, today)).toEqual(['Enter the property taxes a year.', 'Enter the home insurance a year.'])
    a.address.owned.paymentIncludesEscrow = true
    expect(stepProblems('home', a, today)).toEqual([])
  })
  it('other homes: every home they own, rentals with their rent', () => {
    const a = filled()
    a.ownsOtherHomes = null
    expect(stepProblems('homes', a, today)).toEqual(['Do you own any other homes? Pick Yes or No.'])
    a.ownsOtherHomes = true
    expect(stepProblems('homes', a, today)).toEqual(['Add the homes you own, or pick No.'])
    a.otherHomes = [{ ...blankOwnedHome(), line: '9 Elm', city: 'Plano', use: 'investment', value: 300000, hasMortgage: false, annualTaxes: 6000, annualInsurance: 1800, selling: false }]
    expect(stepProblems('homes', a, today)).toEqual(["Enter the monthly rent (home 1) (0 if it's empty)."])
    a.otherHomes[0].monthlyRent = 2200
    expect(stepProblems('homes', a, today)).toEqual([])
  })
  it('older saved answers are filled in to this version', () => {
    const old = { ...filled(), jobs: [{ employer: 'Excel', title: '', selfEmployed: false, current: true, startDate: '2023-06-15', endDate: '', monthlyIncome: 6500 }] } as unknown as ApplicationAnswers
    delete (old as Partial<ApplicationAnswers>).otherHomes
    const n = normalizeAnswers(old)
    expect(n.jobs[0]).toMatchObject({ kind: 'w2', payType: 'monthly', monthlyIncome: 6500 })
    expect(n.otherHomes).toEqual([])
    expect(n.address.owned.hasMortgage).toBeNull()
  })
  it('under 2 years at the address needs the previous address; renters give rent', () => {
    const a = filled()
    a.address.years = 1
    a.address.monthlyRent = null
    expect(stepProblems('home', a, today)).toEqual(['Enter your monthly rent.', 'Under 2 years at this address: add your previous address.'])
  })
  it('date of birth must make them 18 or older; accounts take only the last 4', () => {
    const a = filled()
    a.borrower.dateOfBirth = '2015-01-01'
    expect(stepProblems('you', a, today)).toEqual(['Enter your date of birth (18 or older).'])
    const b = filled()
    b.assets[0].last4 = '12345'
    expect(stepProblems('assets', b, today)).toEqual(['Use only the last 4 digits of the account (account 1).'])
  })
  it('every declaration must be answered; the credit check must be authorized', () => {
    const a = filled()
    delete a.declarations.partyToLawsuit
    a.creditAuthorized = false
    expect(submitProblems(a, today)).toEqual(['Please answer every question.', 'Check the box to authorize the credit check.'])
  })
  it('lead intake gets the down payment in dollars, the text consent and the loan officer', () => {
    const p = intakePayload(filled(), 'abc', 'connor@example.test')
    expect(p).toMatchObject({ form_type: 'application', external_id: 'application:abc', phone: '2145550150', purchase_price: 400000, down_payment: 20000, sms_consent: 'false', assigned_to_email: 'connor@example.test' })
  })
  it('the thank-you is signed with the loan officer’s first name', () => {
    expect(thankYouDrafts('Pat', 'Connor Jacquart').text).toMatch(/^Hi Pat, this is Connor with MPS Mortgage\./)
  })
})
