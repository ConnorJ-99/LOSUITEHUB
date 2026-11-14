// Estimates (Scenarios & Estimate, docs/plans/scenarios-estimate.md): one
// complete option for the file. An estimate is a pricing scenario that also
// carries its program and lender, its own credits, the fee rules Smart Fees
// used, its saved results and the loan facts it was priced from. Everything
// here is pure; the payment and fee math is in '@/lib/pricing/scenario' and
// '@/lib/calc'.

import { activeDpa, cltvWithDpa, dpaMonthly, type Dpa } from '@/lib/calc/dpa'
import {
  breakEven,
  cashToClose,
  firstPaymentDateFor,
  taxReserveMonths,
  type FeeContext,
  pointsAmount,
  qualifying,
  round,
  type BreakEven,
  type CashToCloseResult,
  type FeeOverride,
  type FeeTemplate,
  type QuoteFigures,
} from '@/lib/calc'
import type { MortgageType } from '@/lib/api/types'
import type { LoanPurpose } from '@/lib/pipeline/stages'
import type { ProductFamily } from '@/lib/products/taxonomy'
import { priceScenario, scenarioFigures, type PricingScenario, type ScenarioDraft } from '@/lib/pricing/scenario'

export interface EstimateProgram {
  programId: string
  programName: string
  family: ProductFamily
  lenderId: string
  lenderName: string
  lenderShortName: string | null
}

export interface Estimate extends PricingScenario {
  programOptionId: string | null
  /** The program and lender behind programOptionId (read only). */
  program: EstimateProgram | null
  quoteDate: string | null
  archivedAt: string | null
  /** Null = the loan's seller credit / the 1003's earnest money. */
  sellerCredits: number | null
  earnestMoney: number | null
  /** The fee-list rules Smart Fees used; null = today's fee list. */
  feeRules: FeeTemplate[] | null
  figures: SavedFigures | null
  loanSnapshot: LoanSnapshot | null
  pricedAt: string | null
  feesGeneratedAt: string | null
  fromLoanId: string | null
  /** Down payment assistance or a gift / grant on this estimate (purchases); null = none, undefined = before the DPA script. */
  dpa?: Dpa | null
  createdAt: string
  updatedAt: string
}

export type EstimateDraft = Omit<Estimate, 'id' | 'program' | 'createdAt' | 'updatedAt'>
export type EstimateStatus = 'selected' | 'draft' | 'archived'

export const estimateStatus = (e: Pick<Estimate, 'id' | 'archivedAt'>, selectedId: string | null): EstimateStatus =>
  e.id === selectedId ? 'selected' : e.archivedAt ? 'archived' : 'draft'

export const MORTGAGE_TYPE_FOR_FAMILY: Partial<Record<ProductFamily, MortgageType>> = { conventional: 'conventional', jumbo: 'conventional', fha: 'fha', va: 'va', usda: 'usda_rural', non_qm: 'other' }

// ---------------------------------------------------------------------------
// The loan facts an estimate is priced from
// ---------------------------------------------------------------------------

export interface FactDebt {
  id: string
  name: string
  monthlyPayment: number
  balance: number
  toBePaidOff: boolean
}

export interface FactAsset {
  type: string
  amount: number
}

export interface FactProperty {
  id: string
  address: string
  county: string | null
  state: string | null
}

/** Everything about the file an estimate's math uses. Saved with the estimate, so it opens exactly as priced. */
export interface LoanFacts {
  purpose: LoanPurpose
  purchasePrice: number | null
  closingDate: string | null
  property: FactProperty | null
  /** Refinance: mortgages the new loan pays off; HELOC: payments on mortgages that stay. */
  mortgagePayoffs: number
  otherFinancing: number
  sellerCredits: number
  earnestMoney: number
  /** Each borrower's monthly income, plus loan-level income (asset depletion) and other homes' rental results. */
  incomes: number[]
  otherIncome: number
  rentalNets: number[]
  debts: FactDebt[]
  assets: FactAsset[]
  /** Saved from 2026-11 on (older snapshots don't have them). */
  occupancy?: string | null
  /** The loan's mortgage insurance overrides (VA exempt = 0% upfront). */
  upfrontFeePct?: number | null
  miRatePct?: number | null
}

export interface LoanSnapshot {
  facts: LoanFacts
  /** "Keep as is": the loan facts the banner was dismissed for. */
  keptFingerprint?: string | null
}

/** 1003 asset types that are credits at closing (they lower what the borrower brings), not money in an account. */
const CREDIT_ASSETS = new Set(['gift_equity', 'lot_equity', 'sweat_equity', 'trade_equity', 'rent_credit', 'other_credit'])
const GIFT_ASSETS = new Set(['gift_cash', 'grant'])

const sum = (xs: number[]) => round(xs.reduce((s, x) => s + x, 0))

/** Money the borrower has for closing: every account and cash gift, not earnest money (already paid) or equity credits. */
export const availableFunds = (assets: FactAsset[]) => sum(assets.filter((a) => a.type !== 'earnest_money' && !CREDIT_ASSETS.has(a.type)).map((a) => a.amount))
export const creditAssets = (assets: FactAsset[]) => sum(assets.filter((a) => CREDIT_ASSETS.has(a.type)).map((a) => a.amount))
export const cashGifts = (assets: FactAsset[]) => sum(assets.filter((a) => GIFT_ASSETS.has(a.type)).map((a) => a.amount))
export const debtsPaidAtClosing = (debts: FactDebt[]) => sum(debts.filter((d) => d.toBePaidOff).map((d) => d.balance))

// ---------------------------------------------------------------------------
// The math
// ---------------------------------------------------------------------------

/** What's saved with an estimate (and shown on chips, the saved list, Compare and the rest of the file). */
export interface SavedFigures {
  baseLoanAmount: number
  totalLoanAmount: number
  financedFee: number
  ltvPct: number | null
  ratePct: number | null
  pointsPct: number
  termMonths: number | null
  principalAndInterest: number
  mi: number
  taxes: number
  hoi: number
  hoa: number
  /** Supplemental insurance, other financing and other payments. */
  otherMonthly: number
  pitia: number
  /** A–H the borrower pays, before the lender credit. */
  closingCosts: number
  lenderCredit: number
  /** F + G (prepaids and initial escrow). */
  prepaids: number
  downPayment: number
  cashToClose: number
  availableFunds: number
  fundsLeft: number
  reservesMonths: number | null
  dtiFront: number | null
  dtiBack: number | null
  /** Down payment assistance / gift funds, its monthly payment (in otherMonthly) and CLTV with its lien. Missing on estimates saved before DPA. */
  dpaAmount?: number
  dpaMonthly?: number
  cltvPct?: number | null
}

/** The scenario as the fee engine prices it: negative points become a lender credit. */
export function pricingDraft(e: ScenarioDraft): ScenarioDraft {
  if (e.pointsPct >= 0) return e
  const total = scenarioFigures(e).totalLoanAmount
  return { ...e, pointsPct: 0, lenderCredit: round(e.lenderCredit + pointsAmount(-e.pointsPct, total)) }
}

export interface EstimateResult {
  priced: ReturnType<typeof priceScenario>
  /** Down payment assistance / gift funds at closing, its monthly payment and CLTV with its lien. */
  dpaAmount: number
  dpaMonthly: number
  cltvPct: number | null
  /** Lender credit in dollars, including negative points. */
  lenderCredit: number
  sellerCredits: number
  earnestMoney: number
  cash: CashToCloseResult
  availableFunds: number
  fundsLeft: number
  reservesMonths: number | null
  dti: { front: number | null; back: number | null }
  income: number
  otherDebts: number
  saved: SavedFigures
}

/** Every figure for one estimate, from its own inputs, fee rules and edits and the loan facts it was priced from. */
export function computeEstimate(e: EstimateDraft, overrides: FeeOverride[], templates: FeeTemplate[], facts: LoanFacts): EstimateResult {
  const isPurchase = facts.purpose === 'purchase'
  // DPA / gift funds (purchases): they lower cash to close; a repayable DPA adds its payment.
  const dpa = isPurchase ? activeDpa(e.dpa) : null
  const dpaPayment = dpaMonthly(dpa)
  const priceAt = pricingDraft({ ...e, upfrontFeePct: facts.upfrontFeePct ?? null, miRatePct: facts.miRatePct ?? null })
  const priced = priceScenario(priceAt, facts.purpose, e.feeRules ?? activeRules(templates, null), overrides, round(facts.otherFinancing + dpaPayment), smartFeeContext(e, facts))
  const f = priced.figures
  const lenderCredit = priceAt.lenderCredit
  const sellerCredits = e.sellerCredits ?? facts.sellerCredits
  const earnestMoney = e.earnestMoney ?? facts.earnestMoney
  const dpaAmount = dpa ? round(dpa.amount) : 0
  const value = e.purchasePrice && e.propertyValue ? Math.min(e.purchasePrice, e.propertyValue) : (e.purchasePrice ?? e.propertyValue)
  const cltvPct = dpa ? cltvWithDpa(f.totalLoanAmount, dpa, value) : null
  const gross = round(priced.closingCosts + lenderCredit)
  const cash = cashToClose({
    isPurchase,
    purchasePrice: e.purchasePrice,
    baseLoanAmount: round(f.totalLoanAmount - f.financedFee),
    closingCosts: gross,
    lenderCredit,
    earnestMoney: isPurchase ? earnestMoney : 0,
    sellerCredits: isPurchase ? sellerCredits : 0,
    otherCredits: isPurchase ? round(creditAssets(facts.assets) + dpaAmount) : 0,
    debtsPaidAtClosing: debtsPaidAtClosing(facts.debts),
    mortgagePayoffs: facts.mortgagePayoffs,
    cashGifts: cashGifts(facts.assets),
  })
  const funds = availableFunds(facts.assets)
  const fundsLeft = round(funds - cash.cashToClose)
  const reservesMonths = f.pitia > 0 ? round(fundsLeft / f.pitia, 1) : null
  const q = qualifying({
    borrowerIncomes: facts.incomes,
    housingPayment: f.pitia,
    debts: facts.debts.map((d) => ({ monthlyPayment: d.monthlyPayment, toBePaidOff: d.toBePaidOff })),
    rentalNets: facts.rentalNets,
    otherIncome: facts.otherIncome,
  })
  const p = f.payment
  const saved: SavedFigures = {
    baseLoanAmount: round(f.totalLoanAmount - f.financedFee),
    totalLoanAmount: f.totalLoanAmount,
    financedFee: f.financedFee,
    ltvPct: f.ltvPct,
    ratePct: e.noteRate,
    pointsPct: e.pointsPct,
    termMonths: e.termMonths,
    principalAndInterest: p.principalAndInterest,
    mi: p.mi,
    taxes: p.taxes,
    hoi: p.hoi,
    hoa: p.hoa,
    otherMonthly: round(p.supplemental + p.otherFinancing + p.other),
    pitia: f.pitia,
    closingCosts: gross,
    lenderCredit,
    prepaids: round(priced.totals.F + priced.totals.G),
    downPayment: cash.downPayment,
    cashToClose: cash.cashToClose,
    availableFunds: funds,
    fundsLeft,
    reservesMonths,
    dtiFront: q.dti.front,
    dtiBack: q.dti.back,
    ...(dpa && { dpaAmount, dpaMonthly: dpaPayment, cltvPct }),
  }
  return { priced, dpaAmount, dpaMonthly: dpaPayment, cltvPct, lenderCredit, sellerCredits, earnestMoney, cash, availableFunds: funds, fundsLeft, reservesMonths, dti: q.dti, income: q.totalIncome, otherDebts: q.otherDebts, saved }
}

// ---------------------------------------------------------------------------
// New estimates and saving
// ---------------------------------------------------------------------------

/** The estimate-only fields of a new estimate. */
export const ESTIMATE_DEFAULTS: Omit<EstimateDraft, keyof ScenarioDraft> = {
  programOptionId: null,
  quoteDate: null,
  archivedAt: null,
  sellerCredits: null,
  earnestMoney: null,
  feeRules: null,
  figures: null,
  loanSnapshot: null,
  pricedAt: null,
  feesGeneratedAt: null,
  fromLoanId: null,
}

/**
 * The fee-list rules an estimate keeps: active ones for every lender plus its
 * own lender's (another lender's charges never apply). Which rule wins for
 * each fee (county, state, loan amount) is worked out each time it's priced.
 */
export const activeRules = (templates: FeeTemplate[], lenderId: string | null) => templates.filter((t) => t.active && (!t.lenderId || t.lenderId === lenderId))

/** What Smart Fees needs about the loan beyond the scenario: where the home is, occupancy and the Texas tax due date. */
export function smartFeeContext(e: Pick<EstimateDraft, 'firstPaymentDate' | 'estimatedFundingDate' | 'purchasePrice'>, facts: LoanFacts): Partial<FeeContext> {
  const firstPayment = e.firstPaymentDate ?? (e.estimatedFundingDate ? firstPaymentDateFor(e.estimatedFundingDate) : null)
  return {
    state: facts.property?.state ?? null,
    county: facts.property?.county ?? null,
    occupancy: facts.occupancy ?? null,
    purchasePrice: facts.purpose === 'purchase' ? e.purchasePrice : null,
    ...(firstPayment && { taxReserveMonths: taxReserveMonths(firstPayment) }),
  }
}

/**
 * The estimate as it is saved: its fee rules and loan facts frozen (the first
 * time), and its results worked out from them.
 */
export function withResults(e: EstimateDraft, overrides: FeeOverride[], templates: FeeTemplate[], currentFacts: LoanFacts, nowIso: string, lenderId: string | null = null): EstimateDraft {
  const feeRules = e.feeRules ?? activeRules(templates, lenderId)
  const loanSnapshot = e.loanSnapshot ?? { facts: currentFacts }
  const next = { ...e, feeRules, loanSnapshot }
  return { ...next, figures: computeEstimate(next, overrides, templates, loanSnapshot.facts).saved, pricedAt: nowIso, feesGeneratedAt: e.feesGeneratedAt ?? nowIso }
}

/** The fields of a draft that differ from the saved estimate (objects compared by value). */
export function estimateChanges(saved: EstimateDraft, draft: EstimateDraft): Partial<EstimateDraft> {
  const same = (a: unknown, b: unknown) => (a !== null && typeof a === 'object' ? JSON.stringify(a) === JSON.stringify(b) : a === b)
  return Object.fromEntries(Object.entries(draft).filter(([key, value]) => !same(saved[key as keyof EstimateDraft], value))) as Partial<EstimateDraft>
}

/** Fee edits to write and remove so the saved edits match the draft's. */
export function feeChanges(saved: FeeOverride[], draft: FeeOverride[]): { upsert: FeeOverride[]; remove: string[] } {
  const was = new Map(saved.map((o) => [o.key, JSON.stringify(o)]))
  const keys = new Set(draft.map((o) => o.key))
  return { upsert: draft.filter((o) => was.get(o.key) !== JSON.stringify(o)), remove: saved.filter((o) => !keys.has(o.key)).map((o) => o.key) }
}

// ---------------------------------------------------------------------------
// Build estimates
// ---------------------------------------------------------------------------

/** One row of "Build estimates": a program priced one way. */
export interface BuildRow {
  key: string
  programOptionId: string | null
  programId: string | null
  programName: string
  family: ProductFamily | null
  lenderId: string | null
  lenderName: string
  /** Blank = the program and lender. */
  label: string
  ratePct: number | null
  /** Points (+) or credit (−) as a percent. */
  pointsPct: number
  /** Purchase: down payment percent. */
  downPct: number | null
  /** Refinance: the loan amount. */
  loanAmount: number | null
  termMonths: number
}

/** The deal every row shares, from the loan. */
export interface SharedDeal {
  purchasePrice: number | null
  propertyValue: number | null
  closingDate: string | null
  sellerCredits: number | null
  earnestMoney: number | null
  propertyId: string | null
}

/** Usual down payment for a program family on a purchase. */
export const defaultDownPct = (family: ProductFamily | null) => (family === 'fha' ? 3.5 : family === 'va' || family === 'usda' ? 0 : family === 'non_qm' ? 10 : 5)

/** One estimate draft from a Build row, on top of a draft made from the loan. */
export function draftFromRow(base: EstimateDraft, row: BuildRow, shared: SharedDeal, isPurchase: boolean, name: string): EstimateDraft {
  const price = isPurchase ? shared.purchasePrice : null
  const loanAmount = isPurchase ? (price != null && row.downPct != null ? round(price * (1 - row.downPct / 100), 0) : base.loanAmount) : (row.loanAmount ?? base.loanAmount)
  return {
    ...base,
    name,
    lenderName: row.lenderName || null,
    programName: row.programName || null,
    programOptionId: row.programOptionId,
    mortgageType: (row.family && MORTGAGE_TYPE_FOR_FAMILY[row.family]) ?? base.mortgageType,
    noteRate: row.ratePct,
    pointsPct: row.pointsPct,
    termMonths: row.termMonths,
    loanAmount,
    purchasePrice: price,
    propertyValue: shared.propertyValue ?? (isPurchase ? price : base.propertyValue),
    propertyId: shared.propertyId,
    estimatedFundingDate: shared.closingDate,
    sellerCredits: shared.sellerCredits,
    earnestMoney: shared.earnestMoney,
  }
}

// ---------------------------------------------------------------------------
// "Loan changed since this estimate"
// ---------------------------------------------------------------------------

const money = (n: number | null) => (n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`)
const day = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }) : 'none')

/** A stable string of the facts that matter, to tell whether the loan changed. */
export const factsFingerprint = (f: LoanFacts) => JSON.stringify([f.purchasePrice, f.closingDate, f.property?.id ?? null, f.mortgagePayoffs, f.sellerCredits, f.earnestMoney, f.debts, sum(f.assets.map((a) => a.amount)), sum(f.incomes)])

/** What changed on the file since the estimate was priced, in words ("price $385,000 → $395,000"). */
export function loanChanges(before: LoanFacts, now: LoanFacts): string[] {
  const out: string[] = []
  if (before.purchasePrice !== now.purchasePrice) out.push(`purchase price ${money(before.purchasePrice)} → ${money(now.purchasePrice)}`)
  if ((before.property?.id ?? null) !== (now.property?.id ?? null)) out.push(`home ${before.property?.address ?? 'none'} → ${now.property?.address ?? 'none'}`)
  if (before.closingDate !== now.closingDate) out.push(`closing date ${day(before.closingDate)} → ${day(now.closingDate)}`)
  if (before.mortgagePayoffs !== now.mortgagePayoffs) out.push(`mortgage payoffs ${money(before.mortgagePayoffs)} → ${money(now.mortgagePayoffs)}`)
  if (before.sellerCredits !== now.sellerCredits) out.push(`seller credit ${money(before.sellerCredits)} → ${money(now.sellerCredits)}`)
  if (before.earnestMoney !== now.earnestMoney) out.push(`earnest money ${money(before.earnestMoney)} → ${money(now.earnestMoney)}`)
  const was = new Map(before.debts.map((d) => [d.id, d]))
  const is = new Map(now.debts.map((d) => [d.id, d]))
  for (const d of now.debts) {
    const old = was.get(d.id)
    if (!old) out.push(`${d.name} added to debts`)
    else if (old.toBePaidOff !== d.toBePaidOff) out.push(`${d.name} ${d.toBePaidOff ? 'added to' : 'taken off'} payoffs`)
    else if (old.monthlyPayment !== d.monthlyPayment) out.push(`${d.name} payment ${money(old.monthlyPayment)} → ${money(d.monthlyPayment)}`)
  }
  for (const d of before.debts) if (!is.has(d.id)) out.push(`${d.name} removed from debts`)
  const assetsBefore = sum(before.assets.map((a) => a.amount))
  const assetsNow = sum(now.assets.map((a) => a.amount))
  if (assetsBefore !== assetsNow) out.push(`assets ${money(assetsBefore)} → ${money(assetsNow)}`)
  const incomeBefore = sum(before.incomes) + before.otherIncome
  const incomeNow = sum(now.incomes) + now.otherIncome
  if (Math.abs(incomeBefore - incomeNow) > 0.5) out.push(`income ${money(incomeBefore)}/mo → ${money(incomeNow)}/mo`)
  return out
}

/** The banner's lines, or none when nothing changed or Connor chose "Keep as is" for these facts. */
export function changedSincePriced(snapshot: LoanSnapshot | null, now: LoanFacts, own: Partial<Pick<EstimateDraft, 'sellerCredits' | 'earnestMoney'>> = {}): string[] {
  if (!snapshot) return []
  if (snapshot.keptFingerprint && snapshot.keptFingerprint === factsFingerprint(now)) return []
  // A credit the estimate sets itself doesn't follow the loan, so a change on the loan doesn't matter to it.
  const ignore = { ...(own.sellerCredits != null && { sellerCredits: now.sellerCredits }), ...(own.earnestMoney != null && { earnestMoney: now.earnestMoney }) }
  return loanChanges({ ...snapshot.facts, ...ignore }, now)
}

/**
 * "Refresh with current loan": the estimate's price, home and closing date
 * follow the loan where they still had the old loan's value (an estimate
 * priced at a different price on purpose keeps it). The down payment percent
 * stays the same. Fee edits are kept by the caller.
 */
export function refreshFromLoan(e: EstimateDraft, before: LoanFacts, now: LoanFacts): Partial<EstimateDraft> {
  const changes: Partial<EstimateDraft> = {}
  if (now.purchasePrice != null && e.purchasePrice === before.purchasePrice && before.purchasePrice !== now.purchasePrice) {
    changes.purchasePrice = now.purchasePrice
    if (e.propertyValue === before.purchasePrice) changes.propertyValue = now.purchasePrice
    if (e.loanAmount != null && before.purchasePrice) changes.loanAmount = round((now.purchasePrice * e.loanAmount) / before.purchasePrice, 0)
  }
  if (e.estimatedFundingDate === before.closingDate && before.closingDate !== now.closingDate) changes.estimatedFundingDate = now.closingDate
  if (e.propertyId === (before.property?.id ?? null) && (before.property?.id ?? null) !== (now.property?.id ?? null)) changes.propertyId = now.property?.id ?? null
  changes.loanSnapshot = { facts: now }
  return changes
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const LETTERS = 'BCDEFGHIJKLMNOPQRSTUVWXYZ'

/** "FHA 30 Fixed · UWM", or with "· Option B", "· Option C"… when that name is taken. */
export function estimateName(base: string, taken: string[]): string {
  const names = new Set(taken.map((t) => t.trim().toLowerCase()))
  if (!names.has(base.trim().toLowerCase())) return base
  for (const l of LETTERS) {
    const name = `${base} · Option ${l}`
    if (!names.has(name.toLowerCase())) return name
  }
  return `${base} · ${taken.length + 1}`
}

export const programLabel = (p: Pick<EstimateProgram, 'programName' | 'lenderName' | 'lenderShortName'>) => `${p.programName} · ${p.lenderShortName ?? p.lenderName}`

/** The estimate's lender and program, from the linked program or as typed. */
export const estimateLender = (e: Pick<Estimate, 'program' | 'lenderName'>) => e.program?.lenderShortName ?? e.program?.lenderName ?? e.lenderName
export const estimateProgramName = (e: Pick<Estimate, 'program' | 'programName'>) => e.program?.programName ?? e.programName

// ---------------------------------------------------------------------------
// "Change for all"
// ---------------------------------------------------------------------------

export type ChangeField = 'closingDate' | 'sellerCredits' | 'earnestMoney' | 'annualInsurance' | 'annualTaxes' | 'monthlyHoa' | 'purchasePrice' | 'lockDays' | 'fee'

export interface ChangeForAll {
  field: ChangeField
  /** Dollars, a date (closingDate) or days (lockDays). */
  value: number | string | null
  /** For field = 'fee': which fee, and its section and name for a new edit. */
  fee?: { key: string; section: FeeOverride['section']; name: string }
}

/** One field set on one estimate. Every other input and fee edit stays as it was. */
export function applyChange(e: EstimateDraft, c: ChangeForAll, existing: FeeOverride[]): { changes: Partial<EstimateDraft>; fee: FeeOverride | null } {
  const n = typeof c.value === 'number' ? c.value : c.value == null || c.value === '' ? null : Number(c.value)
  switch (c.field) {
    case 'closingDate':
      return { changes: { estimatedFundingDate: (c.value as string | null) || null, firstPaymentDate: null, prepaidInterestDays: null }, fee: null }
    case 'sellerCredits':
      return { changes: { sellerCredits: n }, fee: null }
    case 'earnestMoney':
      return { changes: { earnestMoney: n }, fee: null }
    case 'annualInsurance':
      return { changes: { insuranceValue: n, insuranceFactor: 'annual' }, fee: null }
    case 'annualTaxes':
      return { changes: { taxesValue: n, taxesFactor: 'annual' }, fee: null }
    case 'monthlyHoa':
      return { changes: { monthlyHoa: n }, fee: null }
    case 'lockDays':
      return { changes: { lockDays: n }, fee: null }
    case 'purchasePrice': {
      if (n == null) return { changes: {}, fee: null }
      // Same down payment percent at the new price.
      const loanAmount = e.loanAmount != null && e.purchasePrice ? round((n * e.loanAmount) / e.purchasePrice, 0) : e.loanAmount
      return { changes: { purchasePrice: n, loanAmount, ...(e.propertyValue === e.purchasePrice && { propertyValue: n }) }, fee: null }
    }
    case 'fee': {
      if (!c.fee) return { changes: {}, fee: null }
      const old = existing.find((o) => o.key === c.fee!.key)
      return {
        changes: {},
        fee: old
          ? { ...old, atClosing: n }
          : { key: c.fee.key, section: c.fee.section, name: c.fee.name, atClosing: n, beforeClosing: null, paidBy: 'B', apr: false, paidTo: null, custom: false },
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Select for this file
// ---------------------------------------------------------------------------

export interface SelectRow {
  label: string
  before: string | null
  after: string
}

const pct = (n: number | null, d = 3) => (n == null ? '—' : `${n.toFixed(d)}%`)
const pointsText = (pointsPct: number, lenderCredit: number) =>
  [pointsPct > 0 ? `${pointsPct.toFixed(3)} pt` : pointsPct < 0 ? `${pointsPct.toFixed(3)}%` : null, lenderCredit > 0 ? `${money(lenderCredit)} credit` : null].filter(Boolean).join(' · ') || '0 pts'

/** What "Select for this file" changes, for the confirm ("FHA 30 Fixed → Conv 30 HomeReady"). */
export function selectRows(current: Pick<Estimate, 'program' | 'programName' | 'lenderName' | 'pointsPct' | 'lenderCredit' | 'figures'> | null, next: Pick<Estimate, 'program' | 'programName' | 'lenderName' | 'pointsPct' | 'lenderCredit' | 'figures'>, isPurchase: boolean): SelectRow[] {
  const f = next.figures
  const c = current?.figures ?? null
  const rows: SelectRow[] = [
    { label: 'Program', before: current ? estimateProgramName(current) : null, after: estimateProgramName(next) ?? '—' },
    { label: 'Lender', before: current ? estimateLender(current) : null, after: estimateLender(next) ?? '—' },
    { label: 'Rate / points', before: c ? `${pct(c.ratePct)} · ${pointsText(current!.pointsPct, current!.lenderCredit)}` : null, after: f ? `${pct(f.ratePct)} · ${pointsText(next.pointsPct, next.lenderCredit)}` : '—' },
  ]
  if (isPurchase) rows.push({ label: 'Down payment', before: c ? money(c.downPayment) : null, after: f ? money(f.downPayment) : '—' })
  rows.push(
    { label: 'Loan amount', before: c ? money(c.totalLoanAmount) : null, after: f ? money(f.totalLoanAmount) : '—' },
    { label: 'Payment', before: c ? money(c.pitia) : null, after: f ? money(f.pitia) : '—' },
    { label: 'Closing costs', before: c ? money(c.closingCosts) : null, after: f ? money(f.closingCosts) : '—' },
  )
  return rows
}

/** The note logged on the file: "Selected FHA 30 Fixed · UWM · 6.250% on Nov 3". */
export function selectedNote(e: Pick<Estimate, 'name' | 'program' | 'programName' | 'lenderName' | 'noteRate'>, onIso: string): string {
  const what = [estimateProgramName(e) ?? e.name, estimateLender(e), e.noteRate != null ? pct(e.noteRate) : null].filter(Boolean).join(' · ')
  return `Selected ${what} on ${day(onIso.slice(0, 10))} (Scenarios & Estimate: "${e.name}").`
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

export type CompareMetric = 'rate' | 'pitia' | 'closingCosts' | 'cashToClose' | 'fundsLeft' | 'dtiBack' | 'horizonCost' | 'mi'

/** Cash to close plus the horizon's P&I and MI (the quote comparison's cost over time). */
export const horizonCost = (f: SavedFigures, years: number) => round(f.cashToClose + years * 12 * (f.principalAndInterest + f.mi))

const METRIC: Record<CompareMetric, { get: (f: SavedFigures, years: number) => number | null; best: 'low' | 'high' }> = {
  rate: { get: (f) => f.ratePct, best: 'low' },
  pitia: { get: (f) => f.pitia, best: 'low' },
  mi: { get: (f) => f.mi, best: 'low' },
  closingCosts: { get: (f) => f.closingCosts, best: 'low' },
  cashToClose: { get: (f) => f.cashToClose, best: 'low' },
  fundsLeft: { get: (f) => f.fundsLeft, best: 'high' },
  dtiBack: { get: (f) => f.dtiBack, best: 'low' },
  horizonCost: { get: (f, y) => horizonCost(f, y), best: 'low' },
}

/** Which estimate wins each row (a tie goes to the first). Rows where everyone is equal have no winner. */
export function compareWinners(list: { id: string; figures: SavedFigures }[], years: number): Partial<Record<CompareMetric, string>> {
  const out: Partial<Record<CompareMetric, string>> = {}
  if (list.length < 2) return out
  for (const [metric, m] of Object.entries(METRIC) as [CompareMetric, (typeof METRIC)[CompareMetric]][]) {
    const values = list.map((x) => ({ id: x.id, v: m.get(x.figures, years) })).filter((x): x is { id: string; v: number } => x.v != null)
    if (values.length < 2 || values.every((x) => Math.abs(x.v - values[0].v) < 0.005)) continue
    const best = values.reduce((a, b) => ((m.best === 'low' ? b.v < a.v - 0.005 : b.v > a.v + 0.005) ? b : a))
    out[metric] = best.id
  }
  return out
}

/** An estimate as the quote comparison sees it (for break-even and the comparison PDF). */
export const quoteFiguresOf = (id: string, f: SavedFigures, years: number): QuoteFigures => ({
  id,
  rate: f.ratePct ?? 0,
  principalAndInterest: f.principalAndInterest,
  mi: f.mi,
  taxesInsurance: round(f.taxes + f.hoi),
  totalPayment: f.pitia,
  downPayment: f.downPayment,
  cashToClose: f.cashToClose,
  horizonCost: horizonCost(f, years),
})

/** Break-even of one estimate against another (the Selected one, or the lowest cost when none is selected). */
export const breakEvenAgainst = (id: string, f: SavedFigures, baseId: string, base: SavedFigures, years: number): BreakEven => breakEven(quoteFiguresOf(id, f, years), quoteFiguresOf(baseId, base, years))
