// The Lenders list (mockup 08): what each lender offers, whether it needs
// attention, your loans with it, the summary tiles and the filters. Pure.

import { isStale, oldestVerified } from './stale'
import type { DocType, Feature, LenderStatus, Lien, ProductFamily } from './taxonomy'

/** The product-type words a lender "offers", in the order the filters show them. */
export const OFFER_TAGS = ['Conventional', 'FHA', 'VA', 'USDA', 'Jumbo', 'DSCR', 'Bank statement', '1099 / P&L', 'Asset depletion', '2nd lien', 'HELOC', 'ITIN', 'Foreign national', 'DPA'] as const
export type OfferTag = (typeof OFFER_TAGS)[number]

export interface SummaryProgram {
  family: ProductFamily
  lien: Lien
  docTypes: DocType[]
  features: Feature[]
  active: boolean
  lastVerifiedOn: string | null
}

const FAMILY_TAG: Partial<Record<ProductFamily, OfferTag>> = { conventional: 'Conventional', fha: 'FHA', va: 'VA', usda: 'USDA', jumbo: 'Jumbo' }

/** Every product-type word a program counts under (a DSCR closed-end second is both "DSCR" and "2nd lien"). */
export function offerTags(p: Pick<SummaryProgram, 'family' | 'lien' | 'docTypes' | 'features'>): OfferTag[] {
  const tags = new Set<OfferTag>()
  if (FAMILY_TAG[p.family]) tags.add(FAMILY_TAG[p.family]!)
  if (p.docTypes.includes('dscr')) tags.add('DSCR')
  if (p.docTypes.some((d) => d === 'bank_statement_12' || d === 'bank_statement_24')) tags.add('Bank statement')
  if (p.docTypes.some((d) => d === 'form_1099' || d === 'pnl_only')) tags.add('1099 / P&L')
  if (p.docTypes.includes('asset_depletion')) tags.add('Asset depletion')
  if (p.lien === 'ces') tags.add('2nd lien')
  if (p.lien === 'heloc') tags.add('HELOC')
  if (p.features.includes('itin')) tags.add('ITIN')
  if (p.features.includes('foreign_national')) tags.add('Foreign national')
  if (p.features.includes('dpa')) tags.add('DPA')
  return OFFER_TAGS.filter((t) => tags.has(t))
}

/** How many of a lender's programs in searches offer each product type, in filter order; types it doesn't offer are left out. */
export function offerCounts(programs: SummaryProgram[]): { tag: OfferTag; count: number }[] {
  const active = programs.filter((p) => p.active)
  return OFFER_TAGS.map((tag) => ({ tag, count: active.filter((p) => offerTags(p).includes(tag)).length })).filter((c) => c.count > 0)
}

export interface LenderLoan {
  stage: string
  closingDate: string | null
}

/** Your loans with a lender (files where you chose one of its programs): closed this year, and still in process. */
export function loanCounts(loans: LenderLoan[], year: number): { closedThisYear: number; active: number } {
  return {
    closedThisYear: loans.filter((l) => l.stage === 'closed' && (l.closingDate == null || l.closingDate.startsWith(String(year)))).length,
    active: loans.filter((l) => l.stage !== 'closed' && l.stage !== 'lost' && l.stage !== 'nurture').length,
  }
}

export interface ListLender {
  id: string
  name: string
  shortName: string | null
  status: LenderStatus
  states: string[] | null
  aeName: string | null
  programs: (SummaryProgram & { name: string })[]
  /** Matrices typed or read, waiting for review. */
  pendingReviews: number
}

export type MatrixState = 'current' | 'stale' | 'none'

/** The matrix date to show on a lender's card: the oldest verified date among programs in searches, and whether it's stale. */
export function matrixState(l: Pick<ListLender, 'programs'>, today: string): { verifiedOn: string | null; state: MatrixState } {
  const active = l.programs.filter((p) => p.active)
  if (active.length === 0) return { verifiedOn: null, state: 'none' }
  const verifiedOn = oldestVerified(active)
  return { verifiedOn, state: isStale(verifiedOn, today) ? 'stale' : 'current' }
}

/** A lender needs attention when a matrix waits for review or its matrix is stale. */
export const needsAttention = (l: ListLender, today: string) => l.pendingReviews > 0 || matrixState(l, today).state === 'stale'

/** The tiles across the top of the list. */
export function lenderTiles(lenders: ListLender[], today: string) {
  return {
    lenders: lenders.filter((l) => l.status !== 'inactive').length,
    approved: lenders.filter((l) => l.status === 'approved').length,
    notYet: lenders.filter((l) => l.status === 'pending' || l.status === 'not_signed_up').length,
    programs: lenders.reduce((n, l) => n + l.programs.filter((p) => p.active).length, 0),
    attention: lenders.filter((l) => needsAttention(l, today)).length,
  }
}

export type LenderTab = 'all' | 'attention' | LenderStatus

export interface LenderFilters {
  tab: LenderTab
  text: string
  /** Lenders offering every one of these product types. */
  offers: OfferTag[]
}

/** The lenders the tab, search box and "offers" chips leave. Search covers the name, short name, AE, states and program names. */
export function filterLenders(lenders: ListLender[], f: LenderFilters, today: string): ListLender[] {
  const words = f.text.toLowerCase().split(/\s+/).filter(Boolean)
  return lenders.filter((l) => {
    if (f.tab === 'attention' ? !needsAttention(l, today) : f.tab !== 'all' && l.status !== f.tab) return false
    const tags = offerCounts(l.programs).map((c) => c.tag)
    if (!f.offers.every((t) => tags.includes(t))) return false
    const hay = [l.name, l.shortName, l.aeName, ...(l.states ?? []), ...l.programs.map((p) => p.name)].filter(Boolean).join(' ').toLowerCase()
    return words.every((w) => hay.includes(w))
  })
}

/** How many lenders each tab would show (with the search and offers applied). */
export function tabCounts(lenders: ListLender[], f: Omit<LenderFilters, 'tab'>, today: string): Record<LenderTab, number> {
  const tabs: LenderTab[] = ['all', 'attention', 'approved', 'pending', 'not_signed_up', 'inactive']
  return Object.fromEntries(tabs.map((tab) => [tab, filterLenders(lenders, { ...f, tab }, today).length])) as Record<LenderTab, number>
}
