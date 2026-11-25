// The Borrower Profile (plan docs/plans/borrower-profile.md, Stage 1; Connor
// 2026-11-24). Everything here is worked out from what's already on the file
// (the 1003, income worksheets, Max Approval, the Selected estimate, MyHome's
// reported accounts, Docs & Conditions); nothing is stored. Pure and tested.
//
// Every figure carries where it came from:
//   reported  the borrower told us (the 1003 as entered, the application, MyHome)
//   estimated worked out or assumed (Max Approval, the Selected estimate, defaults)
//   verified  backed by a document (a final income worksheet, a statement on
//             file) or the credit report (debts once credit is pulled)
//   missing   not on the file yet: shown as "Missing", never as $0
// The qualification status is the pipeline stage (Connor's choice); readiness
// adds a hint beside it and is never stored.
import { round } from '@/lib/calc/round'

export type Source = 'reported' | 'estimated' | 'verified' | 'missing'

export interface Figure {
  value: number | null
  source: Source
}

export const SOURCE_LABEL: Record<Source, string> = {
  reported: 'Borrower-reported',
  estimated: 'Estimated',
  verified: 'Verified',
  missing: 'Missing',
}

/** A figure, or Missing when there's no value (never 0 for "not entered"). */
export const fig = (value: number | null | undefined, source: Exclude<Source, 'missing'>): Figure =>
  value == null || !Number.isFinite(value) ? { value: null, source: 'missing' } : { value: round(value), source }

// ---------------------------------------------------------------------------
// Qualification status (the stage) and the readiness hint
// ---------------------------------------------------------------------------

export type QualificationStatus = 'not_reviewed' | 'in_progress' | 'pre_qualified' | 'additional_info' | 'not_qualified' | 'pre_approved'

export const QUALIFICATION_LABEL: Record<QualificationStatus, string> = {
  not_reviewed: 'Not reviewed',
  in_progress: 'Pre-qualification in progress',
  pre_qualified: 'Pre-qualified',
  additional_info: 'Additional information required',
  not_qualified: 'Not currently qualified',
  pre_approved: 'Pre-approved',
}

const PRE_APPROVED_OR_LATER = ['pre_approved', 'home_search', 'under_contract', 'processing', 'underwriting', 'clear_to_close', 'closed']

/**
 * The status from the stage, and the readiness hint. Pre-qualified and
 * pre-approved come only from the stage (the LO moved it); readiness can only
 * say more is needed, never that they qualify.
 */
export function qualification(stage: string, readinessLevel: 'not_ready' | 'manual_review' | 'needs_documents' | 'ready' | null): { status: QualificationStatus; hint: QualificationStatus | null; qualified: boolean } {
  const status: QualificationStatus = PRE_APPROVED_OR_LATER.includes(stage)
    ? 'pre_approved'
    : stage === 'pre_qualified'
      ? 'pre_qualified'
      : stage === 'nurture'
        ? 'not_qualified'
        : stage === 'contacted'
          ? 'in_progress'
          : 'not_reviewed'
  const qualified = status === 'pre_qualified' || status === 'pre_approved'
  const hint: QualificationStatus | null = qualified || status === 'not_qualified' ? null : readinessLevel === 'needs_documents' ? 'additional_info' : readinessLevel === 'not_ready' ? 'not_qualified' : null
  return { status, hint, qualified }
}

// ---------------------------------------------------------------------------
// Income
// ---------------------------------------------------------------------------

export interface JobIn {
  id: string
  contactId: string
  employerName: string
  positionTitle: string | null
  status: 'current' | 'previous' | string
  startDate: string | null
  endDate: string | null
  isSelfEmployed: boolean
  baseIncome: number | null
  overtimeIncome: number | null
  bonusIncome: number | null
  commissionIncome: number | null
  otherEmploymentIncome: number | null
  militaryEntitlements: number | null
  selfEmployedIncome: number | null
}

export interface WorksheetIn {
  contactId: string
  employmentId: string | null
  status: 'draft' | 'final'
  /** What was pushed to the 1003 (final worksheets). */
  pushedMonthly: number | null
}

export interface JobLine {
  id: string
  contactId: string
  employer: string
  title: string | null
  current: boolean
  type: 'W-2' | 'Self-employed'
  startDate: string | null
  endDate: string | null
  base: Figure
  variable: Figure
  selfEmployed: Figure
  /** This job's monthly qualifying income (current jobs only count). */
  monthly: Figure
}

const sum = (xs: (number | null)[]) => (xs.some((x) => x != null) ? xs.reduce<number>((s, x) => s + (x ?? 0), 0) : null)

export function jobLines(jobs: JobIn[], worksheets: WorksheetIn[]): JobLine[] {
  return jobs.map((j) => {
    const verified = worksheets.some((w) => w.employmentId === j.id && w.status === 'final' && w.pushedMonthly != null)
    const src: Exclude<Source, 'missing'> = verified ? 'verified' : 'reported'
    const variable = sum([j.overtimeIncome, j.bonusIncome, j.commissionIncome, j.otherEmploymentIncome, j.militaryEntitlements])
    const monthly = sum([j.baseIncome, variable, j.selfEmployedIncome])
    return {
      id: j.id,
      contactId: j.contactId,
      employer: j.employerName,
      title: j.positionTitle,
      current: j.status === 'current',
      type: j.isSelfEmployed ? 'Self-employed' : 'W-2',
      startDate: j.startDate,
      endDate: j.endDate,
      base: fig(j.baseIncome, src),
      variable: fig(variable, src),
      selfEmployed: fig(j.selfEmployedIncome, src),
      monthly: fig(monthly, src),
    }
  })
}

/** How the income stands: every current job checked against a final worksheet, some, or none; null with no income. */
export function incomeVerification(lines: JobLine[]): 'verified' | 'partly' | 'unverified' | null {
  const current = lines.filter((l) => l.current && l.monthly.value != null)
  if (!current.length) return null
  const v = current.filter((l) => l.monthly.source === 'verified').length
  return v === current.length ? 'verified' : v > 0 ? 'partly' : 'unverified'
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export type AssetGroup = 'checking' | 'savings' | 'investment' | 'retirement' | 'gift' | 'other'

export const ASSET_GROUP_LABEL: Record<AssetGroup, string> = {
  checking: 'Checking',
  savings: 'Savings',
  investment: 'Investment',
  retirement: 'Retirement',
  gift: 'Gift funds',
  other: 'Other eligible assets',
}

/** Which bucket a 1003 asset type goes in. */
export function assetGroup(type: string): AssetGroup {
  if (type === 'checking') return 'checking'
  if (type === 'savings' || type === 'money_market' || type === 'certificate_of_deposit') return 'savings'
  if (['stocks', 'stock_options', 'bonds', 'mutual_fund', 'trust_account', 'bridge_loan_proceeds'].includes(type)) return type === 'bridge_loan_proceeds' ? 'other' : 'investment'
  if (type === 'retirement') return 'retirement'
  if (type === 'gift_cash' || type === 'gift_equity' || type === 'grant') return 'gift'
  return 'other'
}

const LIQUID: AssetGroup[] = ['checking', 'savings']

export interface AssetIn {
  id: string
  contactId: string
  assetType: string
  institutionName: string | null
  accountLast4: string | null
  amount: number | null
  useAs: string
}

export interface AssetLine {
  id: string
  group: AssetGroup
  name: string
  amount: Figure
}

/** The 1003's assets by group: a borrower with a bank / investment statement on file counts as document-verified. */
export function assetLines(assets: AssetIn[], statementContacts: string[]): AssetLine[] {
  return assets.map((a) => {
    const group = assetGroup(a.assetType)
    const verified = group !== 'gift' && statementContacts.includes(a.contactId)
    return { id: a.id, group, name: [a.institutionName, a.accountLast4 ? `··${a.accountLast4}` : null].filter(Boolean).join(' ') || ASSET_GROUP_LABEL[group], amount: fig(a.amount, verified ? 'verified' : 'reported') }
  })
}

/** Liquid = checking and savings; eligible = what Max Approval counts (own funds + gifts). Missing with no assets. */
export function assetTotals(lines: AssetLine[], eligible: number | null): { liquid: Figure; total: Figure; eligible: Figure } {
  const liquid = lines.filter((l) => LIQUID.includes(l.group))
  const src = (ls: AssetLine[]): Exclude<Source, 'missing'> => (ls.length && ls.every((l) => l.amount.source === 'verified') ? 'verified' : 'reported')
  return {
    liquid: fig(sum(liquid.map((l) => l.amount.value)), src(liquid)),
    total: fig(sum(lines.map((l) => l.amount.value)), src(lines)),
    eligible: lines.length ? fig(eligible, src(lines)) : { value: null, source: 'missing' },
  }
}

// ---------------------------------------------------------------------------
// Liabilities and real estate owned
// ---------------------------------------------------------------------------

export interface LiabilityIn {
  id: string
  liabilityType: string
  creditorName: string | null
  unpaidBalance: number | null
  monthlyPayment: number | null
  toBePaidOff: boolean
}

/** Debts: credit-report verified once credit is pulled, else as reported. Total monthly leaves out debts paid off at closing. */
export function liabilityLines(debts: LiabilityIn[], creditPulled: boolean) {
  const src: Exclude<Source, 'missing'> = creditPulled ? 'verified' : 'reported'
  const lines = debts.map((d) => ({ id: d.id, name: d.creditorName || d.liabilityType.replace(/_/g, ' '), type: d.liabilityType, balance: fig(d.unpaidBalance, src), payment: fig(d.monthlyPayment, src), paidOff: d.toBePaidOff }))
  const kept = lines.filter((l) => !l.paidOff)
  return { lines, monthly: debts.length ? fig(sum(kept.map((l) => l.payment.value)) ?? 0, src) : ({ value: null, source: 'missing' } as Figure) }
}

export interface ReoIn {
  id: string
  addressLine: string
  city: string | null
  status: string
  occupancy: string | null
  disposition: string | null
  estimatedValue: number | null
  monthlyRent: number | null
  annualTaxes: number | null
  annualInsurance: number | null
  monthlyHoa: number | null
  liens: { balance: number | null; monthlyPayment: number | null }[]
}

export function reoLines(homes: ReoIn[]) {
  return homes.map((h) => {
    const balance = h.liens.length ? sum(h.liens.map((l) => l.balance)) : 0
    const mortgage = sum(h.liens.map((l) => l.monthlyPayment))
    const costs = sum([mortgage, h.annualTaxes == null ? null : h.annualTaxes / 12, h.annualInsurance == null ? null : h.annualInsurance / 12, h.monthlyHoa])
    return {
      id: h.id,
      address: [h.addressLine, h.city].filter(Boolean).join(', '),
      occupancy: h.occupancy,
      disposition: h.disposition,
      value: fig(h.estimatedValue, 'reported'),
      balance: fig(balance, 'reported'),
      housing: fig(costs, 'reported'),
      rent: fig(h.monthlyRent, 'reported'),
      equity: fig(h.estimatedValue != null && balance != null ? h.estimatedValue - balance : null, 'estimated'),
    }
  })
}

// ---------------------------------------------------------------------------
// Discrepancies and missing information
// ---------------------------------------------------------------------------

export interface Flag {
  level: 'warning' | 'info'
  text: string
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

/** Where what the borrower says and what's verified or worked out disagree, and what's missing. */
export function profileFlags(p: {
  isPurchase: boolean
  targetPrice: number | null
  maxPrice: number | null
  maxMissing: string | null
  income: number | null
  jobs: JobLine[]
  worksheets: WorksheetIn[]
  assets1003: number | null
  assetsMyHome: number | null
  score: number | null
  creditPulled: boolean
  hasDebts: boolean
  rate: number | null
}): Flag[] {
  const flags: Flag[] = []
  if (p.isPurchase && p.targetPrice != null && p.maxPrice != null && p.targetPrice > p.maxPrice)
    flags.push({ level: 'warning', text: `The target price (${money(p.targetPrice)}) is above the maximum calculated price (${money(p.maxPrice)}).` })
  for (const j of p.jobs) {
    const w = p.worksheets.find((x) => x.employmentId === j.id && x.status === 'final' && x.pushedMonthly != null)
    if (!w) continue
    const draft = p.worksheets.find((x) => x.employmentId === j.id && x.status === 'draft')
    if (draft) flags.push({ level: 'info', text: `${j.employer}: an AI income draft is waiting for review.` })
  }
  if (p.assets1003 != null && p.assetsMyHome != null && Math.abs(p.assetsMyHome - p.assets1003) >= Math.max(1000, p.assets1003 * 0.1))
    flags.push({ level: 'warning', text: `MyHome balances (${money(p.assetsMyHome)}) differ from the 1003 assets (${money(p.assets1003)}). Ask for updated statements.` })
  if (p.income == null) flags.push({ level: 'warning', text: 'Income: missing. Qualifying income and DTI are pending.' })
  if (p.assets1003 == null) flags.push({ level: 'warning', text: 'Assets: none on the 1003 yet.' })
  if (p.score == null) flags.push({ level: 'warning', text: 'Credit score: missing.' })
  else if (!p.creditPulled) flags.push({ level: 'info', text: 'Credit score is borrower-reported; mortgage credit not pulled yet.' })
  if (!p.hasDebts && !p.creditPulled) flags.push({ level: 'info', text: 'No debts entered; confirm with a credit pull.' })
  if (p.isPurchase && p.targetPrice == null) flags.push({ level: 'info', text: 'Target purchase price: missing.' })
  if (p.isPurchase && p.maxPrice == null && p.maxMissing) flags.push({ level: 'info', text: `Maximum price not calculated: ${p.maxMissing}` })
  if (p.rate == null) flags.push({ level: 'info', text: 'Interest rate: not set (no Selected estimate or rate on the file).' })
  return flags
}
