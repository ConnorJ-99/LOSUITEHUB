// Open house pages (Pages Phase 2, Connor 2026-11-06; mockups "Open house
// builder" and "Open house site · phone"). The home's facts live in
// pages.property; the financing table is figured here with the Fees tab's
// own engine (priceScenario: payment with taxes, insurance, HOA and mortgage
// insurance, the Settings fee list, prepaids and escrows) and saved with the
// page, so the live page and the flyer show the same numbers without
// recalculating. No new math: this only sets up the scenarios.
import { round, type FeeTemplate } from '@/lib/calc'
import type { MortgageType } from '@/lib/api/types'
import { cashFigure, priceScenario, type ScenarioDraft } from '@/lib/pricing/scenario'

export type FinancingKey = 'conventional' | 'fha' | 'va' | 'custom'

export interface FinancingOption {
  key: FinancingKey
  label: string
  mortgageType: MortgageType
  downPct: number
  ratePct: number | null
  termMonths: number
  show: boolean
  /** Saved results (null until there's a price and a rate). */
  figures: FinancingFigures | null
}

export interface FinancingFigures {
  downPayment: number
  baseLoanAmount: number
  loanAmount: number
  monthlyPayment: number
  principalAndInterest: number
  mortgageInsurance: number
  closingCosts: number
  cashToClose: number
}

export interface OpenHouseProperty {
  address: string
  /** City, state ZIP on the second line ("Frisco, TX 75034"). */
  cityLine: string
  listPrice: number | null
  beds: number | null
  baths: number | null
  sqft: number | null
  taxesMonthly: number | null
  hoaMonthly: number | null
  insuranceMonthly: number | null
  /** YYYY-MM-DD, and "13:00" style times. */
  openDate: string | null
  startTime: string | null
  endTime: string | null
  /** Public page-assets URLs; the first is the hero photo. */
  photos: string[]
  agentPartnerId: string | null
  agentPhotoUrl: string | null
  financing: FinancingOption[]
  /** The date the rates were entered, printed in the disclaimer. */
  ratesAsOf: string | null
}

/** Until a county table exists: the Prequal tab's defaults (2.2% tax, $3,600 a year insurance). */
export const DEFAULT_TAX_RATE_PCT = 2.2
export const DEFAULT_ANNUAL_INSURANCE = 3600
const PREPAID_INTEREST_DAYS = 15

export const FINANCING_DISCLAIMER =
  'Estimates only, for a 30-year fixed loan. Payments include principal, interest, taxes, insurance, HOA and mortgage insurance. Rates are subject to change and to credit approval. This is not a commitment to lend.'

export function defaultFinancing(): FinancingOption[] {
  return [
    { key: 'conventional', label: 'Conventional', mortgageType: 'conventional', downPct: 5, ratePct: null, termMonths: 360, show: true, figures: null },
    { key: 'fha', label: 'FHA', mortgageType: 'fha', downPct: 3.5, ratePct: null, termMonths: 360, show: true, figures: null },
    { key: 'va', label: 'VA', mortgageType: 'va', downPct: 0, ratePct: null, termMonths: 360, show: true, figures: null },
    { key: 'custom', label: 'Custom', mortgageType: 'conventional', downPct: 20, ratePct: null, termMonths: 360, show: false, figures: null },
  ]
}

export function blankProperty(): OpenHouseProperty {
  return {
    address: '',
    cityLine: '',
    listPrice: null,
    beds: null,
    baths: null,
    sqft: null,
    taxesMonthly: null,
    hoaMonthly: null,
    insuranceMonthly: null,
    openDate: null,
    startTime: '13:00',
    endTime: '16:00',
    photos: [],
    agentPartnerId: null,
    agentPhotoUrl: null,
    financing: defaultFinancing(),
    ratesAsOf: null,
  }
}

/** Reads what's saved, filling anything missing (older pages, partial saves). */
export function readProperty(raw: unknown): OpenHouseProperty {
  const base = blankProperty()
  if (typeof raw !== 'object' || raw === null) return base
  const r = raw as Partial<OpenHouseProperty>
  const financing = base.financing.map((d) => ({ ...d, ...(r.financing?.find((f) => f.key === d.key) ?? {}) }))
  return { ...base, ...r, photos: Array.isArray(r.photos) ? r.photos : [], financing }
}

/** Estimated monthly taxes and insurance for a price, when the listing doesn't give them. */
export function estimatedHousing(listPrice: number): { taxesMonthly: number; insuranceMonthly: number } {
  return { taxesMonthly: round((listPrice * DEFAULT_TAX_RATE_PCT) / 100 / 12), insuranceMonthly: round(DEFAULT_ANNUAL_INSURANCE / 12) }
}

function draft(p: OpenHouseProperty, o: FinancingOption, baseLoan: number): ScenarioDraft {
  return {
    loanId: '',
    propertyId: null,
    name: o.label,
    lenderName: null,
    programName: o.label,
    mortgageType: o.mortgageType,
    amortizationType: 'fixed',
    interestOnly: false,
    termMonths: o.termMonths,
    noteRate: o.ratePct,
    qualifyingRate: null,
    buydown: null,
    lockDays: null,
    loanAmount: baseLoan,
    purchasePrice: p.listPrice,
    propertyValue: p.listPrice,
    taxesValue: p.taxesMonthly ?? 0,
    taxesFactor: 'monthly',
    insuranceValue: p.insuranceMonthly ?? 0,
    insuranceFactor: 'monthly',
    supplementalInsuranceMonthly: null,
    monthlyHoa: p.hoaMonthly ?? 0,
    monthlyMi: null,
    otherPaymentMonthly: null,
    otherPaymentLabel: null,
    impoundWaiver: 'none',
    estimatedFundingDate: null,
    firstPaymentDate: null,
    pointsPct: 0,
    lenderCredit: 0,
    prepaidInterestDays: PREPAID_INTEREST_DAYS,
    hoiPrepaidMonths: null,
    taxPrepaidMonths: null,
    hoiReserveMonths: null,
    taxReserveMonths: null,
    miReserveMonths: null,
    aggregateAdjustment: 0,
    notes: null,
  }
}

/** One program's payment and cash to close, or null without a price and a rate. */
export function financingFigures(p: OpenHouseProperty, o: FinancingOption, templates: FeeTemplate[]): FinancingFigures | null {
  if (!p.listPrice || p.listPrice <= 0 || o.ratePct == null || o.ratePct <= 0 || !(o.termMonths > 0)) return null
  const downPayment = round((p.listPrice * Math.max(0, Math.min(100, o.downPct))) / 100)
  const baseLoan = round(p.listPrice - downPayment)
  if (baseLoan <= 0) return null
  const priced = priceScenario(draft(p, o, baseLoan), 'purchase', templates, [])
  const { figures } = priced
  const cash = cashFigure({
    purpose: 'purchase',
    purchasePrice: p.listPrice,
    totalLoanAmount: figures.totalLoanAmount,
    financedFee: figures.financedFee,
    closingCosts: priced.closingCosts,
    payoffs: 0,
    earnestMoney: 0,
    sellerCredits: 0,
  })
  return {
    downPayment,
    baseLoanAmount: baseLoan,
    loanAmount: figures.totalLoanAmount,
    monthlyPayment: figures.pitia,
    principalAndInterest: figures.payment.principalAndInterest,
    mortgageInsurance: figures.payment.mi,
    closingCosts: priced.closingCosts,
    cashToClose: cash.label === 'Cash to close' ? cash.amount : 0,
  }
}

/** Every option figured again (after any change to the home or a rate). */
export function refigure(p: OpenHouseProperty, templates: FeeTemplate[]): OpenHouseProperty {
  return { ...p, financing: p.financing.map((o) => ({ ...o, figures: financingFigures(p, o, templates) })) }
}

/** "Sat, Nov 14 · 1:00–4:00 PM". */
export function openHouseWhen(p: Pick<OpenHouseProperty, 'openDate' | 'startTime' | 'endTime'>): string | null {
  if (!p.openDate) return null
  const d = new Date(`${p.openDate}T12:00:00`)
  if (Number.isNaN(d.getTime())) return null
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(d)
  const t = (hhmm: string | null) => {
    if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null
    const [h, m] = hhmm.split(':').map(Number)
    return { text: `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`, pm: h >= 12 }
  }
  const a = t(p.startTime)
  const b = t(p.endTime)
  if (!a) return day
  if (!b) return `${day} · ${a.text} ${a.pm ? 'PM' : 'AM'}`
  return `${day} · ${a.text}${a.pm === b.pm ? '' : ` ${a.pm ? 'PM' : 'AM'}`}–${b.text} ${b.pm ? 'PM' : 'AM'}`
}

/** "Open House – 4218 Fairway Bend Dr", the tag sign-ins get. */
export const openHouseTag = (address: string) => `Open House – ${address.trim() || 'address TBD'}`

/** A web address from the street: "4218-fairway-bend-dr". */
export const openHouseSlugBase = (address: string) =>
  address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '') || 'open-house'
