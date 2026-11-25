// The Borrower Summary PDF (Connor, 2026-11-24): an internal, confidential
// one-to-two page summary of a file, downloaded from the 1003 tab, laid out
// like Connor's "Borrower Profile" sample (navy bar, four tiles, numbered
// sections). It replaced the Borrower Profile tab. Pure: the defaults are
// written from the file, Connor edits any of the words before downloading, and
// the view lays out whatever he kept. Missing figures say so, never $0.
import type { Figure } from '@/lib/profile/profile'

export const BORROWER_SUMMARY_TEMPLATE = 'borrower-summary v1'

export const SUMMARY_DISCLAIMER = 'Information is borrower-reported or preliminary unless otherwise indicated. This summary is not a credit decision or commitment to lend.'

/** The facts the summary is written from (worked out by the 1003 tab from the saved file). */
export interface SummaryFacts {
  borrowerNames: string[]
  isPurchase: boolean
  purposeLabel: string
  stageLabel: string
  qualificationLabel: string
  loName: string
  targetPrice: number | null
  maxPrice: number | null
  /** Down payment as a percent of the price, from the 1003. */
  downPaymentPct: number | null
  loanAmount: number | null
  programLabel: string | null
  scores: { name: string; score: number | null }[]
  creditPulled: boolean
  jobs: { name: string; employer: string; type: string; current: boolean; startDate: string | null; monthly: Figure }[]
  otherIncome: { name: string; type: string; monthly: number | null }[]
  income: Figure
  incomeVerified: 'verified' | 'partly' | 'unverified' | null
  dti: { front: number; back: number | null } | null
  assetGroups: { label: string; total: number | null; verified: boolean }[]
  liquid: Figure
  debts: { name: string; balance: number | null; payment: number | null; paidOff: boolean }[]
  monthlyDebts: Figure
  homes: { address: string; value: number | null; balance: number | null; plan: string | null; use: string | null }[]
}

/** Every word on the PDF that Connor can change before downloading. */
export interface SummaryText {
  strategy: string
  income: string
  credit: string
  assets: string
  liabilities: string
  homes: string
  /** Purchase prices for the scenarios table, typed freely ("650000, 750,000, $850k"). */
  prices: string
  downPct: string
  scenarioNote: string
  strengths: string
  review: string
  /** One step per line. */
  nextSteps: string
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

/** "$650k", "$1.25M", "$950". */
export function compactMoney(n: number): string {
  const trim = (x: number, d: number) => x.toFixed(d).replace(/\.?0+$/, '')
  if (Math.abs(n) >= 1_000_000) return `$${trim(n / 1_000_000, 2)}M`
  if (Math.abs(n) >= 100_000) return `$${Math.round(n / 1000)}k`
  if (Math.abs(n) >= 1000) return `$${trim(n / 1000, 1)}k`
  return money(n)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "2020-01-15" → "Jan 2020". */
const monthYear = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1] ?? ''} ${iso.slice(0, 4)}`.trim()
/** "2026-11-24" → "11/24/2026". */
const numericDate = (iso: string) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(0, 4)}`

/** The words the dialog starts with, written from the file. */
export function summaryDefaults(f: SummaryFacts, saved: { strategy?: string; strengths?: string; concerns?: string; nextSteps?: string } = {}): SummaryText {
  const several = f.borrowerNames.length > 1
  const who = (name: string) => (several && name ? ` (${name})` : '')

  // Income / employment
  const current = f.jobs.filter((j) => j.current)
  const jobWords = current.map((j) => `${j.employer}${who(j.name)}, ${j.type}${j.startDate ? ` since ${monthYear(j.startDate)}` : ''}: ${j.monthly.value == null ? 'income missing' : `${money(j.monthly.value)}/mo`}`)
  const otherWords = f.otherIncome.map((o) => `${o.type}${who(o.name)}: ${o.monthly == null ? 'amount missing' : `${money(o.monthly)}/mo`}`)
  const verified = { verified: 'verified with final income worksheets', partly: 'partly verified', unverified: 'borrower-reported, not verified yet' }
  const income =
    jobWords.length || otherWords.length
      ? `${[...jobWords, ...otherWords].join('; ')}.${f.income.value != null ? ` Total ${money(f.income.value)}/mo${f.incomeVerified ? `, ${verified[f.incomeVerified]}` : ''}.` : ''}${f.dti ? ` DTI ${f.dti.front.toFixed(1)}% / ${(f.dti.back ?? f.dti.front).toFixed(1)}% (estimated).` : ' DTI pending.'}`
      : 'Not collected; qualifying income and DTI pending.'

  // Credit
  const scored = f.scores.filter((s) => s.score != null)
  const credit = `${scored.length ? `${scored.map((s) => `${s.score}${who(s.name)}`).join(', ')} reported.` : 'No score reported yet.'} ${f.creditPulled ? 'Credit has been pulled.' : 'Mortgage credit not pulled yet.'}`

  // Assets
  const groups = f.assetGroups.filter((g) => g.total != null)
  const assets = groups.length
    ? `${groups.map((g) => `${g.label} ${money(g.total!)}`).join('; ')}. ${groups.every((g) => g.verified) ? 'Statements on file.' : groups.some((g) => g.verified) ? 'Some statements on file; the rest unverified.' : 'Balances borrower-reported; statements not on file yet.'}`
    : 'No assets entered yet.'

  // Liabilities
  const kept = f.debts.filter((d) => !d.paidOff)
  const paidOff = f.debts.filter((d) => d.paidOff)
  const liabilities = f.debts.length
    ? `${kept.length ? `${kept.length} debt${kept.length === 1 ? '' : 's'}${f.monthlyDebts.value != null ? `, ${money(f.monthlyDebts.value)}/mo in payments` : ''}` : 'No debts kept after closing'}${paidOff.length ? `; ${paidOff.length} paid off at closing` : ''}. ${f.creditPulled ? 'From the credit report.' : 'Verify with the credit report.'}`
    : `No debts entered. ${f.creditPulled ? 'Confirm against the credit report.' : 'Verify with the credit report.'}`

  // Real estate owned
  const homes = f.homes.length
    ? f.homes
        .map((h) => `${h.address || 'Home'}${h.use ? ` (${h.use})` : ''}: value ${h.value == null ? 'missing' : money(h.value)}, mortgage ${h.balance == null ? 'missing' : h.balance === 0 ? 'none' : money(h.balance)}${h.plan ? `; plan: ${h.plan.toLowerCase()}` : ''}.`)
        .join(' ')
    : 'None on file.'

  // Scenarios: the target price, and the max calculated price when it's higher.
  const prices = f.isPurchase ? [f.targetPrice, f.maxPrice && f.targetPrice && f.maxPrice > f.targetPrice ? f.maxPrice : f.targetPrice ? null : f.maxPrice].filter((x): x is number => !!x) : []
  const scenarioNote = `${f.programLabel ? `${f.programLabel} financing proposed; ` : ''}excludes closing costs and reserves.${f.maxPrice ? ` Maximum calculated price ${money(f.maxPrice)} (estimated).` : ' Maximum approval, rate and payment not yet determined.'}`

  const steps = [
    ...(f.creditPulled ? [] : ['Complete the application and credit check.']),
    ...(f.incomeVerified === 'verified' ? [] : ['Verify income.']),
    ...(groups.length && groups.every((g) => g.verified) ? [] : ['Verify assets with statements.']),
    f.isPurchase ? 'Finalize pre-approval and property-specific estimates.' : 'Price the loan and finalize the estimate.',
  ]

  return {
    strategy: saved.strategy?.trim() ?? '',
    income,
    credit,
    assets,
    liabilities,
    homes,
    prices: prices.map((p) => Math.round(p).toLocaleString('en-US')).join(', '),
    downPct: f.downPaymentPct != null ? String(Math.round(f.downPaymentPct * 100) / 100) : f.isPurchase ? '20' : '',
    scenarioNote: f.isPurchase ? scenarioNote : '',
    strengths: saved.strengths?.trim() ?? '',
    review: saved.concerns?.trim() ?? '',
    nextSteps: saved.nextSteps?.trim() || steps.join('\n'),
  }
}

/** "650000, 750,000, $850k, 1.2m" → [650000, 750000, 850000, 1200000]; anything unreadable is left out. */
export function parsePrices(s: string): number[] {
  return s
    .split(/[;\n]|,(?!\d{3}(?:\D|$))/)
    .map((x) => x.trim().toLowerCase().replace(/[$,\s]/g, ''))
    .map((x) => {
      const m = x.match(/^(\d+(?:\.\d+)?)(k|m)?$/)
      if (!m) return null
      const n = Number(m[1]) * (m[2] === 'k' ? 1000 : m[2] === 'm' ? 1_000_000 : 1)
      return n > 0 ? n : null
    })
    .filter((n): n is number => n != null)
}

export interface SummaryView {
  title: string
  eyebrow: string
  name: string
  subline: string
  preparedOn: string
  tiles: { label: string; value: string }[]
  sections: (
    | { kind: 'text'; title: string; text: string }
    | { kind: 'rows'; title: string; rows: { label: string; text: string }[] }
    | { kind: 'table'; title: string; head: string[]; rows: string[][]; note: string }
    | { kind: 'assessment'; title: string; strengths: string; review: string }
  )[]
  disclaimer: string
}

const clean = (s: string) => s.trim()

export function borrowerSummaryView(f: SummaryFacts, t: SummaryText, preparedOn: string): SummaryView {
  const name = f.borrowerNames.join(' & ') || 'Borrower'
  const prices = f.isPurchase ? parsePrices(t.prices) : []
  const pct = Number(t.downPct)
  const downPct = Number.isFinite(pct) && pct >= 0 && pct < 100 && t.downPct.trim() !== '' ? pct : null

  const scores = f.scores.map((s) => s.score).filter((x): x is number => x != null)
  const lo = Math.min(...scores)
  const hi = Math.max(...scores)
  const priceTile = prices.length > 1 ? `${compactMoney(Math.min(...prices))}–${compactMoney(Math.max(...prices))}` : prices.length ? compactMoney(prices[0]) : f.targetPrice ? compactMoney(f.targetPrice) : 'Missing'
  const tiles = [
    f.isPurchase ? { label: 'Target price', value: priceTile } : { label: 'Loan amount', value: f.loanAmount ? compactMoney(f.loanAmount) : 'Missing' },
    { label: 'Reported credit', value: scores.length ? (lo === hi ? String(lo) : `${lo}–${hi}`) : 'Missing' },
    { label: 'Liquid assets', value: f.liquid.value == null ? 'Missing' : compactMoney(f.liquid.value) },
    { label: 'Reported debt', value: f.monthlyDebts.value == null ? 'None entered' : `${money(f.monthlyDebts.value)}/mo` },
  ]

  const rows = [
    { label: 'Income / employment', text: clean(t.income) },
    { label: 'Credit', text: clean(t.credit) },
    { label: 'Assets', text: clean(t.assets) },
    { label: 'Liabilities', text: clean(t.liabilities) },
    { label: 'Real estate owned', text: clean(t.homes) },
  ].filter((r) => r.text)
  const steps = t.nextSteps
    .split('\n')
    .map((s) => s.trim().replace(/^\d+[.)]\s*/, ''))
    .filter(Boolean)

  const sections: SummaryView['sections'] = []
  if (clean(t.strategy)) sections.push({ kind: 'text', title: `${f.purposeLabel} strategy`, text: clean(t.strategy) })
  if (rows.length) sections.push({ kind: 'rows', title: 'Financial profile', rows })
  if (prices.length)
    sections.push({
      kind: 'table',
      title: 'Illustrative financing scenarios',
      head: ['Purchase price', downPct == null ? 'Down payment' : `Down payment (${downPct}%)`, 'Base loan amount'],
      rows: prices.map((p) => {
        const down = downPct == null ? null : Math.round((p * downPct) / 100)
        return [money(p), down == null ? '—' : money(down), down == null ? '—' : money(p - down)]
      }),
      note: clean(t.scenarioNote),
    })
  if (clean(t.strengths) || clean(t.review)) sections.push({ kind: 'assessment', title: 'Loan officer assessment', strengths: clean(t.strengths), review: clean(t.review) })
  if (steps.length) sections.push({ kind: 'text', title: 'Next steps', text: steps.map((s, i) => `${i + 1}. ${s}`).join(' ') })

  return {
    title: `${name} - Borrower Summary`,
    eyebrow: `Borrower profile / ${f.purposeLabel}`,
    name,
    subline: [`${f.stageLabel} stage`, f.qualificationLabel, `Loan officer: ${f.loName}`].join(' | '),
    preparedOn: numericDate(preparedOn),
    tiles,
    sections: sections.map((s, i) => ({ ...s, title: `${String(i + 1).padStart(2, '0')} | ${s.title}` })),
    disclaimer: SUMMARY_DISCLAIMER,
  }
}
