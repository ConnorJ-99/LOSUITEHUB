import type { Property } from '@/lib/api/types'
import type { Employment } from '@/lib/api/urla'
import {
  bankStatementIncome,
  leaseIncome,
  rentalPropertyCost,
  round,
  scheduleEIncome,
  selfEmployedIncome,
  variableIncome,
  wageIncome,
  type BankStatementInput,
  type IncomeLine,
  type IncomeResult,
  type PartnershipYear,
  type PayFrequency,
  type SCorpYear,
  type ScheduleCYear,
  type ScheduleEInput,
  type VariableIncomeInput,
} from '@/lib/calc'
import { propertyNetRental } from '@/lib/urla/realEstate'

// The Income tab's worksheets: what each kind asks for, how it's calculated
// (through '@/lib/calc'), and which 1003 field "Push to 1003" fills.

export type WorksheetKind = 'salary' | 'hourly' | 'variable' | 'schedule_c' | 's_corp' | 'partnership' | 'bank_statement' | 'rental'
export type VariableType = 'overtime' | 'bonus' | 'commission'
export type SalaryFrequency = Exclude<PayFrequency, 'hourly'>

export const WORKSHEET_KINDS: readonly { value: WorksheetKind; label: string; short: string }[] = [
  { value: 'salary', label: 'Salary (W-2)', short: 'Salary' },
  { value: 'hourly', label: 'Hourly (W-2)', short: 'Hourly' },
  { value: 'variable', label: 'Overtime, bonus or commission', short: 'Variable pay' },
  { value: 'schedule_c', label: 'Self-employed: Schedule C', short: 'Schedule C' },
  { value: 's_corp', label: 'Self-employed: S corp (1120S + K-1)', short: 'S corp' },
  { value: 'partnership', label: 'Self-employed: Partnership (1065 + K-1)', short: 'Partnership' },
  { value: 'bank_statement', label: 'Bank statement', short: 'Bank statement' },
  { value: 'rental', label: 'Rental property', short: 'Rental' },
]

export const kindLabel = (kind: WorksheetKind) => WORKSHEET_KINDS.find((k) => k.value === kind)?.label ?? kind

export interface SalaryInputs {
  frequency: SalaryFrequency
  amount: number | null
}
export interface HourlyInputs {
  rate: number | null
  hoursPerWeek: number | null
}
export interface VariableInputs extends VariableIncomeInput {
  incomeType: VariableType
}
export interface SelfEmployedInputs<Y> {
  /** Tax year of the most recent return, for labels (e.g. 2025). */
  recentYear: number | null
  older: Y
  recent: Y
}
export interface RentalInputs {
  method: 'lease' | 'schedule_e'
  leaseRent: number | null
  scheduleE: ScheduleEInput
}

export interface InputsByKind {
  salary: SalaryInputs
  hourly: HourlyInputs
  variable: VariableInputs
  schedule_c: SelfEmployedInputs<ScheduleCYear>
  s_corp: SelfEmployedInputs<SCorpYear>
  partnership: SelfEmployedInputs<PartnershipYear>
  bank_statement: BankStatementInput
  rental: RentalInputs
}

/** A worksheet's kind and inputs together, so code can switch on the kind safely. */
export type WorksheetData = { [K in WorksheetKind]: { kind: K; inputs: InputsByKind[K] } }[WorksheetKind]

const blankScheduleC = (): ScheduleCYear => ({
  netProfit: null, nonrecurringIncome: null, depletion: null, depreciation: null,
  nonDeductibleMeals: null, businessUseOfHome: null, amortizationCasualty: null, mileageDepreciation: null,
})
const blankSCorp = (): SCorpYear => ({
  k1OrdinaryIncome: null, k1RentalIncome: null, depreciation: null, depletion: null,
  amortizationCasualty: null, notesPayableUnder1Yr: null, nonDeductibleTravelMeals: null, ownershipPct: null,
})
const blankPartnership = (): PartnershipYear => ({ ...blankSCorp(), k1GuaranteedPayments: null })
const blankScheduleE = (): ScheduleEInput => ({
  rentsReceived: null, totalExpenses: null, depreciation: null, insurance: null,
  mortgageInterest: null, taxes: null, hoa: null, oneTimeExpense: null, monthsInService: 12,
})

/** Starting inputs for a new worksheet. `today` sets the default tax year. */
export function defaultInputs<K extends WorksheetKind>(kind: K, today = new Date()): InputsByKind[K] {
  const lastTaxYear = today.getFullYear() - 1
  const defaults: InputsByKind = {
    salary: { frequency: 'biweekly', amount: null },
    hourly: { rate: null, hoursPerWeek: 40 },
    variable: { incomeType: 'overtime', ytdAmount: null, ytdMonths: null, priorYear1: null, priorYear2: null },
    schedule_c: { recentYear: lastTaxYear, older: blankScheduleC(), recent: blankScheduleC() },
    s_corp: { recentYear: lastTaxYear, older: blankSCorp(), recent: blankSCorp() },
    partnership: { recentYear: lastTaxYear, older: blankPartnership(), recent: blankPartnership() },
    bank_statement: { totalDeposits: null, excludedDeposits: null, months: 12, accountType: 'business', expenseRatioPct: 50, ownershipPct: 100 },
    rental: { method: 'schedule_e', leaseRent: null, scheduleE: blankScheduleE() },
  }
  return defaults[kind]
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/** Fill in any missing fields from the defaults, so saved inputs from older versions still work. */
export function normalizeInputs<K extends WorksheetKind>(kind: K, raw: unknown): InputsByKind[K] {
  const base = defaultInputs(kind) as unknown as Record<string, unknown>
  if (!isObject(raw)) return base as unknown as InputsByKind[K]
  const out: Record<string, unknown> = { ...base }
  for (const [key, value] of Object.entries(base)) {
    if (!(key in raw)) continue
    out[key] = isObject(value) ? { ...value, ...(isObject(raw[key]) ? raw[key] : {}) } : raw[key]
  }
  return out as unknown as InputsByKind[K]
}

/** True when nothing has been typed into a tax year. */
export const isBlankYear = (year: object) => Object.entries(year).every(([key, v]) => v === null || key === 'ownershipPct')

/** Runs the worksheet's calculation. */
export function computeWorksheet(w: WorksheetData): IncomeResult {
  switch (w.kind) {
    case 'salary':
      return wageIncome({ frequency: w.inputs.frequency, amount: w.inputs.amount })
    case 'hourly':
      return wageIncome({ frequency: 'hourly', amount: w.inputs.rate, hoursPerWeek: w.inputs.hoursPerWeek })
    case 'variable':
      return variableIncome(w.inputs)
    case 'schedule_c':
    case 's_corp':
    case 'partnership': {
      const { older, recent } = w.inputs
      return selfEmployedIncome(w.kind, isBlankYear(older) ? null : older, isBlankYear(recent) ? null : recent)
    }
    case 'bank_statement':
      return bankStatementIncome(w.inputs)
    case 'rental':
      return w.inputs.method === 'lease' ? leaseIncome(w.inputs.leaseRent) : scheduleEIncome(w.inputs.scheduleE)
  }
}

export type EmploymentIncomeField = 'baseIncome' | 'overtimeIncome' | 'bonusIncome' | 'commissionIncome' | 'selfEmployedIncome'

export type PushTarget =
  | { to: 'employment'; field: EmploymentIncomeField; label: string }
  | { to: 'property'; method: 'lease' | 'schedule_e'; label: string }

const VARIABLE_FIELDS: Record<VariableType, EmploymentIncomeField> = { overtime: 'overtimeIncome', bonus: 'bonusIncome', commission: 'commissionIncome' }

/** Which 1003 field the worksheet fills. */
export function pushTarget(w: WorksheetData): PushTarget {
  switch (w.kind) {
    case 'salary':
    case 'hourly':
      return { to: 'employment', field: 'baseIncome', label: 'Base pay' }
    case 'variable':
      return { to: 'employment', field: VARIABLE_FIELDS[w.inputs.incomeType], label: w.inputs.incomeType[0].toUpperCase() + w.inputs.incomeType.slice(1) }
    case 'rental':
      return w.inputs.method === 'lease'
        ? { to: 'property', method: 'lease', label: 'Monthly rent (75% of lease is counted)' }
        : { to: 'property', method: 'schedule_e', label: 'Schedule E rental income' }
    default:
      return { to: 'employment', field: 'selfEmployedIncome', label: 'Self-employed income' }
  }
}

/** The number "Push to 1003" writes: the monthly result, or the gross lease rent for the lease method. */
export function pushValue(w: WorksheetData, result: IncomeResult): number {
  if (w.kind === 'rental' && w.inputs.method === 'lease') return w.inputs.leaseRent ?? 0
  return result.monthly
}

/** The value the 1003 holds right now in the worksheet's target field (null if empty or not using this method). */
export function currentTargetValue(target: PushTarget, employment: Employment | null, property: Property | null): number | null {
  if (target.to === 'employment') return employment ? employment[target.field] : null
  if (!property || property.rentalIncomeMethod !== target.method) return null
  return target.method === 'lease' ? property.monthlyRent : property.scheduleEMonthlyIncome
}

/** True when the 1003 doesn't match what the worksheet would push. */
export function differsFrom1003(current: number | null, value: number): boolean {
  return current === null || Math.abs(current - value) >= 0.005
}

/** Why a push would fail: most 1003 income fields can't be negative (self-employment and Schedule E can). */
export function pushError(target: PushTarget, value: number): string | null {
  if (value >= 0) return null
  if (target.to === 'employment' && target.field === 'selfEmployedIncome') return null
  if (target.to === 'property' && target.method === 'schedule_e') return null
  return `${target.label} can't be negative on the 1003.`
}

export interface RentalNet {
  lines: IncomeLine[]
  net: number
}

/**
 * The rest of a rental worksheet: the property's monthly payment comes off
 * the worksheet figure to give net rental income (a loss counts as a debt).
 */
export function rentalNet(inputs: RentalInputs, result: IncomeResult, property: Property): RentalNet {
  const cost = rentalPropertyCost({
    lienPayments: property.liens.filter((l) => !l.toBePaidOff).map((l) => l.monthlyPayment ?? 0),
    annualTaxes: property.annualTaxes,
    annualInsurance: property.annualInsurance,
    monthlyHoa: property.monthlyHoa,
  })
  const net = propertyNetRental(
    inputs.method === 'lease'
      ? { ...property, rentalIncomeMethod: 'lease', monthlyRent: inputs.leaseRent }
      : { ...property, rentalIncomeMethod: 'schedule_e', scheduleEMonthlyIncome: result.monthly },
  )
  return {
    net,
    lines: [
      { label: 'Rental income before payment', amount: result.monthly },
      { label: 'Property payment (mortgages, taxes, insurance, HOA)', amount: -cost, kind: 'subtract' },
      { label: net < 0 ? 'Net rental loss (counts as a debt)' : 'Net rental income', amount: round(net), kind: 'result' },
    ],
  }
}

/** A short label for a new worksheet, e.g. "Salary · Acme Corp". */
export function suggestedLabel(kind: WorksheetKind, employment: Pick<Employment, 'employerName'> | null, property: Pick<Property, 'addressLine'> | null): string {
  const short = WORKSHEET_KINDS.find((k) => k.value === kind)?.short ?? kind
  const where = kind === 'rental' ? property?.addressLine : employment?.employerName
  return where ? `${short} · ${where}` : short
}
