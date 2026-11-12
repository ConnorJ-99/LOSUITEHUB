// The one-page Income Analysis PDF (Stage 4): one worksheet's math line by
// line, what it was calculated from, the notes and warnings. Pure; the PDF
// component only lays this out. For the file and the underwriter, in the MPS
// template like the other PDFs.

import type { IncomeLine } from '@/lib/calc/income/types'
import { formatIsoDate } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'

export const INCOME_ANALYSIS_TEMPLATE = 'income-analysis v1'

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
  disclaimer: string
  fileName: string
}

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
    disclaimer:
      'Prepared by the loan officer from the documents listed, following standard agency income guidelines. Figures are subject to verification and to the lender’s underwriting review. This is not a commitment to lend.',
    fileName: `Income Analysis - ${i.borrowerName} - ${i.label}.pdf`.replace(/[\\/:*?"<>|]+/g, '-'),
  }
}
