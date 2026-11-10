import type { ReadGrid, ReadProgram, ReadRule } from '../../../supabase/functions/assistant/matrix'
import type { LimitTarget, UpdateChange } from '../../../supabase/functions/assistant/productUpdate'
import { cellsFromProgram, changeText, diffCells, type ProgramNow, type approvalPayload } from './matrixImport'
import { RULE_FIELDS } from './taxonomy'
import { formatPercent } from '@/lib/format'

/**
 * Lender product updates pasted from email (Phase 0b). The changes Connor
 * ticks are applied here, in code, to a copy of the program's matrix in use;
 * the copy becomes an Edit-limits draft approved on the usual review screen.
 */

export interface Applied {
  program: ReadProgram
  /** Changes that couldn't be placed, with why; Connor edits those by hand in the draft. */
  notApplied: { change: UpdateChange; reason: string }[]
}

const sameWhen = (a: ReadRule['appliesWhen'], b: ReadRule['appliesWhen']) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
/** "in" and "not in" are one list rule; a minimum and a maximum on the same field are two rules. */
const opGroup = (op: ReadRule['op']) => (op === 'in' || op === 'not_in' ? 'list' : op)
const sameRule = (r: Pick<ReadRule, 'field' | 'op' | 'appliesWhen'>, s: Pick<ReadRule, 'field' | 'op' | 'appliesWhen'>) => r.field === s.field && opGroup(r.op) === opGroup(s.op) && sameWhen(r.appliesWhen, s.appliesWhen)

/** The program's rule a change replaces or removes, if any. */
export function ruleOnFile(program: ReadProgram, change: UpdateChange): ReadRule | null {
  return change.rule ? (program.rules.find((r) => sameRule(r, change.rule!)) ?? null) : null
}

const overlap = <T>(a: readonly T[], b: readonly T[]) => a.some((x) => b.includes(x))
const covers = <T>(a: readonly T[], b: readonly T[]) => a.every((x) => b.includes(x))

/** The squares a limit change lands on, or why it can't be placed safely. */
function squaresFor(g: ReadGrid, t: LimitTarget): { at: [number, number][]; problem: string | null } {
  const at: [number, number][] = []
  if (g.ratio !== t.ratio || (t.docType && !g.docTypes.includes(t.docType))) return { at, problem: null }
  for (let ci = 0; ci < g.columns.length; ci++) {
    const col = g.columns[ci]
    const occupancy = col.occupancy ?? g.occupancy
    const purposes = col.purposes ?? g.purposes
    const types = col.propertyTypes ?? g.propertyTypes
    if (t.occupancy && occupancy !== t.occupancy) continue
    if (t.purposes && !overlap(purposes, t.purposes)) continue
    if (t.propertyTypes && !overlap(types, t.propertyTypes)) continue
    if (t.loanAmountMax != null && col.loanAmountMax !== t.loanAmountMax) continue
    // A square that also covers loans the email doesn't mention can't be changed on its own.
    if ((t.purposes && !covers(purposes, t.purposes)) || (t.propertyTypes && !covers(types, t.propertyTypes)))
      return { at: [], problem: `"${g.title || 'a grid'}" (${col.label}) also covers loans the email doesn't mention` }
    if (t.docType && g.docTypes.length > 1) return { at: [], problem: `"${g.title || 'a grid'}" also covers other income types` }
    g.rows.forEach((row, ri) => {
      if (t.ficoMin == null || row.ficoMin === t.ficoMin) at.push([ri, ci])
    })
  }
  return { at, problem: null }
}

/** Applies the ticked changes to a copy of the program. Guideline-text changes change nothing here. */
export function applyChanges(program: ReadProgram, changes: UpdateChange[]): Applied {
  const p: ReadProgram = structuredClone(program)
  const notApplied: Applied['notApplied'] = []
  for (const c of changes) {
    if (c.kind === 'rule' && c.rule) {
      const i = p.rules.findIndex((r) => sameRule(r, c.rule!))
      if (c.action === 'remove') {
        if (i < 0) notApplied.push({ change: c, reason: 'There is no matching rule on file to remove.' })
        else p.rules.splice(i, 1)
        continue
      }
      const rule: ReadRule = { ...c.rule, page: 1, quote: c.quote }
      if (i < 0) p.rules.push(rule)
      else p.rules[i] = rule
    } else if (c.kind === 'limit' && c.target) {
      let placed = 0
      let problem: string | null = null
      p.grids.forEach((g) => {
        const s = squaresFor(g, c.target!)
        if (s.problem) problem = s.problem
        for (const [ri, ci] of s.at) {
          g.values[ri][ci] = c.value ?? null
          placed++
        }
      })
      if (problem) notApplied.push({ change: c, reason: `Not changed: ${problem}. Edit it by hand in the draft.` })
      else if (placed === 0) notApplied.push({ change: c, reason: 'No matching square in the matrix on file. Edit it by hand in the draft.' })
    }
  }
  if (notApplied.some((n) => n.change.kind === 'limit' && n.reason.startsWith('Not changed'))) {
    // A partly placed change is undone, so a square is never half updated.
    const skip = new Set(notApplied.map((n) => n.change.id))
    return { program: applyChanges(program, changes.filter((c) => !skip.has(c.id))).program, notApplied }
  }
  return { program: p, notApplied }
}

const fieldLabel = (f: ReadRule['field']) => RULE_FIELDS.label[f] ?? f

/** "≤ 50", "in TX, FL", "640–850". */
export function ruleValueText(r: Pick<ReadRule, 'op' | 'value'>): string {
  const v = r.value
  if (r.op === 'required') return 'required'
  if (Array.isArray(v)) return `${r.op === 'not_in' ? 'not ' : ''}${v.join(', ')}`
  if (v && typeof v === 'object') return `${v.min}–${v.max}`
  return `${r.op === '<=' ? '≤' : r.op === '>=' ? '≥' : r.op} ${v ?? ''}`.trim()
}

/** What a change looks like next to what's on file: one or more "before → after" lines. */
export function changeLines(program: ReadProgram, change: UpdateChange): { lines: string[]; problem: string | null } {
  if (change.kind === 'text') return { lines: ['Guideline text only: saved with the email.'], problem: null }
  if (change.kind === 'rule' && change.rule) {
    const now = ruleOnFile(program, change)
    const label = fieldLabel(change.rule.field)
    if (change.action === 'remove') return now ? { lines: [`${label}: ${ruleValueText(now)} → removed`], problem: null } : { lines: [`${label}: remove`], problem: 'There is no matching rule on file to remove.' }
    return { lines: [`${label}: ${now ? ruleValueText(now) : 'not on file'} → ${ruleValueText(change.rule)}`], problem: null }
  }
  const { program: after, notApplied } = applyChanges(program, [change])
  if (notApplied.length) return { lines: [], problem: notApplied[0].reason }
  const diff = diffCells(cellsFromProgram(program), cellsFromProgram(after))
  return { lines: diff.length ? diff.map(changeText) : [`Already ${change.value == null ? 'not offered' : formatPercent(change.value, 3)}: no change.`], problem: null }
}

// ---------------------------------------------------------------------------
// The lender the email is from
// ---------------------------------------------------------------------------

const NOISE = new Set(['mortgage', 'lending', 'lender', 'home', 'homes', 'loans', 'loan', 'wholesale', 'financial', 'funding', 'bank', 'the', 'inc', 'llc', 'corp', 'co', 'company', 'of', 'and', 'tpo', 'group', 'capital', 'services', 'na'])
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/** The lender named in the email: the one whose distinctive name words appear most. Null when none or a tie. */
export function guessLender(text: string, lenders: { id: string; name: string }[]): string | null {
  const inText = new Set(words(text))
  const joined = words(text).join(' ')
  const scored = lenders
    .map((l) => {
      const own = words(l.name).filter((w) => !NOISE.has(w))
      const all = words(l.name).join(' ')
      // The full name in the text beats a shared word; a lender with only common words needs its full name.
      const score = (all && joined.includes(all) ? 10 : 0) + (own.length && own.every((w) => inText.has(w)) ? own.length : 0)
      return { id: l.id, score }
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
  if (!scored.length || (scored.length > 1 && scored[1].score === scored[0].score)) return null
  return scored[0].id
}

// ---------------------------------------------------------------------------
// Citations at approval
// ---------------------------------------------------------------------------

type Payload = ReturnType<typeof approvalPayload>
const cellSig = (c: { occupancy: string; propertyTypes: string[]; purposes: string[]; docType: string; unitsMin: number; unitsMax: number; ficoMin: number; ficoMax: number; loanAmountMin: number; loanAmountMax: number | null; dscrMin?: number | null; offered: boolean; maxLtv: number | null; maxCltv: number | null }) =>
  JSON.stringify([c.occupancy, [...c.propertyTypes].sort(), [...c.purposes].sort(), c.docType, c.unitsMin, c.unitsMax, c.ficoMin, c.ficoMax, Number(c.loanAmountMin), c.loanAmountMax == null ? null : Number(c.loanAmountMax), c.dscrMin == null ? null : Number(c.dscrMin), c.offered, c.offered ? (c.maxLtv == null ? null : Number(c.maxLtv)) : null, c.offered ? (c.maxCltv == null ? null : Number(c.maxCltv)) : null])
const ruleSig = (r: { field: string; op: string; value: unknown; appliesWhen: unknown }) => JSON.stringify([r.field, r.op, r.value ?? null, r.appliesWhen ?? null])

/**
 * Cells and rules that differ from the version in use cite the pasted email
 * (approve_matrix_import's per-item source); the unchanged ones keep citing the
 * document they came from.
 */
export function citeEmail(payload: Payload, existing: ProgramNow[], emailDocumentId: string): Payload {
  return payload.map((p) => {
    const now = existing.find((e) => e.id === p.program_id)
    const cells = new Set((now?.cells ?? []).map(cellSig))
    const rules = new Set((now?.rules ?? []).map(ruleSig))
    return {
      ...p,
      cells: p.cells.map((c) => {
        const sig = cellSig({ occupancy: c.occupancy, propertyTypes: c.property_types, purposes: c.purposes, docType: c.doc_type, unitsMin: c.units_min, unitsMax: c.units_max, ficoMin: c.fico_min, ficoMax: c.fico_max, loanAmountMin: c.loan_amount_min, loanAmountMax: c.loan_amount_max, dscrMin: c.dscr_min, offered: c.offered, maxLtv: c.max_ltv, maxCltv: c.max_cltv })
        return cells.has(sig) ? c : { ...c, source_document_id: emailDocumentId }
      }),
      rules: p.rules.map((r) => (rules.has(ruleSig({ field: r.field, op: r.op, value: r.value, appliesWhen: r.applies_when })) ? r : { ...r, source_document_id: emailDocumentId })),
    }
  })
}
