// A loan's three numbers (Connor, 2026-11-13): the lender's loan number, the
// Arive number and the title company's GF (file) number, plus which lender
// the file is with. The lender comes from the chosen program when there is
// one, else the lender picked on the file, else the typed lender name (old
// closed loans). From Processing on, a file must have a lender and the
// lender's loan number before the move saves.
import type { PipelineStage } from '@/lib/pipeline/stages'

/** Stages that need the lender and the lender loan number ("submitted to lender" and later). */
export const LENDER_NUMBER_STAGES: readonly PipelineStage[] = ['processing', 'underwriting', 'clear_to_close', 'closed']

export const needsLenderNumber = (stage: PipelineStage) => LENDER_NUMBER_STAGES.includes(stage)

export interface LoanNumbers {
  /** False before the loan numbers script has run (nothing is required then). */
  ready: boolean
  /** The lender of the file's program, which wins. */
  programLenderId: string | null
  /** The lender picked on the file. */
  lenderId: string | null
  /** Typed lender name (old closed loans, imports). */
  lenderNameTyped: string | null
  lenderLoanNumber: string | null
  ariveLoanNumber: string | null
  titleFileNumber: string | null
  mortgageeClauseOverride: string | null
}

export interface ResolvedLender {
  id: string | null
  name: string | null
  /** Where the lender came from; a program's lender can't be changed here. */
  from: 'program' | 'file' | 'typed' | null
}

/** Which lender the file is with: the program's, else the one picked, else the typed name. */
export function resolveLender(n: Pick<LoanNumbers, 'programLenderId' | 'lenderId' | 'lenderNameTyped'>, lenders: readonly { id: string; name: string }[]): ResolvedLender {
  const named = (id: string | null) => (id ? (lenders.find((l) => l.id === id)?.name ?? null) : null)
  if (n.programLenderId) return { id: n.programLenderId, name: named(n.programLenderId), from: 'program' }
  if (n.lenderId) return { id: n.lenderId, name: named(n.lenderId), from: 'file' }
  const typed = n.lenderNameTyped?.trim() || null
  return typed ? { id: null, name: typed, from: 'typed' } : { id: null, name: null, from: null }
}

/** What's missing before a move to this stage can save ([] = fine). */
export function missingForStage(n: LoanNumbers, lender: ResolvedLender, stage: PipelineStage): ('lender' | 'lender_loan_number')[] {
  if (!n.ready || !needsLenderNumber(stage)) return []
  const out: ('lender' | 'lender_loan_number')[] = []
  if (!lender.name) out.push('lender')
  if (!n.lenderLoanNumber?.trim()) out.push('lender_loan_number')
  return out
}

/** A loan number tidied for saving: trimmed, inner spaces kept single, blank = null. */
export function cleanNumber(v: string | null | undefined): string | null {
  const s = (v ?? '').trim().replace(/\s+/g, ' ')
  return s ? s : null
}

/** Letters and digits only, lowercased: "GF 26-11873" and "2611873" compare equal. */
export const numberKey = (v: string) => v.toLowerCase().replace(/[^a-z0-9]/g, '')

/** True when the search text matches one of the loan's numbers (ignoring dashes, spaces and case; 3+ characters). */
export function matchesLoanNumber(search: string, numbers: readonly (string | null | undefined)[]): boolean {
  const q = numberKey(search)
  if (q.length < 3) return false
  return numbers.some((n) => !!n && numberKey(n).includes(q))
}
