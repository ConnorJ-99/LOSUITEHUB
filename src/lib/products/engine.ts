// The Product Search engine (docs/plans/product-search-v2.md §4). Pure,
// deterministic, no AI: the product-type gate first, then program rules, the
// matrix cell lookup, the Texas §50(a)(6) cap, room left, "how to fit" and
// ranking. Ratios are compared unrounded; rounding is for display only.

import { formatCurrency, formatPercent } from '@/lib/format'
import { OCCUPANCIES, MATRIX_PROPERTY_TYPES, MATRIX_PURPOSES, DOC_TYPES, OPT_IN_FEATURES, type ProductFamily } from './taxonomy'
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
  // DPA (and any other opt-in feature) only when asked for.
  if (OPT_IN_FEATURES.some((f) => p.features.includes(f) && !s.features.includes(f))) return false
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

/** The value LTV is figured on: the lower of price and value for a purchase. */
export const ratioBasis = (s: Scenario) => {
  const price = purchasePriceOf(s)
  return price ? Math.min(price, s.value || price) : s.value
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
const bandLabel = (c: MatrixCell) => (c.ficoMax >= 850 ? `${c.ficoMin}+` : `${c.ficoMin}–${c.ficoMax}`)
const inBand = (c: MatrixCell, fico: number) => fico >= c.ficoMin && fico <= c.ficoMax
const inTier = (c: MatrixCell, amount: number) => amount >= c.loanAmountMin && (c.loanAmountMax == null || amount <= c.loanAmountMax)

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

/** The governing cell at a credit score and loan amount: overlapping cells → the lower limit wins; a blank cell wins over any limit. */
function cellAt(p: CatalogProgram, s: Scenario, cells: MatrixCell[], fico: number, loan: number): MatrixCell | null {
  const amount = tierAmount(p, s, loan)
  const hits = cells.filter((c) => inBand(c, fico) && inTier(c, amount))
  if (hits.length === 0) return null
  const blank = hits.find((c) => !c.offered)
  if (blank) return blank
  const kind = ratioKind(p)
  return hits.reduce((low, c) => ((cellMax(c, kind) ?? 0) < (cellMax(low, kind) ?? 0) ? c : low))
}

/** The effective maximum ratio for a cell: the matrix, or the Texas cap if lower. */
function effectiveMax(p: CatalogProgram, s: Scenario, c: MatrixCell): { max: number; limitedBy: 'matrix' | 'texas' } {
  const matrix = cellMax(c, ratioKind(p)) ?? 0
  const cap = texasCap(s)
  return cap != null && cap < matrix ? { max: cap, limitedBy: 'texas' } : { max: matrix, limitedBy: 'matrix' }
}

/** Loan amount (this lien) that puts the scenario exactly at a ratio, floored to the dollar. */
function loanAtRatio(p: CatalogProgram, s: Scenario, ratioPct: number) {
  const total = (ratioPct / 100) * ratioBasis(s)
  return Math.floor(p.lien === 'first' ? total + EPS : total - s.firstLienBalance + EPS)
}

const fitsAt = (p: CatalogProgram, s: Scenario, cells: MatrixCell[], fico: number, loan: number) => {
  const c = cellAt(p, s, cells, fico, loan)
  if (!c || !c.offered) return false
  return ratioOf(p, { ...s, loanAmount: loan }) <= effectiveMax(p, s, c).max + EPS
}

/** The largest loan (this lien) that fits at a credit score, checked across every loan tier (a bigger loan can land in a tier with a lower limit). */
export function maxLoanAt(p: CatalogProgram, s: Scenario, fico: number, loanCap: number | null = null): number | null {
  const cells = scenarioCells(p, s).filter((c) => c.offered && inBand(c, fico))
  let best: number | null = null
  for (const c of cells) {
    let loan = loanAtRatio(p, s, effectiveMax(p, s, c).max)
    if (c.loanAmountMax != null) loan = Math.min(loan, p.lien !== 'first' && p.loanAmountBasis === 'combined' ? c.loanAmountMax - s.firstLienBalance : c.loanAmountMax)
    if (loanCap != null) loan = Math.min(loan, loanCap)
    if (loan > 0 && fitsAt(p, s, cells, fico, loan) && (best == null || loan > best)) best = loan
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
  }
}

function applies(r: ProgramRule, s: Scenario, p: CatalogProgram) {
  const w = r.appliesWhen
  if (!w) return true
  if (w.purposes && !w.purposes.includes(s.purpose)) return false
  if (w.occupancies && !w.occupancies.includes(s.occupancy)) return false
  if (w.ltv_above != null && !(ratioOf(p, s) > w.ltv_above + EPS)) return false
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
function ficoThatFits(p: CatalogProgram, s: Scenario, cells: MatrixCell[]): number | null {
  const mins = [...new Set(cells.filter((c) => c.offered && s.fico != null && c.ficoMin > s.fico).map((c) => c.ficoMin))].sort((a, b) => a - b)
  return mins.find((f) => fitsAt(p, s, cells, f, s.loanAmount)) ?? null
}

// ---------------------------------------------------------------------------
// One program
// ---------------------------------------------------------------------------

export function evaluateProgram(p: CatalogProgram, lender: CatalogLender, s: Scenario, overlays: ProgramRule[] = []): ProgramResult {
  const reasons: Reason[] = []
  const checklist: CheckItem[] = []
  const fico = s.fico ?? 0
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
    const atScore = cells.filter((c) => inBand(c, fico))
    const needed = ficoThatFits(p, s, cells)
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
      const max = maxLoanAt(p, s, fico)
      const tooLow = amount < lowest
      reasons.push({
        kind: 'loan_amount',
        message: tooLow ? `Minimum loan amount ${formatCurrency(lowest)}` : `Maximum loan amount ${formatCurrency(highest)}`,
        trace: { cellId: atScore[0].id, page: atScore[0].sourcePage },
        ...(tooLow ? { fix: null, gap: (lowest - amount) / lowest, unfixable: false } : max ? loanFix(s, max, (amount - (highest ?? amount)) / (highest ?? amount)) : { fix: null, gap: 1, unfixable: true }),
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
      const { max, limitedBy } = effectiveMax(p, s, cell)
      const roomPts = max - actual
      limit = { ratio: kind, actual, max, limitedBy, roomPts, roomDollars: loanAtRatio(p, s, max) - s.loanAmount }
      if (roomPts < -EPS) {
        const at = limitedBy === 'texas' ? `Texas §50(a)(6) caps homestead cash-out at ${TEXAS_CASH_OUT_CAP}% CLTV` : `Max ${kind.toUpperCase()} ${formatPercent(max, 3)} at ${bandLabel(cell)}`
        const maxLoan = maxLoanAt(p, s, fico)
        const fix = maxLoan ? loanFix(s, maxLoan, -roomPts / max) : { fix: null, gap: 1, unfixable: true }
        reasons.push({ kind: 'ratio', message: `${at}; scenario is ${formatPercent(actual, 2)}`, trace: { cellId: cell.id, page: cell.sourcePage }, ...fix })
      }
      // Limits printed in the cell itself.
      if (cell.maxDti != null) checklist.push(cellCheck(`Max DTI ${cell.maxDti}%`, s.dti, (v) => v <= cell!.maxDti! + EPS, cell, (v) => formatPercent(v, 2)))
      if (cell.reservesMonths != null) checklist.push(cellCheck(`${cell.reservesMonths} months of reserves`, s.reservesMonths, (v) => v >= cell!.reservesMonths!, cell, String))
      for (const item of checklist) if (item.status === 'fail') reasons.push({ kind: 'rule', message: `${item.message}; scenario is ${item.value}`, trace: item.trace, gap: 1, fix: null, unfixable: false })
    }
  }

  for (const r of [...p.rules, ...overlays]) {
    if (!applies(r, s, p)) {
      checklist.push({ message: r.message, status: 'na', value: formatValue(r.field, ruleValue(r, s, p) === 'unknown' ? null : ruleValue(r, s, p)), trace: { ruleId: r.id, page: r.sourcePage }, overlay: !!r.overlay })
      continue
    }
    const { status, value } = check(r, s, p)
    const shown = formatValue(r.field, value)
    const item: CheckItem = { message: r.message, status, value: shown, trace: { ruleId: r.id, page: r.sourcePage }, overlay: !!r.overlay }
    checklist.push(item)
    if (status === 'fail') reasons.push({ kind: 'rule', message: shown ? `${r.message}; scenario is ${shown}` : r.message, trace: item.trace, ...ruleFailure(r, s, p, value) })
  }

  const eligible = reasons.length === 0 && cell != null && cell.offered
  return { program: p, lender, eligible, cell, limit, maxLoan: cell ? maxLoanAt(p, s, fico, ruleLoanCap(p, s, overlays)) : null, ficoFloor, reasons, checklist, badges: [] }
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
