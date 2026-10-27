// Splits a guideline PDF's text into passages by section heading (plan §3.6),
// so search results and citations point at a section and an exact page.
// Pure: the PDF reader hands in each page's lines.

export interface ExtractedPassage {
  position: number
  page: number
  sectionNumber: string | null
  heading: string | null
  body: string
}

/** Longest passage before it's split at a sentence. */
export const MAX_PASSAGE = 1800

/** "5.2 Vesting", "Section 3.6 – High-LTV Purchases", "§7.1 Prepayment Penalty". */
const NUMBERED = /^(?:section\s+|§\s*)?(\d{1,2}(?:\.\d{1,3}){1,3}|\d{1,2})\.?\s*[-–—:]?\s+([A-Za-z][^]{1,80})$/i
const PAGE_NUMBER = /^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/i

/** A line that reads like a heading: numbered and short, or a short ALL-CAPS title. */
export function headingOf(line: string): { sectionNumber: string | null; heading: string } | null {
  const t = line.trim()
  if (t.length > 90 || /[.;,]$/.test(t)) return null
  const m = NUMBERED.exec(t)
  if (m) {
    // A one-level number ("3 Eligibility") only counts when the title starts with a capital and isn't a sentence.
    if (!m[1].includes('.') && !/^[A-Z]/.test(m[2])) return null
    if (m[2].split(/\s+/).length > 12) return null
    return { sectionNumber: m[1], heading: m[2].trim() }
  }
  const letters = t.replace(/[^A-Za-z]/g, '')
  if (letters.length >= 4 && letters === letters.toUpperCase() && t.split(/\s+/).length <= 8) return { sectionNumber: null, heading: t }
  return null
}

/** Lines that repeat on most pages (running headers and footers), compared with numbers blanked out. */
function repeatedLines(pages: string[][]): Set<string> {
  if (pages.length < 3) return new Set()
  const key = (l: string) => l.trim().replace(/\d+/g, '#').toLowerCase()
  const counts = new Map<string, number>()
  for (const lines of pages) for (const k of new Set(lines.map(key))) counts.set(k, (counts.get(k) ?? 0) + 1)
  return new Set([...counts].filter(([k, n]) => k && n >= Math.ceil(pages.length * 0.6)).map(([k]) => k))
}

/** Joins lines into text, mending words hyphenated across a line break. */
const joinLines = (lines: string[]) =>
  lines
    .reduce((text, line) => (text.endsWith('-') && /^[a-z]/.test(line) ? text.slice(0, -1) + line : text ? `${text} ${line}` : line), '')
    .replace(/\s+/g, ' ')
    .trim()

/** Splits long text at sentence ends so no passage is longer than the limit. */
function chunk(text: string): string[] {
  if (text.length <= MAX_PASSAGE) return [text]
  const out: string[] = []
  let rest = text
  while (rest.length > MAX_PASSAGE) {
    const window = rest.slice(0, MAX_PASSAGE)
    const cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('; '))
    const at = cut > MAX_PASSAGE / 2 ? cut + 1 : MAX_PASSAGE
    out.push(rest.slice(0, at).trim())
    rest = rest.slice(at).trim()
  }
  if (rest) out.push(rest)
  return out
}

/** Each page's lines in, passages out: a new passage at every heading and at every page break (so each cites one page). */
export function splitIntoPassages(pages: string[][]): ExtractedPassage[] {
  const skip = repeatedLines(pages)
  const out: ExtractedPassage[] = []
  let section: string | null = null
  let heading: string | null = null
  let buffer: string[] = []
  let bufferPage = 1

  const flush = () => {
    const text = joinLines(buffer)
    buffer = []
    if (!text) return
    for (const body of chunk(text)) out.push({ position: out.length, page: bufferPage, sectionNumber: section, heading, body })
  }

  pages.forEach((lines, i) => {
    const page = i + 1
    flush()
    bufferPage = page
    for (const raw of lines) {
      const line = raw.trim()
      if (!line || PAGE_NUMBER.test(line) || skip.has(line.replace(/\d+/g, '#').toLowerCase())) continue
      const h = headingOf(line)
      if (h) {
        flush()
        section = h.sectionNumber
        heading = h.heading
        continue
      }
      buffer.push(line)
    }
  })
  flush()
  return out
}
