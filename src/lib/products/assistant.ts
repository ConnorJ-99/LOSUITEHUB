// Ask the assistant (Product Search v2 step 9, mockup 02), the parts with no
// AI: putting what the assistant read into the search form, the "I read this
// as" chips, and finding the guideline passages to answer a question from
// (full-text search, ranked here). The search itself is the same rule-based
// search as the form. Pure.

import type { ReadEvidence, ReadField, ScenarioRead } from '../../../supabase/functions/assistant/scenarioRead'
import { formatCurrency, formatNumber, formatPercent } from '@/lib/format'
import { CITIZENSHIPS, DOC_TYPES, FEATURES, LIENS, MATRIX_PROPERTY_TYPES, MATRIX_PURPOSES, OCCUPANCIES, PRODUCT_FAMILIES } from './taxonomy'
import { GUIDELINE_SYNONYMS } from './guidelineSearch'
import { scenarioChips, typeChips } from './scenarioForm'
import type { Scenario, SearchResult } from './types'

/**
 * The scenario to search: what the sentence said on top of the starting
 * point (the borrower file, or a blank form). A purchase with no value uses
 * the price; a 2nd lien keeps the 1st lien balance it was given.
 */
export function applyReading(base: Scenario, r: ScenarioRead): Scenario {
  const s: Scenario = { ...base }
  const set = <K extends keyof Scenario>(key: K, value: Scenario[K] | null | undefined) => {
    if (value !== null && value !== undefined) s[key] = value
  }
  set('lien', r.lien)
  set('family', r.family)
  set('docType', r.docType)
  if (r.features.length) s.features = [...new Set([...s.features, ...r.features])]
  set('purpose', r.purpose)
  set('occupancy', r.occupancy)
  set('propertyType', r.propertyType)
  set('units', r.units)
  set('state', r.state)
  set('county', r.county)
  set('purchasePrice', r.purchasePrice)
  set('value', r.value)
  set('loanAmount', r.loanAmount)
  set('firstLienBalance', r.firstLienBalance)
  set('fico', r.fico)
  set('dti', r.dti)
  set('reservesMonths', r.reservesMonths)
  set('dscr', r.dscr)
  set('citizenship', r.citizenship)
  set('mortgageLates12', r.mortgageLates12)
  set('mortgageLates24', r.mortgageLates24)
  set('bkSeasoningMonths', r.bkSeasoningMonths)
  set('fcSeasoningMonths', r.fcSeasoningMonths)
  set('selfEmployedYears', r.selfEmployedYears)
  set('firstTimeBuyer', r.firstTimeBuyer)
  set('homestead', r.homestead)
  // The docType says DSCR: the family follows (DSCR loans are non-QM).
  if (r.docType && r.docType !== 'full_doc' && !r.family && s.family !== 'any') s.family = 'non_qm'
  if (s.purpose !== 'purchase') s.purchasePrice = null
  else if (r.purchasePrice != null && r.value == null && (base.value === 0 || base.value === base.purchasePrice)) s.value = r.purchasePrice
  if (s.lien === 'first') s.firstLienBalance = 0
  if (s.propertyType !== 'two_to_four' && r.units == null) s.units = 1
  return s
}

const FIELD_LABEL: Record<ReadField, string> = {
  lien: 'Lien',
  family: 'Product',
  docType: 'Income docs',
  features: 'Features',
  purpose: 'Purpose',
  occupancy: 'Occupancy',
  propertyType: 'Property',
  units: 'Units',
  state: 'State',
  county: 'County',
  purchasePrice: 'Price',
  value: 'Value',
  loanAmount: 'Loan amount',
  firstLienBalance: '1st lien balance',
  fico: 'FICO',
  dti: 'DTI',
  reservesMonths: 'Reserves',
  dscr: 'DSCR',
  citizenship: 'Citizenship',
  mortgageLates12: 'Lates (12 mo)',
  mortgageLates24: 'Lates (24 mo)',
  bkSeasoningMonths: 'Bankruptcy',
  fcSeasoningMonths: 'Foreclosure / short sale',
  selfEmployedYears: 'Self-employed',
  firstTimeBuyer: 'First-time buyer',
  homestead: 'Homestead',
}

/** How one field reads on its chip, e.g. "FICO 720" or "Loan amount $427,500". */
export function fieldText(field: ReadField, r: ScenarioRead): string | null {
  const v = r[field]
  if (v === null || (Array.isArray(v) && v.length === 0)) return null
  switch (field) {
    case 'lien':
      return LIENS.label[r.lien!]
    case 'family':
      return r.family === 'any' ? 'Any product' : PRODUCT_FAMILIES.label[r.family!]
    case 'docType':
      return DOC_TYPES.label[r.docType!]
    case 'features':
      return r.features.map((f) => FEATURES.label[f]).join(', ')
    case 'purpose':
      return MATRIX_PURPOSES.label[r.purpose!]
    case 'occupancy':
      return OCCUPANCIES.label[r.occupancy!]
    case 'propertyType':
      return MATRIX_PROPERTY_TYPES.label[r.propertyType!]
    case 'citizenship':
      return CITIZENSHIPS.label[r.citizenship!]
    case 'purchasePrice':
    case 'value':
    case 'loanAmount':
    case 'firstLienBalance':
      return `${FIELD_LABEL[field]} ${formatCurrency(v as number)}`
    case 'dti':
      return `DTI ${formatPercent(v as number, 2)}`
    case 'reservesMonths':
      return `${formatNumber(v as number)} months reserves`
    case 'bkSeasoningMonths':
    case 'fcSeasoningMonths':
      return `${FIELD_LABEL[field]} ${v} months ago`
    case 'selfEmployedYears':
      return `Self-employed ${formatNumber(v as number)} years`
    case 'firstTimeBuyer':
    case 'homestead':
      return v ? FIELD_LABEL[field] : `Not ${FIELD_LABEL[field].toLowerCase()}`
    default:
      return `${FIELD_LABEL[field]} ${typeof v === 'number' ? formatNumber(v) : String(v)}`
  }
}

export interface ReadChip {
  field: ReadField
  text: string
  /** The words it came from, when the assistant gave them. */
  words: string | null
  /** The words weren't found in what Connor typed: check this one. */
  check: boolean
}

/** "I read this as" chips, in form order, with the words each came from. */
export function readChips(r: ScenarioRead, evidence: ReadEvidence[]): ReadChip[] {
  return (Object.keys(FIELD_LABEL) as ReadField[]).flatMap((field) => {
    const text = fieldText(field, r)
    if (!text) return []
    const e = evidence.find((x) => x.field === field)
    return [{ field, text, words: e?.words ?? null, check: e ? !e.found : false }]
  })
}

// ---------------------------------------------------------------------------
// Finding guideline passages for a question (no AI)
// ---------------------------------------------------------------------------

const STOP = new Set(
  'a an and are as at be by can could do does for from has have how i if in is it its may me my of on or our should so than that the their them then there these they this to under up us was we what when where which who will with would you your allow allowed allows eligible ok okay'.split(' '),
)

/** The meaningful words of a question (abbreviations kept: "LLC", "DSCR"). */
export function questionTerms(question: string): string[] {
  return [...new Set((question.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((w) => !STOP.has(w) && (w.length > 2 || GUIDELINE_SYNONYMS[w] || /\d/.test(w))))]
}

/** A to_tsquery string where any term may match (an abbreviation also matches its long form). Null when nothing searchable was asked. */
export function questionQuery(question: string): string | null {
  const parts = questionTerms(question).map((w) => {
    const long = GUIDELINE_SYNONYMS[w]
    return long ? `(${w} | (${long.split(' ').join(' <-> ')}))` : w
  })
  return parts.length ? parts.join(' | ') : null
}

export interface RankablePassage {
  id: string
  heading: string | null
  body: string
}

/** Passages ranked by how many of the question's terms they contain (a heading match counts double), best first. */
export function rankPassages<P extends RankablePassage>(question: string, passages: P[], limit: number): P[] {
  const terms = questionTerms(question)
  const has = (text: string, w: string) => {
    const long = GUIDELINE_SYNONYMS[w]
    return new RegExp(`\\b${w}`, 'i').test(text) || (long ? text.toLowerCase().includes(long) : false)
  }
  return passages
    .map((p, i) => ({ p, i, score: terms.reduce((sum, w) => sum + (has(p.body, w) ? 1 : 0) + (p.heading && has(p.heading, w) ? 2 : 0), 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.p)
}

// ---------------------------------------------------------------------------
// A search's results, compact enough to keep in a saved chat
// ---------------------------------------------------------------------------

export interface ResultLine {
  programId: string
  lender: string
  program: string
  notSignedUp: boolean
  /** "Max LTV 95% · 0.5 pts room", or why it doesn't fit. */
  detail: string
  /** "How to fit", when a change in the scenario would fix it. */
  fix: string | null
}

export interface ResultSummary {
  typeChips: string[]
  scenarioChips: string[]
  fits: ResultLine[]
  close: ResultLine[]
  /** "3 programs of other types were not searched (FHA 2, VA 1)." or null. */
  notSearched: string | null
}

const COMPACT = 6

export function resultSummary(scenario: Scenario, result: SearchResult): ResultSummary {
  const families = Object.entries(result.notSearched.families)
    .map(([f, n]) => `${PRODUCT_FAMILIES.label[f as keyof typeof PRODUCT_FAMILIES.label]} ${n}`)
    .join(', ')
  const n = result.notSearched.count
  return {
    typeChips: typeChips(scenario),
    scenarioChips: scenarioChips(scenario),
    fits: result.eligible.slice(0, COMPACT).map((r) => ({
      programId: r.program.id,
      lender: r.lender.name,
      program: r.program.name,
      notSignedUp: r.lender.status !== 'approved',
      detail: r.limit ? `Max ${r.limit.ratio.toUpperCase()} ${formatPercent(r.limit.max, 2)} · ${formatNumber(Math.max(0, r.limit.roomPts), 2)} pts room` : 'Fits',
      fix: null,
    })),
    close: result.ineligible.slice(0, 3).map((r) => ({
      programId: r.program.id,
      lender: r.lender.name,
      program: r.program.name,
      notSignedUp: r.lender.status !== 'approved',
      detail: r.reasons[0]?.message ?? "Doesn't fit",
      fix: r.reasons.find((x) => x.fix)?.fix?.text ?? null,
    })),
    notSearched: n ? `${n} program${n === 1 ? '' : 's'} of other types ${n === 1 ? 'was' : 'were'} not searched${families ? ` (${families})` : ''}.` : null,
  }
}
