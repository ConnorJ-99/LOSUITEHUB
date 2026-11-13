// The Loan Options Quote PDF (Quick Quote → Preview & print / Email): the
// options on the quote side by side for a borrower who hasn't pre-qualified
// yet. Figures come from '@/lib/quickquote/quote'; this only picks and labels
// them. Options are named "Option A, B..." with the loan type, never the
// lender (the decisions log's borrower-PDF rule). Pure.

import { OCCUPANCY_OPTIONS, PROPERTY_TYPE_OPTIONS } from '@/components/profile/options'
import { formatIsoDate } from '@/lib/dates'
import { formatCurrency, formatPercent } from '@/lib/format'
import { badgesFor, BADGE_LABEL, creditLabel, MORTGAGE_TYPE_LABEL, optionLetter, termLabel, type OptionFigures, type QuoteOption, type QuoteScenario } from '@/lib/quickquote/quote'

export const QUICK_QUOTE_TEMPLATE = 'quick-quote v1'

export const QUOTE_NEXT_STEPS = ['Pick the option that fits, or ask for another', 'A 10-minute pre-qualification call', 'Get your pre-approval letter and start shopping']

export const QUOTE_DISCLAIMER =
  'This is not a Loan Estimate or a commitment to lend. Rates are not locked and are subject to change without notice. Figures, including the APR, are estimates based on the information provided and are subject to credit approval, property appraisal and underwriting. Taxes and insurance are estimates. You will receive an official Loan Estimate after you apply.'

export interface QuoteColumn {
  letter: string
  title: string
  sub: string
  badges: string[]
  recommended: boolean
}

export interface QuoteRow {
  label: string
  values: string[]
  /** The monthly payment row is highlighted. */
  kind?: 'payment' | 'cash'
}

export interface QuickQuoteDoc {
  borrowerName: string
  preparedOn: string
  validThrough: string
  chips: string[]
  columns: QuoteColumn[]
  rows: QuoteRow[]
  /** Which column is the recommended one (shaded), or -1. */
  highlight: number
  note: string | null
  nextSteps: string[]
  loFirstName: string
  bookingUrl: string | null
}

export interface QuickQuoteDocInput {
  scenario: QuoteScenario
  /** In the order shown on the screen. */
  options: QuoteOption[]
  figures: Map<string, OptionFigures>
  note: string
  preparedOn: string
  validThrough: string
  loName: string
  bookingUrl: string | null
}

const label = <T extends string>(list: readonly { value: T; label: string }[], v: T) => list.find((o) => o.value === v)?.label ?? v

/** "Purchase · $425,000", "Primary residence", "Single family", "Collin County, TX", "Est. credit 700–719", "First-time buyer". */
export function scenarioChips(s: QuoteScenario): string[] {
  const purpose = s.purpose === 'purchase' ? `Purchase · ${formatCurrency(s.purchasePrice)}` : `${s.purpose === 'refinance_cash_out' ? 'Cash-out refinance' : 'Rate/term refinance'} · value ${formatCurrency(s.value)}`
  const county = s.county?.trim() ? `${s.county.trim().replace(/\s+county$/i, '')} County, ${s.state || 'TX'}` : null
  const credit = creditLabel(s.creditBucket)
  return [purpose, label(OCCUPANCY_OPTIONS, s.occupancy), label(PROPERTY_TYPE_OPTIONS, s.propertyType), county, credit && `Est. credit ${credit}`, s.firstTimeBuyer ? 'First-time buyer' : null, s.vaEligible ? 'VA eligible' : null].filter(
    (c): c is string => !!c,
  )
}

const pointsText = (o: QuoteOption, f: OptionFigures) => (o.pointsPct > 0 ? `${o.pointsPct.toFixed(3)} · ${formatCurrency(Math.round(f.pointsAmount))}` : 'None')
const whole = (n: number) => formatCurrency(Math.round(n))

/** Everything the quote PDF shows: the options on the quote that have figures, in screen order (at most 4). */
export function quickQuoteDoc(input: QuickQuoteDocInput): QuickQuoteDoc {
  const { scenario: s, figures } = input
  const shown = input.options.filter((o) => o.onQuote && figures.has(o.id)).slice(0, 4)
  const badges = badgesFor(shown, figures)
  const purchase = s.purpose === 'purchase'
  const col = (fn: (o: QuoteOption, f: OptionFigures) => string) => shown.map((o) => fn(o, figures.get(o.id)!))
  const anyCashBack = shown.some((o) => figures.get(o.id)!.cashToClose < 0)

  const rows: QuoteRow[] = [
    { label: 'Interest rate', values: col((o) => formatPercent(o.ratePct, 3)) },
    { label: 'APR (estimated)', values: col((_, f) => formatPercent(f.aprPct, 3)) },
    { label: 'Discount points', values: col(pointsText) },
    ...(purchase
      ? [{ label: 'Down payment', values: col((_, f) => `${formatPercent(f.downPaymentPct, 2)} · ${whole(f.downPayment ?? 0)}`) }]
      : s.purpose === 'refinance_cash_out'
        ? [{ label: 'Cash out', values: col(() => whole(s.cashOut ?? 0)) }]
        : []),
    { label: 'Loan amount', values: col((_, f) => whole(f.loanAmount)) },
    { label: 'Principal & interest', values: col((_, f) => whole(f.principalAndInterest)) },
    { label: 'Mortgage insurance', values: col((_, f) => (f.mortgageInsurance > 0 ? whole(f.mortgageInsurance) : 'None')) },
    { label: 'Est. taxes & insurance', values: col((_, f) => whole(f.taxesInsurance)) },
    { label: 'Est. monthly payment', values: col((_, f) => whole(f.totalMonthly)), kind: 'payment' },
    {
      label: anyCashBack && !purchase ? 'Est. cash to close (or back)' : 'Est. cash to close',
      values: col((_, f) => (f.cashToClose < 0 ? `${whole(-f.cashToClose)} back` : whole(f.cashToClose))),
      kind: 'cash',
    },
  ]

  return {
    borrowerName: s.borrower.name.trim(),
    preparedOn: formatIsoDate(input.preparedOn),
    validThrough: formatIsoDate(input.validThrough),
    chips: scenarioChips(s),
    columns: shown.map((o, i) => ({
      letter: `Option ${optionLetter(i)}`,
      title: MORTGAGE_TYPE_LABEL[o.mortgageType],
      sub: `${termLabel(o.termMonths)} · ${o.pointsPct > 0 ? `${o.pointsPct.toFixed(3)} pts` : 'no points'}`,
      badges: (badges.get(o.id) ?? []).filter((b) => b !== 'recommended').map((b) => BADGE_LABEL[b]),
      recommended: o.recommended,
    })),
    rows,
    highlight: shown.findIndex((o) => o.recommended),
    note: input.note.trim() || null,
    nextSteps: QUOTE_NEXT_STEPS,
    loFirstName: input.loName.trim().split(/\s+/)[0] || 'your loan officer',
    bookingUrl: input.bookingUrl,
  }
}

/** "Loan Options Quote - Jordan Reyes - 2026-10-30.pdf" (no characters a file name can't hold). */
export const quoteFileName = (name: string, preparedOn: string) => `Loan Options Quote - ${name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Borrower'} - ${preparedOn}.pdf`
