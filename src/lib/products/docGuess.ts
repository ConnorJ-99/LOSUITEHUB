// What an uploaded lender PDF is, guessed from its file name and text without
// AI: the kind of document, its version and effective date, and the loan
// product it covers, so it can be linked to the right program (or a new
// program set up) without Connor tying it by hand. Pure.

import type { GuidelineDocument } from '@/lib/api/products'
import { termChoices, type DocType, type Feature, type Lien, type ProductFamily, type ProgramTerm } from './taxonomy'

export interface ProductGuess {
  /** The product's name from the file name, without version, date or words like "matrix" ("Equity Advantage HELOC"). */
  name: string
  family: ProductFamily
  lien: Lien
  docTypes: DocType[]
  features: Feature[]
  termOptions: ProgramTerm[]
  /** Where the loan type came from: the file name, the first pages, or nothing (a default). */
  basis: 'title' | 'text' | 'none'
}

export interface DocGuess {
  docType: GuidelineDocument['docType']
  title: string
  versionLabel: string | null
  /** YYYY-MM-DD. */
  effectiveDate: string | null
  product: ProductGuess
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MONTH = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)'

/** "Equity_Advantage-HELOC Jul 2026 1.3.pdf" → "Equity Advantage HELOC Jul 2026 1.3". */
export function titleFromFile(fileName: string): string {
  return fileName
    .replace(/\.pdf$/i, '')
    .replace(/[_]+/g, ' ')
    .replace(/(?<=[A-Za-z])-(?=[A-Za-z])/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A version as printed: "Jul 2026 1.3", "v4.2", "rev. 09/2026", "Version 3". */
export function findVersion(text: string): string | null {
  const m =
    new RegExp(`\\b${MONTH}\\.?\\s+\\d{4}(?:\\s+v?\\d+(?:\\.\\d+)+)?\\b`, 'i').exec(text) ??
    /\b(?:rev(?:ision|ised)?\.?|version|ver\.?)\s*:?\s*(\d{1,2}[/.-]\d{2,4}|\d+(?:\.\d+)*)/i.exec(text) ??
    /\bv\d+(?:\.\d+)+\b|\bv\d+\b/i.exec(text)
  if (!m) return null
  const raw = m[0].trim()
  if (/^rev/i.test(raw)) return `rev. ${m[1]}`
  if (/^ver/i.test(raw)) return `v${m[1]}`
  // "July 2026 1.3" → "Jul 2026 1.3"
  return raw.replace(new RegExp(`^${MONTH}\\.?`, 'i'), (w) => w.slice(0, 3).replace(/^./, (c) => c.toUpperCase()))
}

const iso = (y: number, m: number, d: number) => (m >= 1 && m <= 12 && d >= 1 && d <= 31 ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null)
const year = (y: string) => (y.length === 2 ? 2000 + Number(y) : Number(y))

/** The date after "Effective" (10/01/2026, October 1, 2026, 2026-10-01). */
export function findEffectiveDate(text: string): string | null {
  const after = /effective(?:\s+date)?\s*(?:as of|on|:)?\s*(.{0,40})/i.exec(text)?.[1]
  if (!after) return null
  let m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(after)
  if (m) return iso(year(m[3]), Number(m[1]), Number(m[2]))
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(after)
  if (m) return iso(Number(m[1]), Number(m[2]), Number(m[3]))
  m = new RegExp(`^(${MONTH})\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})`, 'i').exec(after)
  if (m) return iso(Number(m[3]), MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1, Number(m[2]))
  return null
}

/** Matrix PDFs are mostly percentages in grids; guidelines are prose. */
function looksLikeMatrix(text: string): boolean {
  const percents = text.match(/\b\d{2,3}(?:\.\d+)?\s?%/g)?.length ?? 0
  const words = text.split(/\s+/).filter(Boolean).length || 1
  return percents >= 20 && percents / words > 0.04
}

export function guessDocType(title: string, firstPages: string): GuidelineDocument['docType'] {
  const t = title.toLowerCase()
  const head = firstPages.slice(0, 3000).toLowerCase()
  if (/rate ?sheet|pricing|price sheet/.test(t) || /\brate sheet\b/.test(head)) return 'rate_sheet'
  if (/bulletin|announcement|overlay|memo|update notice/.test(t)) return 'overlay_bulletin'
  if (/matri(x|ces)|eligibility grid|ltv grid/.test(t)) return 'matrix'
  if (/guide|guidelines|manual|handbook|seller|underwriting/.test(t)) return 'guidelines'
  // A matrix usually says so in its own heading, or is mostly percentages.
  if (/\bmatri(x|ces)\b/.test(head.split('\n').slice(0, 3).join(' ')) || looksLikeMatrix(firstPages)) return 'matrix'
  return /bulletin|announcement/.test(head) ? 'overlay_bulletin' : 'guidelines'
}

interface Signals {
  lien: Lien | null
  family: ProductFamily | null
  docTypes: DocType[]
  features: Feature[]
}

function signals(text: string): Signals {
  const t = ` ${text.toLowerCase()} `
  const lien: Lien | null = /\bheloc\b|home equity line/.test(t) ? 'heloc' : /closed[- ]end second|\bces\b|second lien|2nd lien|stand[- ]?alone second|\bheloan\b|home equity loan|\b2nds?\b/.test(t) ? 'ces' : null
  const docTypes: DocType[] = []
  if (/\bdscr\b|debt service coverage/.test(t)) docTypes.push('dscr')
  if (/bank[- ]statement/.test(t)) {
    // "12 or 24 month" offers both; one month count offers that one; none given means 12.
    const both = /12\s*(or|\/|&|and|-)\s*24/.test(t)
    const has24 = both || /24[- ]?(mo|month)/.test(t)
    if (both || /12[- ]?(mo|month)/.test(t) || !has24) docTypes.push('bank_statement_12')
    if (has24) docTypes.push('bank_statement_24')
  }
  if (/\b1099\b/.test(t)) docTypes.push('form_1099')
  if (/\bp\s?&\s?l\b|profit (and|&) loss/.test(t)) docTypes.push('pnl_only')
  if (/asset (depletion|utilization|qualifier)/.test(t)) docTypes.push('asset_depletion')
  if (/\bwvoe\b|written verification of employment/.test(t)) docTypes.push('wvoe')
  if (/no[- ]ratio/.test(t)) docTypes.push('no_ratio')
  if (/\bira\b|retirement (income|distribution|account)|401\s?\(?k\)?/.test(t)) docTypes.push('retirement_distribution')
  const features: Feature[] = []
  if (/home ?ready|home possible/.test(t)) features.push('homeready_possible')
  if (/\bdpa\b|down payment assistance/.test(t)) features.push('dpa')
  if (/\bitin\b/.test(t)) features.push('itin')
  if (/foreign national/.test(t)) features.push('foreign_national')
  if (/interest[- ]only|\bi\/o\b/.test(t)) features.push('interest_only')
  const nonQm = docTypes.some((d) => d !== 'wvoe') || features.includes('itin') || features.includes('foreign_national') || /non[- ]?qm|alt[- ]?doc|non[- ]agency/.test(t)
  const family: ProductFamily | null = /\bfha\b/.test(t)
    ? 'fha'
    : /\bva\b|veterans affairs|\birrrl\b/.test(t)
      ? 'va'
      : /\busda\b|rural development/.test(t)
        ? 'usda'
        : nonQm
          ? 'non_qm'
          : /\bjumbo\b/.test(t)
            ? 'jumbo'
            : /conventional|fannie|freddie|agency|conforming|home ?ready|home possible/.test(t)
              ? 'conventional'
              : null
  return { lien, family, docTypes, features }
}

const hasAny = (s: Signals) => s.lien != null || s.family != null || s.docTypes.length > 0

function findTerms(text: string, lien: Lien): ProgramTerm[] {
  const t = text.toLowerCase()
  const allowed = termChoices(lien)
  const found = new Set<ProgramTerm>()
  if (lien === 'heloc') {
    const draw = /(\d{1,2})[- ]?(?:yr|year)s?\s+draw/.exec(t)?.[1]
    const repay = /(\d{1,2})[- ]?(?:yr|year)s?\s+(?:repay|repayment|amortiz)/.exec(t)?.[1]
    const term = `heloc_${draw}_${repay}` as ProgramTerm
    if (draw && repay && allowed.includes(term)) found.add(term)
    return found.size ? [...found] : ['heloc_10_20']
  }
  for (const m of t.matchAll(/\b(40|30|25|20|15|10)[- ]?(?:yr|year)s?\b/g)) found.add(`fixed_${m[1]}` as ProgramTerm)
  for (const m of t.matchAll(/\b(5|7|10)\/6\b/g)) found.add(`arm_${m[1]}_6` as ProgramTerm)
  const kept = allowed.filter((x) => found.has(x))
  return kept.length ? kept : ['fixed_30']
}

const NOISE = new RegExp(`\\b(${MONTH}\\.?\\s+\\d{4}(\\s+v?\\d+(\\.\\d+)+)?|v\\d+(\\.\\d+)*|rev(ision)?\\.?\\s*[\\d/.-]+|version\\s*[\\d.]+|matri(x|ces)|guidelines?|guide|manual|handbook|program|eligibility|sheet|effective|current|final|updated?|\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}|\\d{4})\\b`, 'gi')

/** The product name in a document title: "Equity Advantage HELOC Jul 2026 1.3" → "Equity Advantage HELOC". */
export function productName(title: string): string {
  return title.replace(NOISE, ' ').replace(/[()[\]·|,–—-]+/g, ' ').replace(/\s+/g, ' ').trim()
}

const DOC_NAME: Partial<Record<DocType, string>> = { dscr: 'DSCR', bank_statement_12: 'Bank Statement', bank_statement_24: 'Bank Statement', form_1099: '1099', pnl_only: 'P&L Only', asset_depletion: 'Asset Depletion', no_ratio: 'No Ratio', retirement_distribution: 'IRA Distribution' }
const FAMILY_NAME: Record<ProductFamily, string> = { conventional: 'Conventional', fha: 'FHA', va: 'VA', usda: 'USDA', jumbo: 'Jumbo', non_qm: 'Non-QM' }

/** The kind of document and the product it covers, from its file name first and its first pages second. */
export function guessDocument({ fileName, pages }: { fileName: string; pages: string[][] }): DocGuess {
  const title = titleFromFile(fileName)
  const firstPages = pages.slice(0, 3).map((p) => p.join('\n')).join('\n')
  const fromTitle = signals(title)
  const fromText = signals(firstPages)
  const basis: ProductGuess['basis'] = hasAny(fromTitle) ? 'title' : hasAny(fromText) ? 'text' : 'none'
  // The name wins; what it doesn't say (loan type, income types, features) comes from the first pages.
  const s = basis === 'title' ? { ...fromTitle, family: fromTitle.family ?? fromText.family, docTypes: fromTitle.docTypes.length ? fromTitle.docTypes : fromText.docTypes, features: fromTitle.features.length ? fromTitle.features : fromText.features } : fromText
  const lien = s.lien ?? 'first'
  const family = s.family ?? (lien === 'first' ? 'conventional' : 'non_qm')
  const docTypes: DocType[] = s.docTypes.length ? s.docTypes : ['full_doc']
  const name = productName(title) || [DOC_NAME[docTypes[0]] ?? FAMILY_NAME[family], lien === 'heloc' ? 'HELOC' : lien === 'ces' ? 'Closed-End Second' : ''].filter(Boolean).join(' ')
  return {
    docType: guessDocType(title, firstPages),
    title,
    versionLabel: findVersion(title) ?? findVersion(firstPages.slice(0, 1500)),
    effectiveDate: findEffectiveDate(title) ?? findEffectiveDate(firstPages.slice(0, 3000)),
    product: { name, family, lien, docTypes, features: s.features, termOptions: findTerms(`${title}\n${firstPages}`, lien), basis },
  }
}

/** Words that say nothing about which of a lender's programs a document covers. */
const GENERIC = new Set(['conventional', 'fha', 'usda', 'jumbo', 'dscr', 'heloc', 'program', 'programs', 'loan', 'loans', 'fixed', 'year', 'second', 'lien', 'closed', 'end', 'home', 'equity', 'bank', 'statement', 'with', 'and', 'the', 'non', 'agency', 'wholesale', 'sample', 'mortgage', 'lending', 'capital'])
const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !GENERIC.has(w) && !/^\d+$/.test(w))

/**
 * The lender's programs a document covers: same loan type and lien, sharing a
 * doc type when the document names one. When the document's name has words
 * that only some of those programs share ("HomeReady", "Assistance"), it
 * covers just those; a feature it names (DPA) narrows the same way.
 */
export function matchPrograms(guess: ProductGuess, programs: { id: string; name: string; family: ProductFamily; lien: Lien; docTypes: DocType[]; features: Feature[] }[]): string[] {
  const specific: DocType[] = guess.docTypes.filter((d) => d !== 'full_doc')
  let found = programs.filter((p) => p.family === guess.family && p.lien === guess.lien && (specific.length === 0 || p.docTypes.some((d) => specific.includes(d))))
  const named = words(guess.name)
  const byName = found.filter((p) => words(p.name).some((w) => named.includes(w)))
  if (byName.length) found = byName
  const byFeature = found.filter((p) => guess.features.some((f) => p.features.includes(f)))
  if (guess.features.length && byFeature.length) found = byFeature
  return found.map((p) => p.id)
}
