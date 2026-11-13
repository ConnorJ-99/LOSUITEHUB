// Finds where a quote the AI read sits on a PDF page (Stage 4d-2): which of
// the page's text items it covers, so the viewer can highlight them. Matching
// ignores case, extra spaces, "$" and commas. When the quote isn't there, the
// value is tried the same way (the AI may have quoted "YTD 33,419.76" from a
// table where the label and the number are far apart). Pure, tested.

const norm = (s: string) => s.toLowerCase().replace(/[$,]/g, '').replace(/\s+/g, ' ').trim()
const compact = (s: string) => norm(s).replace(/ /g, '')

/** The first and last text item (inclusive) the text covers, or null. */
function findIn(items: string[], text: string): { first: number; last: number } | null {
  const want = compact(text)
  if (want.length < 2) return null
  // Join the items without spaces, remembering where each one starts.
  let joined = ''
  const starts: number[] = []
  for (const it of items) {
    starts.push(joined.length)
    joined += compact(it)
  }
  const at = joined.indexOf(want)
  if (at < 0) return null
  const end = at + want.length - 1
  let first = 0
  let last = 0
  for (let i = 0; i < items.length; i++) {
    if (starts[i] <= at) first = i
    if (starts[i] <= end) last = i
  }
  return { first, last }
}

export interface QuoteMatch {
  first: number
  last: number
  /** What matched: the quote, or only the value. */
  by: 'quote' | 'value'
}

export function findQuote(items: string[], quote: string, value?: string | number | null): QuoteMatch | null {
  const q = findIn(items, quote)
  if (q) return { ...q, by: 'quote' }
  if (value == null || value === '') return null
  // Money as read is a plain number; on the page it has commas and two decimals.
  const text = typeof value === 'number' ? value.toFixed(2) : String(value)
  const v = findIn(items, text) ?? (typeof value === 'number' && Number.isInteger(value) ? findIn(items, String(value)) : null)
  return v ? { ...v, by: 'value' } : null
}

export const normalizeQuote = norm
