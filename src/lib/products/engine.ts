// The Product Search engine (docs/plans/product-search-v2.md §4). Pure,
// deterministic, no AI: the product-type gate first, then program rules, the
// matrix cell lookup, the Texas §50(a)(6) cap, room left, "how to fit" and
// ranking. Ratios are compared unrounded; rounding is for display only.

import { formatCurrency, formatPercent } from '@/lib/format'
import { OCCUPANCIES, MATRIX_PROPERTY_TYPES, MATRIX_PURPOSES, DOC_TYPES, isDpaProgram, type ProductFamily } from './taxonomy'
import type { Badge, Catalog, CatalogLender, CatalogProgram, CheckItem, Limit, MatrixCell, ProgramResult, ProgramRule, Reason, Scenario, SearchResult } from './types'

const EPS = 1e-9
/** Texas §50(a)(6): homestead cash-out is capped at 80% CLTV (state law, applied to every program). */
export const TEXAS_CASH_OUT_CAP = 80

// ---------------------------------------------------------------------------
// 4.1 Product-type gate
// ---------------------------------------------------------------------------

/** True when a program is the same product type as the scenario. Nothing else is ever evaluated. */
export function passesGate(p: CatalogProgram, s: Scenario, lender: CatalogLender | undefined): boolean {
  if (!p.active || !lender || lender.status === 'inactive') return false
  if (p.lien !== s.lien) return false
  if (s.family !== 'any' && p.family !== s.family) return false
  if (!p.docTypes.includes(s.docType)) return false
  if (!s.features.every((f) => p.features.includes(f))) return false
  // Dedicated DPA programs only when asked for; a program that merely offers a DPA option always shows.
  if (isDpaProgram(p) && !s.features.includes('dpa')) return false
  return true
}

export function gate(s: Scenario, programs: CatalogProgram[], lenders: Map<string, CatalogLender>) {
  const searched: CatalogProgram[] = []
  const families: Partial<Record<ProductFamily, number>> = {}
  let notSearched = 0
  for (const p of programs) {
    if (passesGate(p, s, lenders.get(p.lenderId))) searched.push(p)
    else if (p.active) {
      notSearched++
      families[p.family] = (families[p.family] ?? 0) + 1
    }
  }
  return { searched, notSearched: { count: notSearched, families } }
}

// ---------------------------------------------------------------------------
// Ratios
// ---------------------------------------------------------------------------

/** The price, on a 1st-lien purchase only (a price left over from editing never counts on a refinance or a 2nd). */
export const purchasePriceOf = (s: Scenario) => (s.purpose === 'purchase' && s.lien === 'first' ? s.purchasePrice : null)

/** The value LTV is figured on: the lower of price and value for a purchase, plus any other collateral homes' full value. */
export const ratioBasis = (s: Scenario) => {
  const price = purchasePriceOf(s)
  return (price ? Math.min(price, s.value || price) : s.value) + (s.otherCollateralValue ?? 0)
}

/** LTV of this lien and CLTV of all liens, as percents (unrounded). */
export function ratios(s: Scenario) {
  const basis = ratioBasis(s)
  if (basis <= 0) return { ltv: Infinity, cltv: Infinity }
  const first = s.lien === 'first' ? 0 : s.firstLienBalance
  return { ltv: (s.loanAmount / basis) * 100, cltv: ((s.loanAmount + first) / basis) * 100 }
}

/** 1st liens qualify on LTV; 2nd liens and HELOCs on CLTV. */
const ratioKind = (p: CatalogProgram): 'ltv' | 'cltv' => (p.lien === 'first' ? 'ltv' : 'cltv')
const ratioOf = (p: CatalogProgram, s: Scenario) => ratios(s)[ratioKind(p)]
const cellMax = (c: MatrixCell, kind: 'ltv' | 'cltv') => (kind === 'ltv' ? (c.maxLtv ?? c.maxCltv) : (c.maxCltv ?? c.maxLtv))

/** The amount that picks the matrix's loan tier: the loan, or (for some 2nds) 1st + 2nd. */
export const tierAmount = (p: CatalogProgram, s: Scenario, loan = s.loanAmount) => (p.lien !== 'first' && p.loanAmountBasis === 'combined' ? loan + s.firstLienBalance : loan)

export const texasCap = (s: Scenario) => (s.state === 'TX' && s.homestead && s.purpose === 'cash_out' ? TEXAS_CASH_OUT_CAP : null)

// ---------------------------------------------------------------------------
// 4.3 Matrix lookup
// ---------------------------------------------------------------------------

/** " up to $150,000" when the band has several loan tiers, else nothing. */
const tierLabel = (c: MatrixCell, band: MatrixCell[]) =>
  band.some((o) => o.loanAmountMin !== c.loanAmountMin || o.loanAmountMax !== c.loanAmountMax) ? (c.loanAmountMax != null ? ` up to ${formatCurrency(c.loanAmountMax)}` : ` over ${formatCurrency(c.loanAmountMin)}`) : ''
/** Credit scores printed as minimums: "700" means 700 and up, not 700–719. */
const isMinimum = (c: MatrixCell) => c.creditMode === 'minimums'
/** A grid whose rows or tiers overlap on purpose (a $1.5M tier also covers a $400K loan; a 700 row also covers 740). */
const isInclusive = (c: MatrixCell) => isMinimum(c) || c.loanAmountMode === 'max_tiers'
/** A blank square that only means "nothing printed here": it never blocks, and another tier can cover the loan. */
const isIgnoredBlank = (c: MatrixCell) => !c.offered && c.blankMode === 'not_specified'
const bandLabel = (c: MatrixCell) => (isMinimum(c) || c.ficoMax >= 850 ? `${c.ficoMin}+` : `${c.ficoMin}–${c.ficoMax}`)
const inBand = (c: MatrixCell, fico: number) => fico >= c.ficoMin && (isMinimum(c) || fico <= c.ficoMax)
const inTier = (c: MatrixCell, amount: number) => amount >= c.loanAmountMin && (c.loanAmountMax == null || amount <= c.loanAmountMax)
/** "via the $1,500,000 tier at 700+ FICO" (a max-tier or minimum-score grid), else "at 700–719". */
const viaLabel = (c: MatrixCell) => (isInclusive(c) ? `${c.loanAmountMax != null ? `via the ${formatCurrency(c.loanAmountMax)} tier ` : ''}at ${c.ficoMin}+ FICO` : `at ${bandLabel(c)}`)

/** The cell dimensions other than credit band and loan tier, each with how to say it's missing. */
function dimensions(s: Scenario): [(c: MatrixCell) => boolean, string][] {
  return [
    [(c) => c.occupancy === s.occupancy, `Not offered for ${OCCUPANCIES.label[s.occupancy].toLowerCase()}`],
    [(c) => c.propertyTypes.includes(s.propertyType), `Not offered for ${MATRIX_PROPERTY_TYPES.label[s.propertyType]}`],
    [(c) => s.units >= c.unitsMin && s.units <= c.unitsMax, `Not offered for ${s.units} unit${s.units === 1 ? '' : 's'}`],
    [(c) => c.purposes.includes(s.purpose), `Not offered for ${MATRIX_PURPOSES.label[s.purpose].toLowerCase()}`],
    [(c) => c.docType === s.docType, `Not offered with ${DOC_TYPES.label[s.docType]}`],
    [(c) => !c.citizenship || c.citizenship === s.citizenship, 'Not offered for this citizenship'],
    [(c) => c.dscrMin == null || s.dscr == null || s.dscr >= c.dscrMin, 'DSCR below the matrix minimum'],
  ]
}

/** Cells that match everything except credit band and loan tier. */
const scenarioCells = (p: CatalogProgram, s: Scenario) => {
  const dims = dimensions(s)
  return p.cells.filter((c) => dims.every(([match]) => match(c)))
}

/** Cells that are the same circumstance (one printed grid): they differ only by credit score and loan amount. */
const familyKey = (c: MatrixCell) => [c.occupancy, [...c.propertyTypes].sort().join('+'), [...c.purposes].sort().join('+'), c.docType, c.unitsMin, c.unitsMax, c.dscrMin ?? '', c.citizenship ?? '', isInclusive(c) ? 'inclusive' : 'exact'].join('|')

/**
 * Loan-amount tiers and minimum scores: of the rows the borrower meets (score at or above the row's minimum,
 * loan at or under the tier's maximum), the highest limit is the one the lender allows. On a tie, the smallest
 * tier is named. A blank square is skipped when blanks mean "not specified"; when blanks mean "not offered",
 * a blank in the borrower's own square (the smallest tier and highest score row they reach) blocks.
 */
function bestTier(hits: MatrixCell[], limit: (c: MatrixCell) => number): MatrixCell | null {
  const tier = (c: MatrixCell) => c.loanAmountMax ?? Infinity
  const ownTier = Math.min(...hits.map(tier))
  const ownRow = Math.max(...hits.map((c) => c.ficoMin))
  const blocked = hits.find((c) => !c.offered && !isIgnoredBlank(c) && tier(c) === ownTier && c.ficoMin === ownRow)
  if (blocked) return blocked
  const offered = hits.filter((c) => c.offered)
  if (offered.length === 0) return null
  return offered.reduce((best, c) => (limit(c) > limit(best) || (limit(c) === limit(best) && (tier(c) < tier(best) || (tier(c) === tier(best) && c.ficoMin > best.ficoMin))) ? c : best))
}

/** Printed ranges and credit bands: one square applies; if two overlap, a blank ("not offered") wins, then the lower limit. */
function strictest(hits: MatrixCell[], limit: (c: MatrixCell) => number): MatrixCell | null {
  const live = hits.filter((c) => !isIgnoredBlank(c))
  if (live.length === 0) return null
  return live.find((c) => !c.offered) ?? live.reduce((low, c) => (limit(c) < limit(low) ? c : low))
}

/**
 * The governing cell at a credit score and loan amount, or null when nothing covers it.
 * Within one grid, loan-amount tiers and minimum scores take the highest limit the borrower reaches (bestTier);
 * across overlapping circumstances (a condo cell and a cash-out cell that both apply) the lower limit wins,
 * and a cell that is not offered wins over any limit.
 */
function cellAt(p: CatalogProgram, s: Scenario, cells: MatrixCell[], fico: number, loan: number): MatrixCell | null {
  const amount = tierAmount(p, s, loan)
  let hits = cells.filter((c) => inBand(c, fico) && inTier(c, amount))
  if (hits.length === 0) return null
  // Grids by DSCR level ("1.00+", "0.75–0.99"): the highest level the borrower's DSCR reaches governs.
  // With the DSCR unknown, every level applies and the lowest limit wins.
  const levels = s.dscr == null ? [] : hits.flatMap((c) => (c.dscrMin != null ? [c.dscrMin] : []))
  if (levels.length) hits = hits.filter((c) => c.dscrMin == null || c.dscrMin === Math.max(...levels))
  const kind = ratioKind(p)
  const limit = (c: MatrixCell) => cellMax(c, kind) ?? 0
  const families = new Map<string, MatrixCell[]>()
  for (const c of hits) {
    const k = familyKey(c)
    const family = families.get(k)
    if (family) family.push(c)
    else families.set(k, [c])
  }
  let governing: MatrixCell | null = null
  for (const family of families.values()) {
    const pick = isInclusive(family[0]) ? bestTier(family, limit) : strictest(family, limit)
    if (!pick) continue
    if (!pick.offered) return pick
    if (!governing || limit(pick) < limit(governing)) governing = pick
  }
  return governing
}

/**
 * Program caps: hard "max LTV / CLTV" rules that sit on top of the matrix ("loan amounts under $150,000 max 70% LTV",
 * "Florida condos max 75%"). Rules that only apply above an LTV are conditions, not caps.
 */
const capRules = (p: CatalogProgram, rules: ProgramRule[]) =>
  rules.filter((r) => r.op === '<=' && typeof r.value === 'number' && r.severity === 'hard' && r.appliesWhen?.ltv_above == null && (r.field === ratioKind(p) || (p.lien === 'first' && (r.field === 'ltv' || r.field === 'cltv'))))

interface Effective {
  max: number
  limitedBy: Limit['limitedBy']
  why: string
  /** The cap's own words, when a cap (not the matrix) sets the maximum. */
  cap: string | null
}

/** The effective maximum ratio for a cell: the lower of the matrix, the Texas cap and every program cap that applies to this scenario. */
function effectiveMax(p: CatalogProgram, s: Scenario, c: MatrixCell, rules: ProgramRule[] = p.rules): Effective {
  const matrix = cellMax(c, ratioKind(p)) ?? 0
  const from = `${formatPercent(matrix, 3)} ${viaLabel(c)}`
  let out: Effective = { max: matrix, limitedBy: 'matrix', why: from, cap: null }
  const texas = texasCap(s)
  const texasWords = `Texas §50(a)(6) caps homestead cash-out at ${TEXAS_CASH_OUT_CAP}% CLTV`
  if (texas != null && texas < out.max) out = { max: texas, limitedBy: 'texas', why: `${formatPercent(texas, 3)}: ${texasWords} (the matrix allows ${from})`, cap: texasWords }
  for (const r of capRules(p, rules)) if ((r.value as number) < out.max && applies(r, s, p)) out = { max: r.value as number, limitedBy: 'rule', why: `${formatPercent(r.value as number, 3)}: ${r.message} (the matrix allows ${from})`, cap: r.message }
  return out
}

/**
 * The limit the engine would use for a scenario's credit score and loan amount, before comparing the scenario's
 * own ratio: the generated grid on the matrix review screen and the program drawer show exactly this.
 */
export function limitAt(p: CatalogProgram, s: Scenario, rules: ProgramRule[] = p.rules): ({ status: 'covered'; cell: MatrixCell } & Effective) | { status: 'not_offered'; cell: MatrixCell } | { status: 'not_covered' } {
  const c = cellAt(p, s, scenarioCells(p, s), s.fico ?? 0, s.loanAmount)
  if (!c) return { status: 'not_covered' }
  if (!c.offered) return { status: 'not_offered', cell: c }
  return { status: 'covered', cell: c, ...effectiveMax(p, s, c, rules) }
}

/** Loan amount (this lien) that puts the scenario exactly at a ratio, floored to the dollar. */
function loanAtRatio(p: CatalogProgram, s: Scenario, ratioPct: number) {
  const total = (ratioPct / 100) * ratioBasis(s)
  return Math.floor(p.lien === 'first' ? total + EPS : total - s.firstLienBalance + EPS)
}

const fitsAt = (p: CatalogProgram, s: Scenario, cells: MatrixCell[], fico: number, loan: number, rules: ProgramRule[] = p.rules) => {
  const c = cellAt(p, s, cells, fico, loan)
  if (!c || !c.offered) return false
  const at = { ...s, loanAmount: loan }
  return ratioOf(p, at) <= effectiveMax(p, at, c, rules).max + EPS
}

/**
 * The largest loan (this lien) that fits at a credit score, checked across every loan tier (a bigger loan can land
 * in a tier with a lower limit) and every cap (a cap that only applies to small loans changes the answer).
 */
export function maxLoanAt(p: CatalogProgram, s: Scenario, fico: number, loanCap: number | null = null, rules: ProgramRule[] = p.rules): number | null {
  const all = scenarioCells(p, s)
  const kind = ratioKind(p)
  const caps = [texasCap(s), ...capRules(p, rules).map((r) => r.value as number)].filter((v): v is number => v != null)
  let best: number | null = null
  for (const c of all) {
    if (!c.offered || !inBand(c, fico)) continue
    const matrix = cellMax(c, kind) ?? 0
    for (const ratio of new Set([matrix, ...caps.filter((v) => v < matrix)])) {
      let loan = loanAtRatio(p, s, ratio)
      if (c.loanAmountMax != null) loan = Math.min(loan, p.lien !== 'first' && p.loanAmountBasis === 'combined' ? c.loanAmountMax - s.firstLienBalance : c.loanAmountMax)
      if (loanCap != null) loan = Math.min(loan, loanCap)
      if (loan > 0 && (best == null || loan > best) && fitsAt(p, s, all, fico, loan, rules)) best = loan
    }
  }
  return best
}

// ---------------------------------------------------------------------------
// 4.2 Program rules (and company overlays)
// ---------------------------------------------------------------------------

const PERCENT_FIELDS = new Set(['dti', 'ltv', 'cltv', 'income_vs_ami'])

function ruleValue(r: ProgramRule, s: Scenario, p: CatalogProgram): number | string | boolean | null {
  const { ltv, cltv } = ratios(s)
  switch (r.field) {
    case 'dti': return s.dti
    case 'reserves_months': return s.reservesMonths
    case 'mortgage_lates_12': return s.mortgageLates12
    case 'mortgage_lates_24': return s.mortgageLates24
    case 'bk_seasoning_months': return s.bkSeasoningMonths
    case 'fc_seasoning_months': return s.fcSeasoningMonths
    case 'state': return s.state
    case 'citizenship': return s.citizenship
    case 'self_employed_years': return s.selfEmployedYears
    case 'loan_amount': return tierAmount(p, s)
    case 'fico': return s.fico
    case 'ltv': return ltv
    case 'cltv': return cltv
    case 'dscr': return s.dscr
    case 'units': return s.units
    case 'first_time_buyer': return s.firstTimeBuyer
    case 'income_vs_ami': return s.incomeVsAmiPct
    // Document rules (suggested conditions) never decide eligibility; the catalog leaves them out.
    case 'bank_statement_months':
    case 'asset_statement_months':
    case 'tax_return_years':
      return null
  }
}

function applies(r: ProgramRule, s: Scenario, p: CatalogProgram) {
  const w = r.appliesWhen
  if (!w) return true
  if (w.purposes && !w.purposes.includes(s.purpose)) return false
  if (w.occupancies && !w.occupancies.includes(s.occupancy)) return false
  if (w.ltv_above != null && !(ratioOf(p, s) > w.ltv_above + EPS)) return false
  if (w.loan_amount_below != null && !(tierAmount(p, s) < w.loan_amount_below)) return false
  if (w.states && !w.states.includes(s.state)) return false
  if (w.property_types && !w.property_types.includes(s.propertyType)) return false
  return true
}

function formatValue(field: ProgramRule['field'], v: number | string | boolean | null) {
  if (v == null) return null
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'string') return v
  if (PERCENT_FIELDS.has(field)) return formatPercent(v, 2)
  if (field === 'loan_amount') return formatCurrency(v)
  return String(v)
}

/** pass / fail / verify for one rule. Seasoning rules pass when there's no event; anything else unknown is Verify. */
function check(r: ProgramRule, s: Scenario, p: CatalogProgram): { status: CheckItem['status']; value: ReturnType<typeof ruleValue> } {
  const v = ruleValue(r, s, p)
  if (v === 'unknown') return { status: 'verify', value: null }
  if (v == null) return { status: r.field.endsWith('_seasoning_months') ? 'pass' : 'verify', value: v }
  let ok: boolean
  switch (r.op) {
    case '<=': ok = typeof v === 'number' && v <= (r.value as number) + EPS; break
    case '>=': ok = typeof v === 'number' && v >= (r.value as number) - EPS; break
    case 'in': ok = (r.value as string[]).includes(String(v)); break
    case 'not_in': ok = !(r.value as string[]).includes(String(v)); break
    case 'required': ok = v === true || (typeof v !== 'boolean' && v !== ''); break
    case 'between': {
      const { min, max } = r.value as { min: number; max: number }
      ok = typeof v === 'number' && v >= min - EPS && v <= max + EPS
    }
  }
  return { status: ok ? 'pass' : r.severity === 'verify' ? 'verify' : 'fail', value: v }
}

/** The fix and gap for a failed hard rule. */
function ruleFailure(r: ProgramRule, s: Scenario, p: CatalogProgram, v: ReturnType<typeof ruleValue>): Pick<Reason, 'fix' | 'gap' | 'unfixable'> {
  const limit = typeof r.value === 'number' ? r.value : null
  const gap = typeof v === 'number' && limit ? Math.abs(v - limit) / limit : 1
  if ((r.field === 'ltv' || r.field === 'cltv') && limit != null) return loanFix(s, loanAtRatio(p, s, limit), gap)
  if (r.field === 'first_time_buyer' && r.appliesWhen?.ltv_above != null) return loanFix(s, loanAtRatio(p, s, r.appliesWhen.ltv_above), (ratioOf(p, s) - r.appliesWhen.ltv_above) / r.appliesWhen.ltv_above)
  if (r.field === 'loan_amount' && r.op === '<=' && limit != null) return loanFix(s, Math.floor(p.lien !== 'first' && p.loanAmountBasis === 'combined' ? limit - s.firstLienBalance : limit), gap)
  if (r.field === 'fico' && r.op === '>=' && limit != null && s.fico != null) return { fix: { text: `Needs ${limit} FICO (+${limit - s.fico})`, fico: limit }, gap, unfixable: false }
  if (r.field === 'reserves_months' && limit != null) return { fix: { text: `Needs ${limit} months of reserves` }, gap, unfixable: false }
  if (r.field === 'dti' || r.field === 'dscr' || r.field === 'mortgage_lates_12' || r.field === 'mortgage_lates_24' || r.field.endsWith('_seasoning_months') || r.field === 'self_employed_years') return { fix: null, gap, unfixable: false }
  return { fix: null, gap: 1, unfixable: true }
}

// ---------------------------------------------------------------------------
// 4.5 How to fit
// ---------------------------------------------------------------------------

/** "Lower loan amount to $X (−$Y)", or for a purchase "Fits with N% down ($Z)". */
function loanFix(s: Scenario, loan: number, gap: number): Pick<Reason, 'fix' | 'gap' | 'unfixable'> {
  if (loan <= 0 || loan >= s.loanAmount) return { fix: null, gap: 1, unfixable: true }
  const price = purchasePriceOf(s)
  if (price) {
    const down = price - loan
    return { fix: { text: `Fits with ${formatPercent((down / price) * 100, 2)} down (${formatCurrency(down)})`, loanAmount: loan }, gap, unfixable: false }
  }
  return { fix: { text: `Lower loan amount to ${formatCurrency(loan)} (−${formatCurrency(s.loanAmount - loan)})`, loanAmount: loan }, gap, unfixable: false }
}

/** The lowest credit score at which the scenario, as it is, would fit. */
function ficoThatFits(p: CatalogProgram, s: Scenario, cells: MatrixCell[], rules: ProgramRule[] = p.rules): number | null {
  const mins = [...new Set(cells.filter((c) => c.offered && s.fico != null && c.ficoMin > s.fico).map((c) => c.ficoMin))].sort((a, b) => a - b)
  return mins.find((f) => fitsAt(p, s, cells, f, s.loanAmount, rules)) ?? null
}

// ---------------------------------------------------------------------------
// One program
// ---------------------------------------------------------------------------

export function evaluateProgram(p: CatalogProgram, lender: CatalogLender, s: Scenario, overlays: ProgramRule[] = []): ProgramResult {
  const reasons: Reason[] = []
  const checklist: CheckItem[] = []
  const fico = s.fico ?? 0
  const allRules = [...p.rules, ...overlays]
  const cells = scenarioCells(p, s)
  const ficoFloor = cells.filter((c) => c.offered).reduce<number | null>((low, c) => (low == null || c.ficoMin < low ? c.ficoMin : low), null)
  let cell: MatrixCell | null = null
  let limit: Limit | null = null
  const unfixable = (kind: Reason['kind'], message: string, trace: Reason['trace'] = null) => reasons.push({ kind, message, trace, gap: 1, fix: null, unfixable: true })

  if (lender.states && !lender.states.includes(s.state)) unfixable('state', `${lender.name} doesn't lend in ${s.state}`)

  if (!p.purposes.includes(s.purpose)) unfixable('purpose', `Not offered for ${MATRIX_PURPOSES.label[s.purpose].toLowerCase()}`)
  else if (p.cells.length === 0) unfixable('no_matrix', 'No approved matrix for this program yet')
  else if (cells.length === 0) {
    // Say which part of the scenario the matrix doesn't cover.
    let pool = p.cells
    for (const [match, message] of dimensions(s)) {
      const next = pool.filter(match)
      if (next.length === 0) {
        unfixable('not_offered', message)
        break
      }
      pool = next
    }
  } else {
    cell = cellAt(p, s, cells, fico, s.loanAmount)
    const amount = tierAmount(p, s)
    // Squares at this credit score (a blank that only means "nothing printed" isn't one).
    const atScore = cells.filter((c) => inBand(c, fico) && !isIgnoredBlank(c))
    const needed = ficoThatFits(p, s, cells, allRules)
    if (!cell && atScore.length === 0) {
      // No cell at this credit score at any loan amount.
      const floor = ficoFloor ?? cells.reduce((low, c) => Math.min(low, c.ficoMin), 850)
      reasons.push({
        kind: 'fico',
        message: `Credit score ${fico} is below the matrix minimum of ${floor}`,
        trace: null,
        gap: needed ? (needed - fico) / needed : 1,
        fix: needed ? { text: `Needs ${needed} FICO (+${needed - fico}); no loan-amount change fixes this`, fico: needed } : null,
        unfixable: !needed,
      })
    } else if (!cell) {
      const tiers = atScore.map((c) => [c.loanAmountMin, c.loanAmountMax] as const)
      const lowest = Math.min(...tiers.map(([min]) => min))
      const highest = tiers.some(([, max]) => max == null) ? null : Math.max(...tiers.map(([, max]) => max!))
      const max = maxLoanAt(p, s, fico, s.loanAmount, allRules)
      const tooLow = amount < lowest
      // Tiers by minimum score: say which scores top out here ("640–659 FICO maxes at $500,000") and offer both ways to fit.
      const tiered = !tooLow && highest != null && atScore.some(isInclusive)
      const row = Math.max(...atScore.map((c) => c.ficoMin))
      const nextRow = cells.filter((c) => c.offered && c.ficoMin > fico).reduce<number | null>((low, c) => (low == null || c.ficoMin < low ? c.ficoMin : low), null)
      const fix: Pick<Reason, 'fix' | 'gap' | 'unfixable'> = tooLow ? { fix: null, gap: (lowest - amount) / lowest, unfixable: false } : max ? loanFix(s, max, (amount - (highest ?? amount)) / (highest ?? amount)) : { fix: null, gap: 1, unfixable: true }
      if (tiered && needed) {
        if (fix.fix) fix.fix = { ...fix.fix, text: `${fix.fix.text} or score ${needed}+`, fico: needed }
        else Object.assign(fix, { fix: { text: `Needs ${needed} FICO (+${needed - fico})`, fico: needed }, gap: (needed - fico) / needed, unfixable: false })
      }
      reasons.push({
        kind: 'loan_amount',
        message: tooLow ? `Minimum loan amount ${formatCurrency(lowest)}` : tiered ? `${nextRow != null ? `${row}–${nextRow - 1}` : `${row}+`} FICO maxes at ${formatCurrency(highest)}` : `Maximum loan amount ${formatCurrency(highest)}`,
        trace: { cellId: atScore[0].id, page: atScore[0].sourcePage },
        ...fix,
      })
    } else if (!cell.offered) {
      reasons.push({
        kind: 'not_offered',
        message: `Not offered at ${bandLabel(cell)}${tierLabel(cell, atScore)}`,
        trace: { cellId: cell.id, page: cell.sourcePage },
        gap: needed ? (needed - fico) / needed : 1,
        fix: needed ? { text: `Needs ${needed} FICO (+${needed - fico})`, fico: needed } : null,
        unfixable: !needed,
      })
    } else {
      const kind = ratioKind(p)
      const actual = ratioOf(p, s)
      const { max, limitedBy, why, cap } = effectiveMax(p, s, cell, allRules)
      const roomPts = max - actual
      limit = { ratio: kind, actual, max, limitedBy, why, roomPts, roomDollars: loanAtRatio(p, s, max) - s.loanAmount }
      if (roomPts < -EPS) {
        const at = cap ?? `Max ${kind.toUpperCase()} ${formatPercent(max, 3)} ${viaLabel(cell)}`
        // The largest loan at or under this one that fits (a cap on small loans can leave a bigger loan fitting too).
        const maxLoan = maxLoanAt(p, s, fico, s.loanAmount, allRules)
        const fix = maxLoan ? loanFix(s, maxLoan, -roomPts / max) : { fix: null, gap: 1, unfixable: true }
        reasons.push({ kind: 'ratio', message: `${at}; scenario is ${formatPercent(actual, 2)}`, trace: { cellId: cell.id, page: cell.sourcePage }, ...fix })
      }
      // Limits printed in the cell itself.
      if (cell.maxDti != null) checklist.push(cellCheck(`Max DTI ${cell.maxDti}%`, s.dti, (v) => v <= cell!.maxDti! + EPS, cell, (v) => formatPercent(v, 2)))
      if (cell.reservesMonths != null) checklist.push(cellCheck(`${cell.reservesMonths} months of reserves`, s.reservesMonths, (v) => v >= cell!.reservesMonths!, cell, String))
      for (const item of checklist) if (item.status === 'fail') reasons.push({ kind: 'rule', message: `${item.message}; scenario is ${item.value}`, trace: item.trace, gap: 1, fix: null, unfixable: false })
    }
  }

  // A cap already folded into the limit above isn't listed as a second reason.
  const folded = limit ? new Set(capRules(p, allRules)) : new Set<ProgramRule>()
  for (const r of allRules) {
    if (!applies(r, s, p)) {
      checklist.push({ message: r.message, status: 'na', value: formatValue(r.field, ruleValue(r, s, p) === 'unknown' ? null : ruleValue(r, s, p)), trace: { ruleId: r.id, page: r.sourcePage }, overlay: !!r.overlay })
      continue
    }
    const { status, value } = check(r, s, p)
    const shown = formatValue(r.field, value)
    const item: CheckItem = { message: r.message, status, value: shown, trace: { ruleId: r.id, page: r.sourcePage }, overlay: !!r.overlay }
    checklist.push(item)
    if (status === 'fail' && !folded.has(r)) reasons.push({ kind: 'rule', message: shown ? `${r.message}; scenario is ${shown}` : r.message, trace: item.trace, ...ruleFailure(r, s, p, value) })
  }

  const eligible = reasons.length === 0 && cell != null && cell.offered
  return { program: p, lender, eligible, cell, limit, maxLoan: cell ? maxLoanAt(p, s, fico, ruleLoanCap(p, s, overlays), allRules) : null, ficoFloor, reasons, checklist, badges: [] }
}

function cellCheck(message: string, v: number | null, ok: (v: number) => boolean, cell: MatrixCell, show: (v: number) => string): CheckItem {
  return { message, status: v == null ? 'verify' : ok(v) ? 'pass' : 'fail', value: v == null ? null : show(v), trace: { cellId: cell.id, page: cell.sourcePage }, overlay: false }
}

/** A program-wide maximum loan amount rule, as a cap on this lien. */
function ruleLoanCap(p: CatalogProgram, s: Scenario, overlays: ProgramRule[]): number | null {
  const caps = [...p.rules, ...overlays].filter((r) => r.field === 'loan_amount' && r.op === '<=' && typeof r.value === 'number' && applies(r, s, p)).map((r) => (r.value as number) - (p.lien !== 'first' && p.loanAmountBasis === 'combined' ? s.firstLienBalance : 0))
  return caps.length ? Math.min(...caps) : null
}

// ---------------------------------------------------------------------------
// 4.4 Ranking and badges
// ---------------------------------------------------------------------------

const STATUS_ORDER = { approved: 0, pending: 1, not_signed_up: 2, inactive: 3 } as const
const byName = (a: ProgramResult, b: ProgramResult) => `${a.program.name} ${a.lender.name}`.localeCompare(`${b.program.name} ${b.lender.name}`)

/** Eligible: approved lenders first, then most room left, then highest max loan. */
export function rankEligible(results: ProgramResult[]) {
  return [...results].sort((a, b) => STATUS_ORDER[a.lender.status] - STATUS_ORDER[b.lender.status] || (b.limit?.roomPts ?? 0) - (a.limit?.roomPts ?? 0) || (b.maxLoan ?? 0) - (a.maxLoan ?? 0) || byName(a, b))
}

/** Ineligible (same product type only): fewest failed reasons, then smallest total gap. */
export function rankIneligible(results: ProgramResult[]) {
  const gap = (r: ProgramResult) => r.reasons.reduce((sum, x) => sum + x.gap, 0)
  return [...results].sort((a, b) => a.reasons.length - b.reasons.length || gap(a) - gap(b) || byName(a, b))
}

/** Best fit, highest max loan, lowest FICO floor. A tie goes to a card without a badge yet. Only when there's more than one to compare. */
export function assignBadges(ranked: ProgramResult[]): ProgramResult[] {
  const out = ranked.map((r) => ({ ...r, badges: [] as Badge[] }))
  if (out.length < 2) return out
  const award = (badge: Badge, score: (r: ProgramResult) => number | null, higher: boolean) => {
    const scored = out.filter((r) => score(r) != null)
    if (scored.length === 0) return
    const best = scored.reduce((b, r) => (higher ? Math.max(b, score(r)!) : Math.min(b, score(r)!)), higher ? -Infinity : Infinity)
    const tied = scored.filter((r) => Math.abs(score(r)! - best) < 1e-6)
    ;(tied.find((r) => r.badges.length === 0) ?? tied[0]).badges.push(badge)
  }
  award('best_fit', (r) => r.limit?.roomPts ?? null, true)
  award('highest_max_loan', (r) => r.maxLoan, true)
  award('lowest_fico_floor', (r) => r.ficoFloor, false)
  return out
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/** What has to be filled in before searching. */
export function missingForSearch(s: Scenario): string[] {
  const missing: string[] = []
  if (s.fico == null) missing.push('credit score')
  if (s.purpose === 'purchase' && s.lien === 'first') {
    if (!s.purchasePrice) missing.push('price')
  } else if (!(s.value > 0)) missing.push('value')
  if (!(s.loanAmount > 0)) missing.push('loan amount')
  if (s.lien !== 'first' && !(s.firstLienBalance > 0)) missing.push('1st lien balance')
  return missing
}

export function search(s: Scenario, catalog: Catalog): SearchResult {
  const lenders = new Map(catalog.lenders.map((l) => [l.id, l]))
  const { searched, notSearched } = gate(s, catalog.programs, lenders)
  const results = searched.map((p) => evaluateProgram(p, lenders.get(p.lenderId)!, s, catalog.overlays))
  return {
    eligible: assignBadges(rankEligible(results.filter((r) => r.eligible))),
    ineligible: rankIneligible(results.filter((r) => !r.eligible)),
    searchedCount: searched.length,
    notSearched,
    ratios: ratios(s),
  }
}
