// The borrower application (Stage 5; plan docs/plans/borrower-application.md):
// its steps, the answers' shape, the checks on each step, what lead intake
// gets, and the drafted thank-you. Pure, with no imports, so the apply Edge
// Function (Deno), the public page, MPS-HQ and the tests share it.
//
// Rules: no Social Security number anywhere (refused by pattern); account
// numbers last 4 only; date of birth is asked here (the 1003 needs it) but
// never on Pages. Nothing is sent from here: the thank-you is a draft.

export const APPLICATION_VERSION = 'application v2'
/** The credit authorization wording version saved with the consent. COMPLIANCE: placeholder wording, subject to Connor's review. */
export const CREDIT_AUTH_VERSION = 'credit-auth v1 (placeholder)'
export const CREDIT_AUTH_TEXT =
  'I authorize MPS Mortgage LLC and its partners to obtain my credit report and verify the information in this application, including my employment, income and assets, for the purpose of evaluating my mortgage loan request. I confirm the information I provided is true and complete to the best of my knowledge.'

export type StepId = 'you' | 'co_borrower' | 'home' | 'homes' | 'work' | 'co_work' | 'assets' | 'debts' | 'loan' | 'declarations' | 'review'

export const STEPS: readonly { id: StepId; label: string }[] = [
  { id: 'you', label: 'About you' },
  { id: 'co_borrower', label: 'Co-borrower' },
  { id: 'home', label: 'Where you live' },
  { id: 'homes', label: 'Other homes you own' },
  { id: 'work', label: 'Work and income' },
  { id: 'co_work', label: "Co-borrower's work" },
  { id: 'assets', label: 'Accounts and assets' },
  { id: 'debts', label: 'Debts' },
  { id: 'loan', label: 'The loan' },
  { id: 'declarations', label: 'A few questions' },
  { id: 'review', label: 'Review and submit' },
]

/** The steps this application shows (the co-borrower's work only when there is one). */
export const stepsFor = (a: ApplicationAnswers) => STEPS.filter((s) => s.id !== 'co_work' || a.hasCoBorrower)

export type Citizenship = 'us_citizen' | 'permanent_resident_alien' | 'non_permanent_resident_alien'
export type Marital = 'married' | 'separated' | 'unmarried'
export type Housing = 'own' | 'rent' | 'no_primary_expense'
export type Purpose = 'purchase' | 'refinance_rate_term' | 'refinance_cash_out'
export type Occupancy = 'primary' | 'second_home' | 'investment'
export type AssetKind = 'checking' | 'savings' | 'retirement' | 'stocks' | 'gift_cash' | 'other_liquid'
export type DebtKind = 'revolving' | 'installment' | 'lease' | 'child_support' | 'alimony' | 'other'
export type OtherIncomeKind = 'social_security' | 'retirement' | 'disability' | 'child_support' | 'alimony' | 'va_compensation' | 'other'
export type Owner = 'borrower' | 'co'
/** W-2 employee, 1099 contractor, own business, or school (school only explains the history; it has no income). */
export type JobKind = 'w2' | '1099' | 'self_employed' | 'school'
/** How a W-2 job pays: a yearly salary, by the hour, or a monthly figure they know. */
export type PayType = 'salary' | 'hourly' | 'monthly'
export type HomeUse = 'second_home' | 'investment'

export interface Person {
  firstName: string
  lastName: string
  email: string
  phone: string
  /** YYYY-MM-DD. */
  dateOfBirth: string
  maritalStatus: Marital | ''
  dependents: number | null
  citizenship: Citizenship | ''
  military: boolean | null
}

/** A home they own: its value, the mortgage (if any) and its costs. */
export interface HomeMoney {
  value: number | null
  hasMortgage: boolean | null
  mortgageBalance: number | null
  mortgagePayment: number | null
  /** The payment already includes taxes and insurance (escrowed). When false or there's no mortgage, taxes and insurance are asked. */
  paymentIncludesEscrow: boolean | null
  annualTaxes: number | null
  annualInsurance: number | null
  monthlyHoa: number | null
  /** They plan to sell it. */
  selling: boolean | null
}

export interface Address {
  line: string
  unit: string
  city: string
  state: string
  zip: string
  housing: Housing | ''
  monthlyRent: number | null
  /** Years and months at this address. */
  years: number | null
  months: number | null
  /** Only for the current home when they own it. */
  owned: HomeMoney
}

/** Another home they own (not where they live). */
export interface OwnedHome extends HomeMoney {
  line: string
  unit: string
  city: string
  state: string
  zip: string
  use: HomeUse | ''
  /** A rental's rent a month. */
  monthlyRent: number | null
}

export interface Job {
  kind: JobKind
  /** The employer, business, or school. */
  employer: string
  /** Title, or field of study for school. */
  title: string
  /** True for 1099 and own business (worked out from kind). */
  selfEmployed: boolean
  current: boolean
  /** YYYY-MM-DD. */
  startDate: string
  endDate: string
  /** W-2 pay. */
  payType: PayType
  annualSalary: number | null
  hourlyRate: number | null
  hoursPerWeek: number | null
  /** Base pay a month before taxes: typed for payType monthly, else worked out (jobIncome). For 1099 / own business, the net a month. */
  monthlyIncome: number | null
  /** W-2 extras over the last 12 months (a year). */
  overtimeYearly: number | null
  bonusYearly: number | null
  commissionYearly: number | null
  /** 1099 / own business: net income on last year's taxes. */
  netYearly: number | null
  /** Own business: their share, 0–100. */
  ownershipPct: number | null
}

export interface OtherIncome {
  kind: OtherIncomeKind
  monthly: number | null
}

export interface Asset {
  owner: Owner
  kind: AssetKind
  institution: string
  /** Last 4 digits only. */
  last4: string
  amount: number | null
}

export interface Debt {
  owner: Owner
  kind: DebtKind
  creditor: string
  monthlyPayment: number | null
  balance: number | null
}

export const DECLARATIONS = [
  { key: 'willOccupyAsPrimary', label: 'Will you live in this home as your primary residence?' },
  { key: 'ownedPropertyPast3Years', label: 'Have you owned a home in the last 3 years?' },
  { key: 'outstandingJudgments', label: 'Are there any outstanding judgments against you?' },
  { key: 'delinquentFederalDebt', label: 'Are you behind on any federal debt (taxes, student loans)?' },
  { key: 'partyToLawsuit', label: 'Are you a party to a lawsuit with a financial obligation?' },
  { key: 'bankruptcyPast7Years', label: 'Have you declared bankruptcy in the last 7 years?' },
  { key: 'foreclosurePast7Years', label: 'Have you had a foreclosure in the last 7 years?' },
  { key: 'shortSalePast7Years', label: 'Have you had a short sale or deed in lieu in the last 7 years?' },
  { key: 'cosignerOrGuarantor', label: 'Are you a co-signer or guarantor on any debt not listed?' },
  { key: 'borrowingUndisclosedMoney', label: 'Are you borrowing any money for this purchase that you have not listed?' },
] as const
export type DeclarationKey = (typeof DECLARATIONS)[number]['key']
export type Declarations = Partial<Record<DeclarationKey, boolean | null>>

export interface LoanWanted {
  purpose: Purpose | ''
  occupancy: Occupancy | ''
  /** Purchase: the price they're looking at. Refinance: the home's estimated value. */
  price: number | null
  downMode: 'amount' | 'percent'
  down: number | null
  /** Refinance: what they owe now and any cash out. */
  balance: number | null
  cashOut: number | null
  state: string
  timeline: string
  /** Estimated credit score range low end (e.g. 680), optional. */
  creditScore: number | null
}

export interface ApplicationAnswers {
  version: string
  borrower: Person
  hasCoBorrower: boolean
  coBorrower: Person
  coSameAddress: boolean
  address: Address
  /** Only when they've been at the current address under 2 years. */
  previousAddress: Address
  ownsOtherHomes: boolean | null
  otherHomes: OwnedHome[]
  jobs: Job[]
  otherIncome: OtherIncome[]
  coJobs: Job[]
  coOtherIncome: OtherIncome[]
  assets: Asset[]
  debts: Debt[]
  loan: LoanWanted
  declarations: Declarations
  coDeclarations: Declarations
  textsOk: boolean
  creditAuthorized: boolean
}

const blankPerson = (): Person => ({ firstName: '', lastName: '', email: '', phone: '', dateOfBirth: '', maritalStatus: '', dependents: null, citizenship: '', military: null })
export const blankHomeMoney = (): HomeMoney => ({ value: null, hasMortgage: null, mortgageBalance: null, mortgagePayment: null, paymentIncludesEscrow: null, annualTaxes: null, annualInsurance: null, monthlyHoa: null, selling: null })
const blankAddress = (): Address => ({ line: '', unit: '', city: '', state: 'TX', zip: '', housing: '', monthlyRent: null, years: null, months: null, owned: blankHomeMoney() })
export const blankOwnedHome = (): OwnedHome => ({ ...blankHomeMoney(), line: '', unit: '', city: '', state: 'TX', zip: '', use: '', monthlyRent: null })
export const blankJob = (current = true): Job => ({
  kind: 'w2',
  employer: '',
  title: '',
  selfEmployed: false,
  current,
  startDate: '',
  endDate: '',
  payType: 'salary',
  annualSalary: null,
  hourlyRate: null,
  hoursPerWeek: null,
  monthlyIncome: null,
  overtimeYearly: null,
  bonusYearly: null,
  commissionYearly: null,
  netYearly: null,
  ownershipPct: null,
})

export function blankAnswers(): ApplicationAnswers {
  return {
    version: APPLICATION_VERSION,
    borrower: blankPerson(),
    hasCoBorrower: false,
    coBorrower: blankPerson(),
    coSameAddress: true,
    address: blankAddress(),
    previousAddress: blankAddress(),
    ownsOtherHomes: null,
    otherHomes: [],
    jobs: [blankJob()],
    otherIncome: [],
    coJobs: [blankJob()],
    coOtherIncome: [],
    assets: [],
    debts: [],
    loan: { purpose: '', occupancy: 'primary', price: null, downMode: 'percent', down: null, balance: null, cashOut: null, state: 'TX', timeline: '', creditScore: null },
    declarations: {},
    coDeclarations: {},
    textsOk: false,
    creditAuthorized: false,
  }
}

// ---------------------------------------------------------------------------
// Income: each job's monthly figures, worked out from how it pays
// ---------------------------------------------------------------------------

const r2 = (n: number) => Math.round(n * 100) / 100
const num = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? n : null)

/** Monthly income from one job: W-2 base (salary / 12, rate × hours × 52 / 12, or the monthly figure), extras / 12; 1099 and own business = last year's net / 12; school = none. */
export function jobIncome(j: Job): { base: number | null; overtime: number | null; bonus: number | null; commission: number | null; selfEmployed: number | null } {
  const none = { base: null, overtime: null, bonus: null, commission: null, selfEmployed: null }
  if (j.kind === 'school') return none
  if (j.kind === '1099' || j.kind === 'self_employed') {
    const net = num(j.netYearly)
    return { ...none, selfEmployed: net == null ? null : r2(net / 12) }
  }
  const salary = num(j.annualSalary)
  const rate = num(j.hourlyRate)
  const hours = num(j.hoursPerWeek)
  const base = j.payType === 'salary' ? (salary == null ? null : r2(salary / 12)) : j.payType === 'hourly' ? (rate == null || hours == null ? null : r2((rate * hours * 52) / 12)) : num(j.monthlyIncome)
  const m = (y: number | null) => {
    const v = num(y)
    return v ? r2(v / 12) : null
  }
  return { base, overtime: m(j.overtimeYearly), bonus: m(j.bonusYearly), commission: m(j.commissionYearly), selfEmployed: null }
}

/** Total income a month from a job (all parts). */
export function jobMonthlyTotal(j: Job): number {
  const x = jobIncome(j)
  return r2((x.base ?? 0) + (x.overtime ?? 0) + (x.bonus ?? 0) + (x.commission ?? 0) + (x.selfEmployed ?? 0))
}

/** A job in the shape this version expects, with selfEmployed and monthlyIncome worked out (older answers fill in with defaults). */
export function normalizeJob(raw: Partial<Job>): Job {
  const j = { ...blankJob(raw.current !== false), ...raw } as Job
  if (!['w2', '1099', 'self_employed', 'school'].includes(raw.kind ?? '')) j.kind = raw.selfEmployed ? 'self_employed' : 'w2'
  if (!['salary', 'hourly', 'monthly'].includes(raw.payType ?? '')) j.payType = raw.monthlyIncome != null && raw.annualSalary == null ? 'monthly' : 'salary'
  j.selfEmployed = j.kind === '1099' || j.kind === 'self_employed'
  const x = jobIncome(j)
  j.monthlyIncome = j.kind === 'school' ? null : j.selfEmployed ? x.selfEmployed : x.base
  if (j.kind !== 'self_employed') j.ownershipPct = null
  return j
}

/** Answers in the shape this version expects: every field present, jobs and homes filled in. */
export function normalizeAnswers(raw: Partial<ApplicationAnswers>): ApplicationAnswers {
  const base = blankAnswers()
  const a = { ...base, ...raw } as ApplicationAnswers
  const addr = (x: Partial<Address> | undefined): Address => ({ ...base.address, ...(x ?? {}), owned: { ...blankHomeMoney(), ...(x?.owned ?? {}) } })
  a.address = addr(raw.address)
  a.previousAddress = addr(raw.previousAddress)
  a.jobs = (Array.isArray(raw.jobs) ? raw.jobs : base.jobs).map(normalizeJob)
  a.coJobs = (Array.isArray(raw.coJobs) ? raw.coJobs : base.coJobs).map(normalizeJob)
  a.otherHomes = (Array.isArray(raw.otherHomes) ? raw.otherHomes : []).map((h) => ({ ...blankOwnedHome(), ...h }))
  return a
}

/** A job slot nobody filled in (left out of the checks and the 1003). */
export const isBlankJob = (j: Job) => !j.employer.trim() && !j.startDate && !j.endDate && !j.title.trim()

/**
 * Adds an empty previous-job slot when the jobs they've dated cover under 2
 * years and there's no empty slot yet, so the next one is ready to fill in.
 * Gaps are fine: they can go on with less than 2 years.
 */
export function withHistorySlot(jobs: Job[], today: string): Job[] {
  const filled = jobs.filter((j) => !isBlankJob(j))
  if (!filled.length || filled.some((j) => !ISO.test(j.startDate)) || jobs.some(isBlankJob)) return jobs
  return historyMonths(filled, today) < 24 ? [...jobs, blankJob(false)] : jobs
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

const SSN = /\b\d{3}-?\d{2}-?\d{4}\b/
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ISO = /^\d{4}-\d{2}-\d{2}$/
const digits = (s: string) => s.replace(/\D/g, '')

/** Every typed text in the answers, to look for a Social Security number. */
function texts(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v)
  else if (Array.isArray(v)) for (const x of v) texts(x, out)
  else if (v && typeof v === 'object') for (const x of Object.values(v)) texts(x, out)
  return out
}

/** True when any answer looks like a Social Security number (a phone number with its 10 digits is fine). */
export function hasSsn(a: unknown): boolean {
  return texts(a).some((t) => SSN.test(t) && digits(t).length !== 10)
}

/** Whole months between two dates (YYYY-MM-DD), from start to end. */
export function monthsBetween(start: string, end: string): number {
  const [y1, m1] = start.split('-').map(Number)
  const [y2, m2] = end.split('-').map(Number)
  return Math.max(0, (y2 - y1) * 12 + (m2 - m1))
}

/** Months of work history the jobs cover (overlaps not double-counted is not needed for the check; the earliest start to today is). */
export function historyMonths(jobs: Job[], today: string): number {
  const starts = jobs.filter((j) => ISO.test(j.startDate)).map((j) => j.startDate)
  if (starts.length === 0) return 0
  return monthsBetween(starts.sort()[0], today)
}

function personProblems(p: Person, who: string, today: string): string[] {
  const out: string[] = []
  if (!p.firstName.trim() || !p.lastName.trim()) out.push(`Enter ${who} first and last name.`)
  if (!EMAIL.test(p.email.trim())) out.push(`Enter ${who} email.`)
  if (digits(p.phone).length !== 10) out.push(`Enter ${who} 10-digit phone number.`)
  if (!ISO.test(p.dateOfBirth) || p.dateOfBirth > today || monthsBetween(p.dateOfBirth, today) < 18 * 12) out.push(`Enter ${who} date of birth (18 or older).`)
  if (!p.citizenship) out.push(`Pick ${who} citizenship.`)
  if (!p.maritalStatus) out.push(`Pick ${who} marital status.`)
  return out
}

function jobProblems(jobs: Job[], other: OtherIncome[], who: string, today: string): string[] {
  const out: string[] = []
  const filled = jobs.filter((j) => !isBlankJob(j))
  if (!filled.length && !other.some((o) => o.monthly != null)) out.push(`Add ${who} current job, school, or other income.`)
  filled.forEach((j, i) => {
    const n = filled.length > 1 ? ` (${j.kind === 'school' ? 'school' : 'job'} ${i + 1})` : ''
    if (!j.employer.trim()) out.push(j.kind === 'school' ? `Enter the school${n}.` : j.kind === 'self_employed' ? `Enter the business name${n}.` : `Enter the employer${n}.`)
    if (!ISO.test(j.startDate) || j.startDate > today) out.push(`Enter the start date${n}.`)
    if (!j.current && (!ISO.test(j.endDate) || j.endDate < j.startDate)) out.push(`Enter the end date${n}.`)
    if (j.kind === 'self_employed' && (j.ownershipPct == null || j.ownershipPct <= 0 || j.ownershipPct > 100)) out.push(`Enter your ownership share, 1 to 100%${n}.`)
    if (!j.current || j.kind === 'school') return
    if (j.kind === 'w2') {
      if (j.payType === 'salary' && !j.annualSalary) out.push(`Enter the yearly salary${n}.`)
      if (j.payType === 'hourly' && (!j.hourlyRate || !j.hoursPerWeek)) out.push(`Enter the hourly rate and hours a week${n}.`)
      if (j.payType === 'monthly' && (j.monthlyIncome == null || j.monthlyIncome < 0)) out.push(`Enter the monthly pay before taxes${n}.`)
      if (j.hoursPerWeek != null && (j.hoursPerWeek <= 0 || j.hoursPerWeek > 100)) out.push(`Hours a week should be 1 to 100${n}.`)
    } else if (j.netYearly == null) out.push(`Enter the net income on last year's taxes (0 if none yet)${n}.`)
  })
  return out
}

/** A friendly note (never blocking) when the dated jobs cover under 2 years. */
export function historyNote(jobs: Job[], today: string): string | null {
  const filled = jobs.filter((j) => !isBlankJob(j) && ISO.test(j.startDate))
  if (!filled.length) return null
  const m = historyMonths(filled, today)
  if (m >= 24) return null
  const yrs = Math.floor(m / 12)
  return `These dates cover ${yrs ? `${yrs} yr ` : ''}${m % 12} mo. We look at the last 2 years, so add a previous job or school if you had one. A gap is fine; you can continue.`
}

/** What's missing about a home they own. */
function homeMoneyProblems(h: HomeMoney, n: string): string[] {
  const out: string[] = []
  if (!h.value) out.push(`Enter the home's estimated value${n}.`)
  if (h.hasMortgage == null) out.push(`Is there a mortgage on it${n}?`)
  if (h.hasMortgage) {
    if (h.mortgageBalance == null) out.push(`Enter the mortgage balance${n}.`)
    if (!h.mortgagePayment) out.push(`Enter the monthly mortgage payment${n}.`)
    if (h.paymentIncludesEscrow == null) out.push(`Does the payment include taxes and insurance${n}?`)
  }
  if (h.hasMortgage === false || h.paymentIncludesEscrow === false) {
    if (h.annualTaxes == null) out.push(`Enter the property taxes a year${n}.`)
    if (h.annualInsurance == null) out.push(`Enter the home insurance a year${n}.`)
  }
  if (h.selling == null) out.push(`Do you plan to sell it${n}?`)
  return out
}

/** What's missing or wrong on one step (empty = fine). `today` is YYYY-MM-DD. */
export function stepProblems(step: StepId, a: ApplicationAnswers, today: string): string[] {
  if (hasSsn(a)) return ["Please don't enter a Social Security number. We'll ask for it securely later."]
  switch (step) {
    case 'you':
      return personProblems(a.borrower, 'your', today)
    case 'co_borrower':
      return a.hasCoBorrower ? personProblems(a.coBorrower, "your co-borrower's", today) : []
    case 'home': {
      const out: string[] = []
      if (!a.address.line.trim() || !a.address.city.trim() || !/^[A-Za-z]{2}$/.test(a.address.state) || !/^\d{5}$/.test(a.address.zip)) out.push('Enter your full current address.')
      if (!a.address.housing) out.push('Pick whether you own, rent or live rent-free.')
      if (a.address.housing === 'rent' && !a.address.monthlyRent) out.push('Enter your monthly rent.')
      if (a.address.years == null) out.push('Enter how long you have lived there.')
      if (a.address.years != null && a.address.years < 2 && (!a.previousAddress.line.trim() || !a.previousAddress.city.trim())) out.push('Under 2 years at this address: add your previous address.')
      if (a.address.housing === 'own') out.push(...homeMoneyProblems(a.address.owned, ''))
      return out
    }
    case 'homes': {
      if (a.ownsOtherHomes == null) return ['Do you own any other homes? Pick Yes or No.']
      if (!a.ownsOtherHomes) return []
      if (!a.otherHomes.length) return ['Add the homes you own, or pick No.']
      return a.otherHomes.flatMap((h, i) => {
        const n = ` (home ${i + 1})`
        return [
          ...(!h.line.trim() || !h.city.trim() || !/^[A-Za-z]{2}$/.test(h.state) ? [`Enter the address${n}.`] : []),
          ...(!h.use ? [`Pick whether it's a second home or a rental${n}.`] : []),
          ...(h.use === 'investment' && h.monthlyRent == null ? [`Enter the monthly rent${n} (0 if it's empty).`] : []),
          ...homeMoneyProblems(h, n),
        ]
      })
    }
    case 'work':
      return jobProblems(a.jobs, a.otherIncome, 'your', today)
    case 'co_work':
      return a.hasCoBorrower ? jobProblems(a.coJobs, a.coOtherIncome, "your co-borrower's", today) : []
    case 'assets':
      return a.assets.flatMap((x, i) => [
        ...(x.amount == null ? [`Enter the balance (account ${i + 1}).`] : []),
        ...(x.last4 && !/^\d{4}$/.test(x.last4) ? [`Use only the last 4 digits of the account (account ${i + 1}).`] : []),
      ])
    case 'debts':
      return a.debts.flatMap((d, i) => (d.monthlyPayment == null ? [`Enter the monthly payment (debt ${i + 1}).`] : []))
    case 'loan': {
      const l = a.loan
      const out: string[] = []
      if (!l.purpose) out.push('Pick what the loan is for.')
      if (!l.occupancy) out.push('Pick how you will use the home.')
      if (!l.price) out.push(l.purpose === 'purchase' ? 'Enter the price you are looking at.' : "Enter the home's estimated value.")
      if (l.purpose !== 'purchase' && l.purpose && l.balance == null) out.push('Enter what you owe on the home now (0 if nothing).')
      if (!/^[A-Za-z]{2}$/.test(l.state)) out.push('Enter the state of the home.')
      return out
    }
    case 'declarations':
      return DECLARATIONS.some((d) => a.declarations[d.key] == null) ? ['Please answer every question.'] : []
    case 'review':
      return a.creditAuthorized ? [] : ['Check the box to authorize the credit check.']
  }
}

/** Every step's problems, for submit. */
export const submitProblems = (a: ApplicationAnswers, today: string) => stepsFor(a).flatMap((s) => stepProblems(s.id, a, today))

// ---------------------------------------------------------------------------
// Lead intake (the website path's payload) and the thank-you draft
// ---------------------------------------------------------------------------

/** What intake_web_lead() gets for a standalone application. */
export function intakePayload(a: ApplicationAnswers, applicationId: string, assignedToEmail: string | null) {
  const l = a.loan
  const down = l.price && l.down != null ? (l.downMode === 'percent' ? Math.round(l.price * l.down) / 100 : l.down) : null
  return {
    kind: 'lead',
    form_type: 'application',
    source: 'Application',
    external_id: `application:${applicationId}`,
    first_name: a.borrower.firstName.trim(),
    last_name: a.borrower.lastName.trim(),
    email: a.borrower.email.trim().toLowerCase(),
    phone: digits(a.borrower.phone),
    purpose: l.purpose || 'purchase',
    purchase_price: l.purpose === 'purchase' ? l.price : null,
    down_payment: l.purpose === 'purchase' ? down : null,
    cash_out: l.purpose === 'refinance_cash_out' ? l.cashOut : null,
    credit_score: l.creditScore,
    timeline: l.timeline || null,
    sms_consent: a.textsOk ? 'true' : 'false',
    assigned_to_email: assignedToEmail,
    answers: { application: applicationId, purpose: l.purpose, price: l.price, state: l.state },
  }
}

/** The thank-you text and email, drafted for the loan officer's approval (never sent on their own). */
export function thankYouDrafts(firstName: string, loName: string) {
  const me = loName.split(/\s+/)[0] || loName
  return {
    text: `Hi ${firstName}, this is ${me} with MPS Mortgage. Thank you for completing your application! I'm reviewing it now and will reach out with next steps shortly.`,
    subject: 'We received your application',
    email: [
      `Hi ${firstName},`,
      '',
      "Thank you for completing your mortgage application. I'm reviewing it now and will reach out shortly with next steps, including any documents I'll need.",
      '',
      'If you have any questions in the meantime, just reply to this email.',
      '',
      'Thanks,',
      loName,
    ].join('\n'),
  }
}
