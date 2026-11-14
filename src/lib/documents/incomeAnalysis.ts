// The one-page Income Analysis PDF (Stage 4): one worksheet's math line by
// line, what it was calculated from, the notes and warnings. Pure; the PDF
// component only lays this out. For the file and the underwriter, in the MPS
// template like the other PDFs. v2 (Stage 4d-3): each figure's source
// (document, page, quote), what the loan officer changed from the AI's
// figure, and who reviewed it.

import type { IncomeLine } from '@/lib/calc/income/types'
import { formatIsoDate } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'

export const INCOME_ANALYSIS_TEMPLATE = 'income-analysis v2'

/** One figure read from a document. */
export interface IncomeFigureSource {
  figure: string
  document: string
  page: number | null
  quote: string
}

export interface IncomeAnalysisInput {
  borrowerName: string
  /** The worksheet's label, e.g. "Salary · Excel". */
  label: string
  /** "Salary", "Bank statement", "Schedule C"… */
  typeLabel: string
  where: string | null
  lines: IncomeLine[]
  monthly: number
  warnings: string[]
  notes: string[]
  sources: string[]
  draft: boolean
  /** When it was pushed to the 1003 (YYYY-MM-DD), if it was. */
  pushedOn: string | null
  preparedOn: string
  /** v2: where each figure came from. */
  figureSources?: IncomeFigureSource[]
  /** v2: figures changed from what the AI read. */
  changes?: { figure: string; aiValue: string; newValue: string }[]
  /** v2: the person who checked the figures, and when (YYYY-MM-DD). */
  reviewed?: { name: string; on: string } | null
}

export interface IncomeAnalysisView {
  title: string
  borrower: string
  preparedOn: string
  facts: { label: string; value: string }[]
  lines: { label: string; amount: number; negative: boolean; kind: 'row' | 'sub' | 'total' }[]
  notes: string[]
  warnings: string[]
  sources: string[]
  /** v2: the Sources table (quotes cut to about 60 characters). */
  figureSources: { figure: string; document: string; page: string; quote: string }[]
  /** Dropped first when the page won't fit. */
  showQuotes: boolean
  changes: string[]
  reviewed: string | null
  disclaimer: string
  fileName: string
}

const cut = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s)

export function incomeAnalysisView(i: IncomeAnalysisInput): IncomeAnalysisView {
  return {
    title: 'Income Analysis',
    borrower: i.borrowerName,
    preparedOn: formatIsoDate(i.preparedOn),
    facts: [
      { label: 'Income', value: i.typeLabel },
      { label: i.typeLabel === 'Rental' ? 'Property' : 'Employer / business', value: i.where ?? '—' },
      { label: 'Qualifying monthly', value: formatCurrency(i.monthly) },
      // Whole dollars: the monthly is already rounded, so × 12 can land a few cents off the annual pay.
      { label: 'Annual', value: formatCurrency(Math.round(i.monthly * 12)) },
      { label: 'Status', value: i.draft ? 'Draft, not yet on the 1003' : i.pushedOn ? `On the 1003 since ${formatIsoDate(i.pushedOn)}` : 'Final' },
    ],
    lines: i.lines.map((l) => ({ label: l.label, amount: Math.abs(l.amount), negative: l.amount < 0, kind: l.kind === 'result' ? 'total' : l.kind === 'subtotal' ? 'sub' : 'row' })),
    notes: i.notes,
    warnings: i.warnings,
    sources: i.sources,
    figureSources: (i.figureSources ?? []).map((f) => ({ figure: f.figure, document: f.document, page: f.page ? String(f.page) : '—', quote: cut(f.quote) })),
    showQuotes: true,
    changes: (i.changes ?? []).map((c) => `${c.figure}: AI read ${c.aiValue} → ${c.newValue}`),
    reviewed: i.reviewed ? `Reviewed by ${i.reviewed.name} on ${formatIsoDate(i.reviewed.on)}` : null,
    disclaimer:
      'Prepared by the loan officer from the documents listed, following standard agency income guidelines. Figures are subject to verification and to the lender’s underwriting review. This is not a commitment to lend.',
    fileName: `Income Analysis - ${i.borrowerName} - ${i.label}.pdf`.replace(/[\\/:*?"<>|]+/g, '-'),
  }
}
