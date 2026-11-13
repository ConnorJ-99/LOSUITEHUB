// The words around a sent quote: the email and heads-up text (built in code,
// not by AI) and the note that lands on the borrower's timeline. Pure.

import { formatCurrency } from '@/lib/format'
import { formatIsoDate } from '@/lib/dates'
import type { OptionFigures, QuoteOption } from './quote'

export interface QuoteMessage {
  subject: string
  body: string
  text: string
}

/** The email and the optional heads-up text, greeting the borrower by first name. */
export function quoteMessage(firstName: string | null, loName: string | null, optionCount: number, validThrough: string, companyName = 'MPS Mortgage'): QuoteMessage {
  const hi = firstName?.trim() ? `Hi ${firstName.trim()},` : 'Hi,'
  const sign = [loName, companyName].filter(Boolean).join('\n')
  const options = optionCount === 1 ? 'a loan option' : `${optionCount} loan options`
  return {
    subject: `Your loan options from ${companyName}`,
    body: `${hi}\n\nAttached is a quote with ${options} side by side: the estimated monthly payment and cash to close for each. Rates aren't locked, and the figures are good through ${formatIsoDate(validThrough)}.\n\nHave a look, and reply or call me with any questions. When you're ready, the next step is a quick 10-minute pre-qualification call.\n\n${sign}`,
    text: `${hi.replace(/,$/, '')}, it's ${loName ?? companyName}. I just emailed your loan options quote. Let me know if you have any questions!`,
  }
}

/** The timeline note for a sent quote: what went out, and the range of payments and cash. */
export function sentQuoteNote(options: QuoteOption[], figures: Map<string, OptionFigures>, to: string, withText: boolean): string {
  const sent = options.filter((o) => o.onQuote && figures.has(o.id)).map((o) => figures.get(o.id)!)
  const range = (values: number[]) => {
    const lo = Math.round(Math.min(...values))
    const hi = Math.round(Math.max(...values))
    return lo === hi ? formatCurrency(lo) : `${formatCurrency(lo)}–${formatCurrency(hi)}`
  }
  const count = sent.length === 1 ? '1 option' : `${sent.length} options`
  const lines = sent.length ? `: ${count}, ${range(sent.map((f) => f.totalMonthly))}/mo, ${range(sent.map((f) => f.cashToClose))} cash to close` : ''
  return `Emailed a Loan Options Quote to ${to}${lines}.${withText ? ' Texted a heads-up.' : ''}`
}
