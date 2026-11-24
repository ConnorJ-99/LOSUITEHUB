// MyHome Step C: "You may be able to save about $X/mo" (plan docs/plans/
// myhome.md section 3). The borrower's closed loan against the latest Refi
// Watch benchmark for the closest scenario. Runs in the myhome Edge Function,
// so no rate, points or term ever reaches the borrower: only the monthly
// dollar figure, or nothing. Pure and import-free (tested in refi.test.ts).
//
// Rules:
// - Conventional and FHA loans only (the benchmark scenarios); no VA, USDA,
//   HELOC or HELOAN, and not within 5 years of payoff.
// - The balance today comes from the loan's own terms (payments counted on
//   each due date) less the extra payments they logged.
// - The scenario: same program; an FHA Streamline when there is one (no LTV
//   needed), else the rate/term scenario with the smallest LTV at or above
//   theirs; then the highest credit score at or below theirs (the lowest one
//   when their score isn't known). No match = nothing.
// - Savings compare principal and interest over the months they have left
//   (rounded up to whole years), so it's the rate that saves, not a longer
//   loan. Points and closing costs aren't in it ("about").
// - Nothing when pricing is stale (the last run was skipped or missed, or the
//   latest price is over 14 days old), the benchmark isn't at least 0.25
//   lower than their rate, or the savings are under the company's minimum.

export interface RefiLoan {
  mortgageType: string | null
  purpose: string
  ratePct: number
  termMonths: number
  loanAmount: number
  firstPaymentDate: string | null
  /** Extra principal they logged in MyHome. */
  extraPaid: number
  /** The home's value now (for the LTV), or null. */
  value: number | null
  creditScore: number | null
}

export interface RefiBenchmarkRow {
  program: 'conventional' | 'fha'
  purpose: 'rate_term' | 'streamline'
  fico: number
  ltv: number | null
  active: boolean
  /** The latest saved rate for this scenario, and when. */
  rate: number | null
  pricedOn: string | null
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function monthlyPI(amount: number, ratePct: number, months: number): number {
  if (amount <= 0 || months <= 0) return 0
  const r = ratePct / 100 / 12
  if (r === 0) return round2(amount / months)
  return round2((amount * r) / (1 - Math.pow(1 + r, -months)))
}

/** The balance after `paid` regular payments. */
export function balanceAfter(amount: number, ratePct: number, months: number, paid: number): number {
  const r = ratePct / 100 / 12
  const n = Math.min(Math.max(paid, 0), months)
  if (r === 0) return round2(Math.max(0, amount - (amount / months) * n))
  const pmt = (amount * r) / (1 - Math.pow(1 + r, -months))
  return round2(Math.max(0, amount * Math.pow(1 + r, n) - (pmt * (Math.pow(1 + r, n) - 1)) / r))
}

/** Payments due from the first payment date through today (each counted on its due date). */
export function paymentsMade(firstPaymentDate: string | null, today: string): number {
  if (!firstPaymentDate || firstPaymentDate > today) return 0
  const [fy, fm, fd] = firstPaymentDate.split('-').map(Number)
  const [ty, tm, td] = today.split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm) + (td >= fd ? 1 : 0)
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)

/** The benchmark for a loan like theirs, or null. */
export function pickBenchmark(program: 'conventional' | 'fha', ltv: number | null, score: number | null, rows: RefiBenchmarkRow[]): RefiBenchmarkRow | null {
  const priced = rows.filter((r) => r.active && r.program === program && r.rate != null)
  const streamline = program === 'fha' ? priced.filter((r) => r.purpose === 'streamline') : []
  let pool = streamline
  if (!pool.length) {
    if (ltv == null) return null
    const fits = priced.filter((r) => r.purpose === 'rate_term' && r.ltv != null && r.ltv >= ltv)
    if (!fits.length) return null
    const nearest = Math.min(...fits.map((r) => r.ltv!))
    pool = fits.filter((r) => r.ltv === nearest)
  }
  if (score == null) return [...pool].sort((a, b) => a.fico - b.fico)[0] ?? null
  return pool.filter((r) => r.fico <= score).sort((a, b) => b.fico - a.fico)[0] ?? null
}

/** About how much a month a refinance could save, rounded down to $10; null when it shouldn't show. */
export function refiSavings(loan: RefiLoan, rows: RefiBenchmarkRow[], opts: { today: string; stale: boolean; minimum: number }): number | null {
  if (opts.stale) return null
  const program = loan.mortgageType === 'conventional' ? 'conventional' : loan.mortgageType === 'fha' ? 'fha' : null
  if (!program || loan.purpose === 'heloc' || loan.purpose === 'heloan') return null
  if (!(loan.ratePct > 0) || !(loan.termMonths > 0) || !(loan.loanAmount > 0)) return null
  const paid = paymentsMade(loan.firstPaymentDate, opts.today)
  const left = loan.termMonths - paid
  if (left < 60) return null
  const balance = Math.max(0, balanceAfter(loan.loanAmount, loan.ratePct, loan.termMonths, paid) - Math.max(0, loan.extraPaid))
  if (balance <= 0) return null
  const ltv = loan.value && loan.value > 0 ? round2((balance / loan.value) * 100) : null
  const b = pickBenchmark(program, ltv, loan.creditScore, rows)
  if (!b || b.rate == null || !b.pricedOn || daysBetween(b.pricedOn, opts.today) > 14) return null
  if (b.rate > loan.ratePct - 0.25) return null
  const months = Math.min(loan.termMonths, Math.ceil(left / 12) * 12)
  const now = monthlyPI(balance, loan.ratePct, left)
  const after = monthlyPI(balance, b.rate, months)
  const saves = Math.floor((now - after) / 10) * 10
  return saves >= Math.max(opts.minimum, 1) ? saves : null
}

/**
 * The home's value now, the same way MyHome shows it (src/lib/calc/homeValue.ts):
 * Connor's figure when it's as new as the index (or there's no estimate), else
 * base × index growth to the nearest $1,000. Null when there's neither.
 */
export function valueNow(connor: { amount: number; on: string | null } | null, index: { base: number; baseIndex: number; latestIndex: number; loadedOn: string } | null): number | null {
  const estimate = index && index.base > 0 && index.baseIndex > 0 && index.latestIndex > 0 ? Math.round((index.base * (index.latestIndex / index.baseIndex)) / 1000) * 1000 : 0
  if (connor && connor.amount > 0 && (!estimate || (connor.on !== null && connor.on >= index!.loadedOn))) return connor.amount
  return estimate > 0 ? estimate : null
}

/** Pricing is stale when the last run anyone answered (or that went by) was skipped or missed (as src/lib/refi/benchmarks.ts). */
export function pricingStale(runs: { status: string; createdAt: string }[]): boolean {
  const last = [...runs].filter((r) => r.status !== 'open').sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  return !!last && (last.status === 'skipped' || last.status === 'missed')
}
