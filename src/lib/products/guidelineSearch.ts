// Guideline text search (no AI): turns what Connor types into a Postgres
// text-search query. Every word must appear; a common mortgage abbreviation
// also matches its spelled-out form ("LLC" finds "limited liability company").

/** Abbreviation → spelled-out phrase. */
export const GUIDELINE_SYNONYMS: Record<string, string> = {
  llc: 'limited liability company',
  ppp: 'prepayment penalty',
  dscr: 'debt service coverage ratio',
  ltv: 'loan to value',
  cltv: 'combined loan to value',
  dti: 'debt to income',
  noo: 'non owner occupied',
  fthb: 'first time homebuyer',
  itin: 'individual taxpayer identification number',
  bk: 'bankruptcy',
  fc: 'foreclosure',
  io: 'interest only',
  heloc: 'home equity line of credit',
  ces: 'closed end second',
  str: 'short term rental',
  adu: 'accessory dwelling unit',
  hoa: 'homeowners association',
  mi: 'mortgage insurance',
  pmi: 'private mortgage insurance',
  vom: 'verification of mortgage',
  vor: 'verification of rent',
  voe: 'verification of employment',
}

const words = (text: string) => text.toLowerCase().match(/[a-z0-9]+/g) ?? []
const phrase = (text: string) => words(text).join(' <-> ')

/** A to_tsquery string: every term required; quoted text is a phrase; abbreviations also match their long form. Null when nothing searchable was typed. */
export function guidelineQuery(input: string): string | null {
  const terms: string[] = []
  for (const m of input.matchAll(/"([^"]+)"|(\S+)/g)) {
    if (m[1]) {
      const p = phrase(m[1])
      if (p) terms.push(`(${p})`)
      continue
    }
    for (const w of words(m[2])) {
      const long = GUIDELINE_SYNONYMS[w]
      terms.push(long ? `(${w} | (${phrase(long)}))` : w)
    }
  }
  return terms.length ? terms.join(' & ') : null
}
