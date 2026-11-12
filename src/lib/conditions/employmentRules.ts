// The employment document rules in one place (Stage 3a, Connor 2026-11-12).
// Change a number here and every suggestion follows; the logic that uses them
// is src/lib/conditions/employment.ts.

export const EMPLOYMENT_RULES = {
  /** How far back employment is documented. */
  lookbackMonths: 24,
  /** Pay stubs must cover this many days (the most recent ones). */
  paystubDays: 30,
  /** How many pay stubs usually cover that (shown in the wording). */
  paystubCount: 2,
  /** Ask for the final pay stub from a job that ended inside the lookback. */
  finalPaystub: true,
  /** A break between jobs longer than this needs a letter of explanation. */
  gapDays: 30,
  /** A current job that started this recently is flagged for review (job change / probation). */
  recentStartMonths: 6,
} as const
