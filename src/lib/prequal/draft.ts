import type { LoanDetails, LoanProfile, MortgageType, Property } from '@/lib/api/types'
import type { Application } from '@/lib/api/urla'
import {
  assetDepletionIncome,
  computeScenario,
  DEFAULT_SELLING_COST_PCT,
  fundsByUse,
  reservesAfterClosing,
  saleProceeds,
  type AssetUse,
  type FundsByUse,
  type Reserves,
  DEFAULT_DOWN_PCT,
  dti,
  employmentMonthlyIncome,
  estimatedCashToClose,
  loanForPrice,
  maxDtiFor,
  maxPurchasePrice,
  prequalChecks,
  proposedHousingPayment,
  round,
  type CashToCloseEstimate,
  type DtiResult,
  type MaxPurchaseResult,
  type PrequalCheck,
  type ScenarioResult,
} from '@/lib/calc'
import type { AssetType, LiabilityType, OtherIncomeType } from '@/lib/urla/options'
import { ownedProperties, propertyNetRental } from '@/lib/urla/realEstate'
import { loanScenarioInput } from '@/lib/urla/summary'

// The phone prequal works on a draft of the same records the 1003 uses, so
// results update live as Connor types, and Save writes only what changed.

/** Suggested estimates for a DFW home not picked yet; Connor can change them on the call. */
export const SUGGESTED_TAX_RATE_PCT = 2.2
export const SUGGESTED_ANNUAL_INSURANCE = 3_600

export interface QuickJob {
  key: string
  /** Null for a job added on this call. */
  id: string | null
  employerName: string
  selfEmployed: boolean
  /** Base pay, or self-employed income for a self-employed job. */
  monthly: number | null
  /** Overtime, bonus and other pay already on the 1003 (kept as is). */
  otherPay: number
  /** When the job (or self-employment) started; null when not known. */
  startDate: string | null
}

export interface QuickOtherIncome {
  key: string
  id: string | null
  incomeType: OtherIncomeType
  monthly: number | null
}

export interface QuickBorrower {
  contactId: string
  firstName: string
  role: 'primary' | 'co_borrower'
  creditScore: number | null
  jobs: QuickJob[]
  otherIncomes: QuickOtherIncome[]
}

export interface QuickDebt {
  key: string
  id: string | null
  contactId: string
  liabilityType: LiabilityType
  creditorName: string
  monthlyPayment: number | null
  /** Paid off at closing: the payment stops counting and the balance is due at closing. */
  toBePaidOff: boolean
  unpaidBalance: number | null
}

export interface QuickAsset {
  key: string
  id: string | null
  contactId: string
  assetType: AssetType
  institutionName: string
  amount: number | null
  useAs: AssetUse
}

/** What happens to a home they already own: keep it, rent it out, or sell it. */
export type PropertyPlan = 'keep' | 'rent' | 'sell'

export interface QuickProperty {
  key: string
  id: string
  addressLine: string
  plan: PropertyPlan
  /** Gross monthly rent (rent plan). */
  monthlyRent: number | null
  estimatedValue: number | null
  /** Selling costs for the sell plan (not saved; defaults to 8%). */
  sellingCostPct: number
  /** The saved property, for its mortgages, taxes, insurance and HOA. */
  saved: Property
}

export interface PrequalLoan {
  mortgageType: MortgageType | null
  purchasePrice: number | null
  downPaymentMode: 'percent' | 'amount'
  downPaymentPct: number | null
  downPaymentAmount: number | null
  /** Used for purposes other than purchase; a purchase figures it from price and down payment. */
  loanAmount: number | null
  noteRate: number | null
  termMonths: number | null
  estimatedTaxRatePct: number | null
  estimatedAnnualInsurance: number | null
  estimatedMonthlyHoa: number | null
  miRatePct: number | null
  upfrontFeePct: number | null
  /** Max back-end DTI for the max-price figure (not saved; defaults by loan type). */
  maxDtiPct: number
}

export interface PrequalDraft {
  loan: PrequalLoan
  borrowers: QuickBorrower[]
  debts: QuickDebt[]
  assets: QuickAsset[]
  /** Homes they own (other than the subject), with a keep / rent / sell plan. */
  properties: QuickProperty[]
}

const keyed = (prefix: string, id: string) => `${prefix}-${id}`

/**
 * Builds the draft from what's saved. With `suggest`, empty fields get
 * suggestions (conventional, 30 years, DFW tax and insurance estimates);
 * without it, the draft is exactly what's saved, for comparing at Save.
 */
export function draftFrom(loan: LoanProfile, app: Application, properties: Property[], suggest = true): PrequalDraft {
  const subject = properties.find((p) => p.id === loan.details.subjectPropertyId) ?? null
  const d = loan.details
  const mortgageType = d.mortgageType ?? (suggest ? 'conventional' : null)
  const hasDeal = d.purchasePrice !== null && d.loanAmount !== null && d.purchasePrice > 0
  return {
    loan: {
      mortgageType,
      purchasePrice: d.purchasePrice,
      downPaymentMode: 'percent',
      downPaymentPct: hasDeal ? round(((d.purchasePrice! - d.loanAmount!) / d.purchasePrice!) * 100, 3) : DEFAULT_DOWN_PCT[mortgageType ?? 'conventional'],
      downPaymentAmount: hasDeal ? round(d.purchasePrice! - d.loanAmount!) : null,
      loanAmount: d.loanAmount,
      noteRate: d.noteRate,
      termMonths: d.termMonths ?? (suggest ? 360 : null),
      estimatedTaxRatePct: d.estimatedTaxRatePct ?? (suggest && subject?.annualTaxes == null ? SUGGESTED_TAX_RATE_PCT : null),
      estimatedAnnualInsurance: d.estimatedAnnualInsurance ?? (suggest && subject?.annualInsurance == null ? SUGGESTED_ANNUAL_INSURANCE : null),
      estimatedMonthlyHoa: d.estimatedMonthlyHoa,
      miRatePct: d.miRatePct,
      upfrontFeePct: d.upfrontFeePct,
      maxDtiPct: maxDtiFor(mortgageType),
    },
    borrowers: app.borrowers.map((b) => ({
      contactId: b.contactId,
      firstName: b.person.firstName,
      role: b.role,
      creditScore: b.estimatedCreditScore,
      jobs: b.employments
        .filter((e) => e.status === 'current')
        .map((e) => {
          const monthly = e.isSelfEmployed ? e.selfEmployedIncome : e.baseIncome
          return { key: keyed('job', e.id), id: e.id, employerName: e.employerName, selfEmployed: e.isSelfEmployed, monthly, otherPay: round(employmentMonthlyIncome(e) - (monthly ?? 0)), startDate: e.startDate }
        }),
      otherIncomes: b.otherIncomes.map((i) => ({ key: keyed('oi', i.id), id: i.id, incomeType: i.incomeType, monthly: i.monthlyAmount })),
    })),
    debts: app.liabilities.map((l) => ({
      key: keyed('debt', l.id),
      id: l.id,
      contactId: l.contactId,
      liabilityType: l.liabilityType,
      creditorName: l.creditorName ?? '',
      monthlyPayment: l.monthlyPayment,
      toBePaidOff: l.toBePaidOff,
      unpaidBalance: l.unpaidBalance,
    })),
    assets: app.assets.map((a) => ({ key: keyed('asset', a.id), id: a.id, contactId: a.contactId, assetType: a.assetType, institutionName: a.institutionName ?? '', amount: a.amount, useAs: a.useAs })),
    properties: planProperties(properties, subject),
  }
}

/** Owned homes that need a plan: not the subject property and not already sold. */
function planProperties(properties: Property[], subject: Property | null): QuickProperty[] {
  return ownedProperties(properties)
    .filter((p) => p.id !== subject?.id && p.reoDisposition !== 'sold')
    .map((p) => ({
      key: keyed('home', p.id),
      id: p.id,
      addressLine: p.addressLine,
      plan: p.reoDisposition === 'pending_sale' ? 'sell' : p.monthlyRent || p.rentalIncomeMethod === 'schedule_e' ? 'rent' : 'keep',
      monthlyRent: p.monthlyRent,
      estimatedValue: p.estimatedValue,
      sellingCostPct: DEFAULT_SELLING_COST_PCT,
      saved: p,
    }))
}

/** Net monthly result of keeping or renting a home (a loss counts as debt). Null for the sell plan. */
export function propertyMonthly(h: QuickProperty): number | null {
  if (h.plan === 'sell') return null
  return h.plan === 'rent'
    ? propertyNetRental({ ...h.saved, monthlyRent: h.monthlyRent })
    : propertyNetRental({ ...h.saved, monthlyRent: null, rentalIncomeMethod: 'lease' })
}

/** Net proceeds of selling a home (sell plan only). */
export const propertyProceeds = (h: QuickProperty) =>
  h.plan === 'sell' ? saleProceeds(h.estimatedValue, h.saved.liens.map((l) => l.balance ?? 0), h.sellingCostPct) : null

/** The base loan amount: from price and down payment on a purchase, as entered otherwise. */
export function draftLoanAmount(isPurchase: boolean, l: PrequalLoan): number | null {
  if (!isPurchase) return l.loanAmount
  if (!l.purchasePrice) return null
  return l.downPaymentMode === 'percent'
    ? loanForPrice(l.purchasePrice, { kind: 'percent', pct: l.downPaymentPct ?? 0 })
    : loanForPrice(l.purchasePrice, { kind: 'amount', amount: l.downPaymentAmount ?? 0 })
}

/** The loan fields the draft maps onto, as saved on the loan. */
export function draftLoanDetails(isPurchase: boolean, l: PrequalLoan): Partial<LoanDetails> {
  return {
    mortgageType: l.mortgageType,
    ...(isPurchase ? { purchasePrice: l.purchasePrice } : {}),
    loanAmount: draftLoanAmount(isPurchase, l),
    noteRate: l.noteRate,
    termMonths: l.termMonths,
    estimatedTaxRatePct: l.estimatedTaxRatePct,
    estimatedAnnualInsurance: l.estimatedAnnualInsurance,
    estimatedMonthlyHoa: l.estimatedMonthlyHoa,
    miRatePct: l.miRatePct,
    upfrontFeePct: l.upfrontFeePct,
  }
}

export interface PrequalSummary {
  scenario: ScenarioResult
  loanAmount: number | null
  housing: number | null
  borrowerIncomes: number[]
  rentalIncome: number
  totalIncome: number
  /** Debts after closing, including rental losses. */
  otherDebts: number
  dti: DtiResult
  max: MaxPurchaseResult | null
  /** Max price at 43%, 45% and 50% DTI (purchase only). */
  buyingPower: { dtiPct: number; price: number | null }[]
  depletionIncome: number
  cash: CashToCloseEstimate | null
  /** Balances of debts paid off at closing. */
  payoffs: number
  /** Down payment, closing costs and payoffs together. */
  cashNeeded: number | null
  /** Savings by use, and net proceeds from homes being sold. */
  savings: FundsByUse
  saleProceeds: number
  /** Money available for closing: down payment accounts plus sale proceeds (null when nothing is entered). */
  funds: number | null
  reserves: Reserves | null
  /** Down payment that uses every available dollar after closing costs and payoffs (purchase only). */
  useAllDownPayment: number | null
  /** Lowest estimated score among the borrowers. */
  creditScore: number | null
  checks: PrequalCheck[]
}

/** Every live figure on the prequal screen, from the draft. */
export function prequalSummary(loan: LoanProfile, draft: PrequalDraft, properties: Property[] | undefined): PrequalSummary {
  const isPurchase = loan.purpose === 'purchase'
  const subject = properties?.find((p) => p.id === loan.details.subjectPropertyId) ?? null
  const l = draft.loan
  const loanAmount = draftLoanAmount(isPurchase, l)
  const input = loanScenarioInput(loan.purpose, { ...loan.details, ...draftLoanDetails(isPurchase, l), loanAmount }, subject)
  const scenario = computeScenario(input)
  const housing = proposedHousingPayment(input, scenario)

  const borrowerIncomes = draft.borrowers.map((b) =>
    round(b.jobs.reduce((s, j) => s + (j.monthly ?? 0) + j.otherPay, 0) + b.otherIncomes.reduce((s, i) => s + (i.monthly ?? 0), 0)),
  )
  const rentalNets = draft.properties.map(propertyMonthly).filter((n): n is number => n !== null)
  const rentalIncome = round(rentalNets.filter((n) => n > 0).reduce((s, n) => s + n, 0))
  const rentalLoss = round(rentalNets.filter((n) => n < 0).reduce((s, n) => s - n, 0))
  const depletionIncome = assetDepletionIncome(draft.assets)
  const totalIncome = round(borrowerIncomes.reduce((s, n) => s + n, 0) + rentalIncome + depletionIncome)
  const otherDebts = round(draft.debts.filter((d) => !d.toBePaidOff).reduce((s, d) => s + (d.monthlyPayment ?? 0), 0) + rentalLoss)
  const ratios = housing !== null ? dti(housing, otherDebts, totalIncome) : { front: null, back: null }

  const maxAt = (maxDtiPct: number) =>
    isPurchase && l.noteRate !== null && l.termMonths
      ? maxPurchasePrice({
          monthlyIncome: totalIncome,
          otherMonthlyDebts: otherDebts,
          maxDtiPct,
          downPayment: l.downPaymentMode === 'percent' ? { kind: 'percent', pct: l.downPaymentPct ?? 0 } : { kind: 'amount', amount: l.downPaymentAmount ?? 0 },
          noteRatePct: l.noteRate,
          termMonths: l.termMonths,
          taxRatePct: l.estimatedTaxRatePct,
          annualInsurance: l.estimatedAnnualInsurance,
          monthlyHoa: l.estimatedMonthlyHoa,
          mortgageType: l.mortgageType,
          miRatePct: l.miRatePct,
          upfrontFeePct: l.upfrontFeePct,
        })
      : null
  const max = maxAt(l.maxDtiPct)
  const buyingPower = isPurchase ? [43, 45, 50].map((dtiPct) => ({ dtiPct, price: maxAt(dtiPct)?.price ?? null })) : []

  const cash = isPurchase && l.purchasePrice && loanAmount !== null ? estimatedCashToClose(l.purchasePrice, loanAmount, loan.details.estimatedClosingCosts) : null
  const payoffs = round(draft.debts.filter((d) => d.toBePaidOff).reduce((s, d) => s + (d.unpaidBalance ?? 0), 0))
  const cashNeeded = cash ? round(cash.total + payoffs) : payoffs > 0 ? payoffs : null
  const savings = fundsByUse(draft.assets)
  const proceeds = round(draft.properties.map(propertyProceeds).reduce<number>((s, p) => s + Math.max(p ?? 0, 0), 0))
  const anyFunds = draft.assets.some((a) => a.amount !== null && a.useAs === 'down_payment') || proceeds > 0
  const funds = anyFunds ? round(savings.downPayment + proceeds) : null
  const reserves = funds !== null || savings.reserves > 0 ? reservesAfterClosing(funds ?? 0, cashNeeded ?? 0, savings.reserves, housing) : null
  const useAllDownPayment = isPurchase && cash && funds !== null ? round(Math.max(funds - cash.closingCosts - payoffs, 0)) : null
  const scores = draft.borrowers.map((b) => b.creditScore).filter((s): s is number => s !== null)
  const creditScore = scores.length ? Math.min(...scores) : null

  return {
    scenario,
    loanAmount,
    housing,
    borrowerIncomes,
    rentalIncome,
    totalIncome,
    otherDebts,
    dti: ratios,
    max,
    buyingPower,
    depletionIncome,
    cash,
    payoffs,
    cashNeeded,
    savings,
    saleProceeds: proceeds,
    funds,
    reserves,
    useAllDownPayment,
    creditScore,
    checks: prequalChecks({
      mortgageType: l.mortgageType,
      creditScore,
      ltvPct: scenario.ltv,
      backDtiPct: ratios.back,
      maxDtiPct: l.maxDtiPct,
      cashNeeded,
      funds,
      isPurchase,
    }),
  }
}

// ---------------------------------------------------------------------------
// Saving: what changed between the saved draft and the edited one
// ---------------------------------------------------------------------------

export interface RowChanges<T> {
  insert: T[]
  update: T[]
  /** Ids of saved rows removed on the call. */
  remove: string[]
}

export interface PrequalChanges {
  loan: Partial<LoanDetails>
  scores: { contactId: string; creditScore: number | null }[]
  jobs: RowChanges<QuickJob & { contactId: string }>
  otherIncomes: RowChanges<QuickOtherIncome & { contactId: string }>
  debts: RowChanges<QuickDebt>
  assets: RowChanges<QuickAsset>
  /** Homes whose plan, rent or value changed. */
  properties: QuickProperty[]
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Splits rows into new, edited and removed. `blank` rows (nothing typed) are skipped, not saved. */
function rowChanges<T extends { key: string; id: string | null }>(saved: T[], draft: T[], blank: (row: T) => boolean): RowChanges<T> {
  const savedByKey = new Map(saved.map((r) => [r.key, r]))
  const draftKeys = new Set(draft.map((r) => r.key))
  return {
    insert: draft.filter((r) => r.id === null && !blank(r)),
    update: draft.filter((r) => r.id !== null && !same(r, savedByKey.get(r.key))),
    remove: saved.filter((r) => r.id !== null && !draftKeys.has(r.key)).map((r) => r.id!),
  }
}

const withContact = <T>(borrowers: QuickBorrower[], pick: (b: QuickBorrower) => T[]) => borrowers.flatMap((b) => pick(b).map((row) => ({ ...row, contactId: b.contactId })))

/** Everything Save needs to write, and nothing that didn't change. */
export function prequalChanges(isPurchase: boolean, saved: PrequalDraft, draft: PrequalDraft): PrequalChanges {
  const before = draftLoanDetails(isPurchase, saved.loan)
  const after = draftLoanDetails(isPurchase, draft.loan)
  const loan = Object.fromEntries(Object.entries(after).filter(([k, v]) => !same(v, before[k as keyof LoanDetails]))) as Partial<LoanDetails>
  const savedScores = new Map(saved.borrowers.map((b) => [b.contactId, b.creditScore]))
  return {
    loan,
    scores: draft.borrowers.filter((b) => b.creditScore !== savedScores.get(b.contactId)).map((b) => ({ contactId: b.contactId, creditScore: b.creditScore })),
    jobs: rowChanges(withContact(saved.borrowers, (b) => b.jobs), withContact(draft.borrowers, (b) => b.jobs), (j) => !j.employerName.trim()),
    otherIncomes: rowChanges(withContact(saved.borrowers, (b) => b.otherIncomes), withContact(draft.borrowers, (b) => b.otherIncomes), (i) => i.monthly === null),
    debts: rowChanges(saved.debts, draft.debts, (d) => d.monthlyPayment === null),
    assets: rowChanges(saved.assets, draft.assets, (a) => a.amount === null),
    properties: draft.properties.filter((h) => {
      const before = saved.properties.find((x) => x.key === h.key)
      return !before || before.plan !== h.plan || before.monthlyRent !== h.monthlyRent || before.estimatedValue !== h.estimatedValue
    }),
  }
}

export const hasChanges = (c: PrequalChanges) =>
  Object.keys(c.loan).length > 0 ||
  c.scores.length > 0 ||
  c.properties.length > 0 ||
  [c.jobs, c.otherIncomes, c.debts, c.assets].some((r) => r.insert.length || r.update.length || r.remove.length)

/**
 * Switches the loan type. The max DTI and a percent down payment follow the
 * new type's defaults unless Connor had already changed them.
 */
export function changeLoanType(l: PrequalLoan, type: MortgageType): PrequalLoan {
  const oldType = l.mortgageType ?? 'conventional'
  const keepsDti = l.maxDtiPct !== maxDtiFor(oldType)
  const keepsDown = l.downPaymentMode !== 'percent' || l.downPaymentPct !== DEFAULT_DOWN_PCT[oldType]
  return {
    ...l,
    mortgageType: type,
    maxDtiPct: keepsDti ? l.maxDtiPct : maxDtiFor(type),
    downPaymentPct: keepsDown ? l.downPaymentPct : DEFAULT_DOWN_PCT[type],
    // Overrides are type-specific (e.g. a VA funding fee exemption), so a new type starts from its defaults.
    miRatePct: null,
    upfrontFeePct: null,
  }
}
