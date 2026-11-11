// A closed loan's comp (build plan Phase 5): gross revenue, the LO's comp and
// net to the company, from the comp snapshot taken when it closed.
// Calculated on screen, never stored. Pure, tested.

export interface CompSnapshot {
  /** 'revenue' = the company revenue on the loan; 'loan_bps' = loan amount × bps. */
  baseMode: 'revenue' | 'loan_bps'
  baseBps: number | null
  /** The LO's split, % of the base. */
  splitPct: number
  /** Salary-only: 100% of the commission goes to company overhead. */
  memberType: 'commission' | 'salary'
}

export interface LoanCompResult {
  /** The company revenue on the loan (null = not entered: "needs revenue"). */
  gross: number | null
  /** The dollars the split applies to. */
  base: number | null
  loComp: number | null
  net: number | null
  needsRevenue: boolean
}

const cents = (n: number) => Math.round(n * 100) / 100

export function loanComp(loan: { loanAmount: number | null; revenue: number | null }, snapshot: CompSnapshot | null): LoanCompResult {
  const gross = loan.revenue == null ? null : cents(loan.revenue)
  const needsRevenue = gross == null
  if (!snapshot) return { gross, base: null, loComp: null, net: null, needsRevenue }
  const base =
    snapshot.baseMode === 'revenue' ? gross : loan.loanAmount != null && snapshot.baseBps != null ? cents((loan.loanAmount * snapshot.baseBps) / 10_000) : null
  const loComp = base == null ? null : snapshot.memberType === 'salary' ? 0 : cents((base * snapshot.splitPct) / 100)
  const net = gross == null || loComp == null ? null : cents(gross - loComp)
  return { gross, base, loComp, net, needsRevenue }
}
