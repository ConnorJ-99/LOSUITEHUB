// A matrix reading turned into cells, the automatic checks before approval,
// and the difference from the version in use (plan §5.4–5.6). Pure.

import { formatCurrency, formatPercent } from '@/lib/format'
import { cleanRule, type ReadGrid, type ReadProgram, type ReadRule } from '../../../supabase/functions/assistant/matrix'
import { MATRIX_PROPERTY_TYPES, MATRIX_PURPOSES, OCCUPANCIES, termMonths, type MatrixPropertyType, type MatrixPurpose } from './taxonomy'
import type { MatrixCell } from './types'

/** A cell ready to save (no id yet). */
export type ImportCell = Omit<MatrixCell, 'id' | 'dscrMin' | 'citizenship' | 'maxDti' | 'reservesMonths'>

/** Every square of every grid as a cell; a blank square is "not offered", never 0. */
export function cellsFromProgram(p: ReadProgram): ImportCell[] {
  return p.grids.flatMap((g) => cellsFromGrid(g))
}

/** Every square of a grid as a cell, once for each income type the grid covers (so a search by any of them finds it). */
export function cellsFromGrid(g: ReadGrid): ImportCell[] {
  const out: ImportCell[] = []
  for (const docType of g.docTypes)
  g.rows.forEach((row, ri) =>
    g.columns.forEach((col, ci) => {
      const v = g.values[ri]?.[ci] ?? null
      out.push({
        occupancy: col.occupancy ?? g.occupancy,
        propertyTypes: col.propertyTypes?.length ? col.propertyTypes : g.propertyTypes,
        purposes: col.purposes?.length ? col.purposes : g.purposes,
        docType,
        unitsMin: col.unitsMin ?? g.unitsMin,
        unitsMax: col.unitsMax ?? g.unitsMax,
        ficoMin: row.ficoMin,
        ficoMax: row.ficoMax,
        loanAmountMin: col.loanAmountMin,
        loanAmountMax: col.loanAmountMax,
        offered: v != null,
        maxLtv: v != null && g.ratio === 'ltv' ? v : null,
        maxCltv: v != null && g.ratio === 'cltv' ? v : null,
        sourcePage: g.page > 0 ? g.page : null,
        notes: g.notes,
      })
    }),
  )
  return out
}

// ---------------------------------------------------------------------------
// Automatic checks (plan §5.5)
// ---------------------------------------------------------------------------

export interface ImportWarning {
  level: 'error' | 'warning'
  message: string
  page: number | null
}

const limitOf = (c: Pick<ImportCell, 'maxLtv' | 'maxCltv'>) => c.maxLtv ?? c.maxCltv
const band = (min: number, max: number) => (max >= 850 ? `${min}+` : `${min}–${max}`)
const tier = (min: number, max: number | null) => (max == null ? (min > 0 ? `over ${formatCurrency(min - 1)}` : 'any amount') : min > 0 ? `${formatCurrency(min)}–${formatCurrency(max)}` : `≤${formatCurrency(max)}`)

/** Limits above 100% exist (FHA streamline, VA IRRRL); anything over this is a misread. */
export const MAX_LIMIT = 150

/**
 * Fixes what real matrices commonly trip on, before review: rows for borrowers
 * with no credit score (search needs a score, so they're left out and noted),
 * Condotel and rural grids the reading left without a property type, and a
 * program with no income type (taken from its grids, else full doc). Returns
 * what was changed so the review screen can say so.
 */
export function repairProgram(p: ReadProgram): { program: ReadProgram; fixes: string[] } {
  const fixes: string[] = []
  const grids = p.grids.map((g) => {
    const where = g.title || 'a grid'
    const keep = g.rows.map((r) => !(r.ficoMin < 300 || r.ficoMax < 300 || /no\s*(fico|score|credit)/i.test(r.label)))
    let next = g
    if (keep.some((k) => !k)) {
      fixes.push(`${where}: left out the "no credit score" row (Product Search needs a score); check the PDF for those limits.`)
      next = { ...next, rows: next.rows.filter((_, i) => keep[i]), values: next.values.filter((_, i) => keep[i]), printedRows: next.rows.filter((_, i) => keep[i]).length }
    }
    if (!next.propertyTypes.length && next.columns.some((c) => !c.propertyTypes?.length)) {
      const t = /condotel/i.test(where) ? 'condotel' : /rural/i.test(where) ? 'rural' : null
      if (t) {
        fixes.push(`${where}: set the property type to ${t === 'condotel' ? 'Condotel' : 'Rural SFR'} from the grid's title.`)
        next = { ...next, propertyTypes: [t] }
      }
    }
    return next
  })
  const rules = p.rules.flatMap((r) => {
    const c = cleanRule(r)
    if (!c) fixes.push(`${p.name}: dropped the rule "${r.message}" (it applies everywhere, or names no state or citizenship LOSuite knows).`)
    else if (JSON.stringify(c.value) !== JSON.stringify(r.value)) fixes.push(`${p.name}: "${r.message}" now uses ${Array.isArray(c.value) ? c.value.join(', ') : ''}.`)
    return c ? [c] : []
  })
  let docTypes = p.docTypes
  if (!docTypes.length) {
    docTypes = [...new Set(grids.flatMap((g) => g.docTypes))]
    if (!docTypes.length) docTypes = ['full_doc']
    fixes.push(`${p.name}: no income type was read; set to ${docTypes.length === 1 && docTypes[0] === 'full_doc' ? 'full doc' : 'the grids\' income types'}. Check it.`)
  }
  return { program: { ...p, grids, docTypes, rules }, fixes }
}

/** Errors block approval; warnings are shown for Connor to confirm against the PDF. */
export function checkProgram(p: ReadProgram): ImportWarning[] {
  const out: ImportWarning[] = []
  if (!p.docTypes.length) out.push({ level: 'error', message: 'Pick at least one doc type for the program.', page: null })
  if (!p.purposes.length) out.push({ level: 'error', message: 'Pick at least one purpose for the program.', page: null })
  const cells = cellsFromProgram(p)
  if (!cells.some((c) => c.offered)) out.push({ level: 'warning', message: 'No matrix grid: the program is saved with its rules and terms, but it won\'t show in Product Search until a matrix is added.', page: null })

  for (const g of p.grids) {
    const where = g.title || (g.page > 0 ? `the grid on page ${g.page}` : 'a grid')
    const pg = g.page > 0 ? g.page : null
    const filled = g.values.reduce((n, row) => n + row.length, 0)
    if (g.values.length !== g.rows.length || g.values.some((row) => row.length !== g.columns.length)) out.push({ level: 'error', message: `${where}: ${filled} squares read for ${g.rows.length} rows × ${g.columns.length} columns.`, page: pg })
    if (g.printedRows !== g.rows.length || g.printedColumns !== g.columns.length) out.push({ level: 'warning', message: `${where}: the page shows ${g.printedRows} × ${g.printedColumns}, but ${g.rows.length} × ${g.columns.length} were read.`, page: pg })
    if (!g.docTypes.length) out.push({ level: 'error', message: `${where}: no income type.`, page: pg })
    if (!g.propertyTypes.length && g.columns.some((c) => !c.propertyTypes?.length)) out.push({ level: 'error', message: `${where}: no property type.`, page: pg })
    if (!g.purposes.length && g.columns.some((c) => !c.purposes?.length)) out.push({ level: 'error', message: `${where}: no purpose.`, page: pg })

    g.rows.forEach((r) => {
      if (r.ficoMin < 300 || r.ficoMax > 850 || r.ficoMin > r.ficoMax) out.push({ level: 'error', message: `${where}: credit band "${r.label || band(r.ficoMin, r.ficoMax)}" isn't possible (${r.ficoMin}–${r.ficoMax}).`, page: pg })
    })
    g.columns.forEach((c) => {
      if (c.loanAmountMin < 0 || (c.loanAmountMax != null && c.loanAmountMax < c.loanAmountMin)) out.push({ level: 'error', message: `${where}: loan amounts in column "${c.label}" aren't possible.`, page: pg })
    })
    g.values.forEach((row, ri) =>
      row.forEach((v, ci) => {
        if (v != null && (v <= 0 || v > MAX_LIMIT)) out.push({ level: 'error', message: `${where}: ${g.ratio.toUpperCase()} ${v}% at ${g.rows[ri]?.label ?? ''} / ${g.columns[ci]?.label ?? ''} isn't possible.`, page: pg })
      }),
    )

    // Within a column, the limit never goes up as the credit score goes down.
    const order = g.rows.map((r, i) => ({ r, i })).sort((a, b) => b.r.ficoMin - a.r.ficoMin)
    g.columns.forEach((col, ci) => {
      for (let k = 1; k < order.length; k++) {
        const higher = g.values[order[k - 1].i]?.[ci] ?? null
        const lower = g.values[order[k].i]?.[ci] ?? null
        if (lower != null && (higher == null || lower > higher))
          out.push({ level: 'warning', message: `${where}, ${col.label}: ${band(order[k].r.ficoMin, order[k].r.ficoMax)} allows ${higher == null ? 'a loan where a higher score is not offered' : `${formatPercent(lower, 3)}, more than ${formatPercent(higher, 3)} at ${band(order[k - 1].r.ficoMin, order[k - 1].r.ficoMax)}`}. Check the PDF.`, page: pg })
      }
    })
    // Across loan tiers that differ only by amount, the limit never goes up as the loan amount goes up.
    const same = (a: ReadGrid['columns'][number], b: ReadGrid['columns'][number]) => a.occupancy === b.occupancy && a.unitsMin === b.unitsMin && a.unitsMax === b.unitsMax && JSON.stringify(a.purposes) === JSON.stringify(b.purposes) && JSON.stringify(a.propertyTypes) === JSON.stringify(b.propertyTypes)
    const tiers = g.columns.map((c, i) => ({ c, i })).sort((a, b) => a.c.loanAmountMin - b.c.loanAmountMin)
    g.rows.forEach((row, ri) => {
      for (let a = 0; a < tiers.length; a++)
        for (let b = a + 1; b < tiers.length; b++) {
          if (!same(tiers[a].c, tiers[b].c) || tiers[b].c.loanAmountMin <= tiers[a].c.loanAmountMin) continue
          const small = g.values[ri]?.[tiers[a].i] ?? null
          const big = g.values[ri]?.[tiers[b].i] ?? null
          if (big != null && small != null && big > small)
            out.push({ level: 'warning', message: `${where}, ${band(row.ficoMin, row.ficoMax)}: ${tiers[b].c.label} allows ${formatPercent(big, 3)}, more than ${formatPercent(small, 3)} for the smaller ${tiers[a].c.label}. Check the PDF.`, page: pg })
        }
    })
  }

  // Two grids that cover exactly the same loans (usually a copied grid whose occupancy or purpose wasn't changed).
  const owner = new Map<string, number>()
  const pairs = new Map<string, string>()
  p.grids.forEach((g, gi) =>
    cellsFromGrid(g).forEach((c) => {
      const k = key(c)
      const first = owner.get(k)
      if (first == null) owner.set(k, gi)
      else if (first !== gi && !pairs.has(`${first}|${gi}`)) {
        const name = (i: number) => p.grids[i].title || `grid ${i + 1}`
        pairs.set(`${first}|${gi}`, `"${name(first)}" and "${name(gi)}" cover the same loans (${cellLabel(c)}). Change one grid's occupancy, property types, purposes or doc type.`)
      }
    }),
  )
  for (const message of pairs.values()) out.push({ level: 'error', message, page: null })
  return out
}

// ---------------------------------------------------------------------------
// Difference from the version in use (plan §5.6)
// ---------------------------------------------------------------------------

type CellKeyed = Pick<ImportCell, 'occupancy' | 'propertyTypes' | 'purposes' | 'docType' | 'unitsMin' | 'unitsMax' | 'ficoMin' | 'ficoMax' | 'loanAmountMin' | 'loanAmountMax' | 'maxLtv' | 'maxCltv' | 'offered'>

const key = (c: CellKeyed) => [c.occupancy, [...c.propertyTypes].sort().join('+'), [...c.purposes].sort().join('+'), c.docType, c.unitsMin, c.unitsMax, c.ficoMin, c.ficoMax, c.loanAmountMin, c.loanAmountMax ?? ''].join('|')

/** "Primary · SFR/PUD · Purchase · 680–699 · ≤$1,000,000". */
export function cellLabel(c: CellKeyed): string {
  const units = c.unitsMin === 1 && c.unitsMax === 1 ? '' : c.unitsMin === c.unitsMax ? ` · ${c.unitsMin} units` : ` · ${c.unitsMin}–${c.unitsMax} units`
  return `${OCCUPANCIES.label[c.occupancy]} · ${c.propertyTypes.map((t: MatrixPropertyType) => MATRIX_PROPERTY_TYPES.label[t]).join(', ')} · ${c.purposes.map((p: MatrixPurpose) => MATRIX_PURPOSES.label[p]).join(', ')}${units} · ${band(c.ficoMin, c.ficoMax)} · ${tier(c.loanAmountMin, c.loanAmountMax)}`
}

export interface CellChange {
  label: string
  /** Null = not offered; undefined = the cell didn't exist. */
  from: number | null | undefined
  to: number | null | undefined
}

const show = (v: number | null | undefined) => (v === undefined ? 'not in the matrix' : v === null ? 'not offered' : formatPercent(v, 3))
export const changeText = (c: CellChange) => `${c.label}: ${show(c.from)} → ${show(c.to)}`

/** What changes between the version in use and a new reading: changed limits, newly offered or dropped cells. */
export function diffCells(current: CellKeyed[], next: CellKeyed[]): CellChange[] {
  const before = new Map(current.map((c) => [key(c), c]))
  const after = new Map(next.map((c) => [key(c), c]))
  const out: CellChange[] = []
  for (const [k, n] of after) {
    const o = before.get(k)
    const to = n.offered ? limitOf(n) : null
    if (!o) out.push({ label: cellLabel(n), from: undefined, to })
    else {
      const from = o.offered ? limitOf(o) : null
      if (from !== to) out.push({ label: cellLabel(n), from, to })
    }
  }
  for (const [k, o] of before) if (!after.has(k)) out.push({ label: cellLabel(o), from: o.offered ? limitOf(o) : null, to: undefined })
  return out
}

// ---------------------------------------------------------------------------
// What approval saves
// ---------------------------------------------------------------------------

/** A program as reviewed: the reading (edited), whether to approve it, and the existing program it updates. */
export interface ReviewProgram extends ReadProgram {
  include: boolean
  /** The lender's existing program this updates, or null for a new program. */
  programId: string | null
  /**
   * For an existing program: 'merge' adds this document's grids, rules, terms
   * and income types to what the program has (a product split across several
   * PDFs, or guidelines without limits plus a matrix); 'replace' makes this
   * reading the program's whole matrix (a newer version of the same document).
   */
  mode: 'merge' | 'replace'
}

/** What a program has now, for merging a new document into it. */
export interface ProgramNow {
  id: string
  name: string
  cells: ImportCell[]
  rules: ReadRule[]
  docTypes: ReadProgram['docTypes']
  purposes: ReadProgram['purposes']
  features: ReadProgram['features']
  termOptions: ReadProgram['termOptions']
  description: string | null
  /** The document its matrix in use came from. */
  sourceDocumentId: string | null
}

/** A newer copy of the program's own document replaces it; any other document (or one with no grid) adds to it. */
export function defaultMode(p: Pick<ReadProgram, 'grids'>, current: Pick<ProgramNow, 'sourceDocumentId'> | undefined, documentId: string | null): ReviewProgram['mode'] {
  if (!current) return 'replace'
  if (p.grids.length === 0) return 'merge'
  return current.sourceDocumentId && current.sourceDocumentId === documentId ? 'replace' : 'merge'
}

const ruleKey = (r: Pick<ReadRule, 'field' | 'op' | 'value' | 'appliesWhen'>) => JSON.stringify([r.field, r.op, r.value, r.appliesWhen])
const union = <T>(a: readonly T[], b: readonly T[]) => [...new Set([...a, ...b])]

/**
 * What approving saves for a program: its own reading, or (merging into an
 * existing program) the program's cells this document doesn't cover plus this
 * document's cells, every rule once, and the income types, purposes, features
 * and terms of both.
 */
export function mergedProgram(p: ReviewProgram, current: ProgramNow | undefined) {
  const own = { cells: cellsFromProgram(p), rules: p.rules, docTypes: p.docTypes, purposes: p.purposes, features: p.features, termOptions: p.termOptions, description: p.description }
  if (!current || !p.programId || p.mode === 'replace') return own
  const covered = new Set(own.cells.map(key))
  const ruleKeys = new Set(own.rules.map(ruleKey))
  const cells = [...current.cells.filter((c) => !covered.has(key(c))), ...own.cells]
  // A grid for another purpose or income type widens what the program offers.
  return {
    cells,
    rules: [...current.rules.filter((r) => !ruleKeys.has(ruleKey(r))), ...own.rules],
    docTypes: union(union(current.docTypes, own.docTypes), cells.map((c) => c.docType)),
    purposes: union(union(current.purposes, own.purposes), cells.flatMap((c) => c.purposes)),
    features: union(current.features, own.features),
    termOptions: union(current.termOptions, own.termOptions),
    description: own.description || current.description,
  }
}

/** The programs to approve, in the shape approve_matrix_import() takes. */
export function approvalPayload(programs: ReviewProgram[], existing: ProgramNow[] = []) {
  return programs
    .filter((p) => p.include)
    .map((p) => {
      const m = mergedProgram(p, existing.find((e) => e.id === p.programId))
      return {
      program_id: p.programId,
      name: p.name.trim(),
      family: p.family,
      lien: p.lien,
      doc_types: m.docTypes,
      features: m.features,
      purposes: m.purposes,
      term_options: m.termOptions,
      terms_months: [...new Set(m.termOptions.map(termMonths))],
      loan_amount_basis: p.loanAmountBasis,
      description: m.description ?? '',
      cells: m.cells.map((c) => ({
        occupancy: c.occupancy,
        property_types: c.propertyTypes,
        purposes: c.purposes,
        doc_type: c.docType,
        units_min: c.unitsMin,
        units_max: c.unitsMax,
        fico_min: c.ficoMin,
        fico_max: c.ficoMax,
        loan_amount_min: c.loanAmountMin,
        loan_amount_max: c.loanAmountMax,
        offered: c.offered,
        max_ltv: c.maxLtv,
        max_cltv: c.maxCltv,
        notes: c.notes,
        source_page: c.sourcePage,
      })),
      rules: m.rules.map((r) => ({ field: r.field, op: r.op, value: r.value, applies_when: r.appliesWhen, severity: r.severity, message: r.message, source_page: r.page, source_quote: r.quote })),
      }
    })
}

/** Words that don't tell programs apart ("AmWest FHA Program" is the same product as "FHA"). */
const FILLER = new Set(['program', 'programs', 'product', 'products', 'matrix', 'matrices', 'guide', 'guidelines', 'guideline', 'loan', 'loans', 'the', 'and', 'overview', 'profile', 'eligibility', 'wholesale', 'tpo'])

/**
 * The lender's existing program with the same name, ignoring case, spacing,
 * the lender's own name and filler words, so a second document for the same
 * product (or a newer matrix) adds to it instead of creating a duplicate.
 * "FHA" and "FHA Streamline" stay different programs.
 */
export function matchProgram(name: string, existing: { id: string; name: string; family?: ReadProgram['family']; lien?: ReadProgram['lien'] }[], lenderName = '', reading?: Pick<ReadProgram, 'family' | 'lien'>): string | null {
  const lenderWords = new Set(lenderName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean))
  const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w && !FILLER.has(w) && !lenderWords.has(w))
  const target = words(name)
  if (!target.length) return null
  // A program of another lien or loan type is never the same product, whatever its name.
  const sameKind = (e: (typeof existing)[number]) => !reading || e.family == null || (e.family === reading.family && e.lien === reading.lien)
  const exact = existing.find((e) => sameKind(e) && words(e.name).join(' ') === target.join(' '))
  if (exact || !reading) return exact?.id ?? null
  // Same loan type and lien, every word of the existing name in this one ("FHA" in "FHA 203(b) Standard"),
  // and no product-defining word on one side only ("FHA" is not "FHA Streamline" or "FHA with DPA").
  const candidates = existing
    .filter((e) => e.family === reading.family && e.lien === reading.lien)
    .map((e) => ({ e, w: words(e.name) }))
    .filter(({ w }) => w.length > 0 && w.every((x) => target.includes(x)) && target.filter((x) => VARIANTS.has(x)).every((x) => w.includes(x)))
  if (!candidates.length) return null
  const most = Math.max(...candidates.map((c) => c.w.length))
  const best = candidates.filter((c) => c.w.length === most)
  return best.length === 1 ? best[0].e.id : null
}

/** Words that make a different product of the same loan type. */
const VARIANTS = new Set(['streamline', 'irrrl', 'dpa', 'assistance', 'down', '203k', 'renovation', 'homestyle', 'homeready', 'possible', 'refinow', 'simple', 'jumbo', 'heloc', 'ces', 'second', '2nd', 'itin', 'foreign', 'dscr', 'investor', 'no', 'ratio', 'bridge', 'doctor', 'medical', 'physician', 'construction', 'reverse', 'condotel', 'interest', 'io', '5', '8', 'unit'])

/** A typed square: blank, "—", "N/A" or "NA" means not offered; otherwise a percent. */
export function parseSquare(text: string): number | null | 'invalid' {
  const t = text.trim().replace(/%$/, '')
  if (t === '' || /^(—|-|–|n\/?a)$/i.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : 'invalid'
}
