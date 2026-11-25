// Loaded only when a PDF is made (the PDF library is large).

import type { ReactElement } from 'react'
import { pdf, type DocumentProps } from '@react-pdf/renderer'
import type { DocBrand } from '@/lib/documents/brand'
import type { FeeWorksheet } from '@/lib/documents/feeWorksheet'
import { fitToOnePage, type FitResult } from '@/lib/documents/fit'
import type { LoanComparison } from '@/lib/documents/loanComparison'
import type { FlyerView } from '@/lib/documents/openHouseFlyer'
import { pdfPageCount } from '@/lib/documents/pdfText'
import { BorrowerSummaryPdf } from './BorrowerSummaryPdf'
import type { SummaryView } from '@/lib/documents/borrowerSummary'
import { FeeWorksheetPdf } from './FeeWorksheetPdf'
import { IncomeAnalysisPdf } from './IncomeAnalysisPdf'
import type { IncomeAnalysisView } from '@/lib/documents/incomeAnalysis'
import { LoanComparisonPdf } from './LoanComparisonPdf'
import { OpenHouseFlyerPdf } from './OpenHouseFlyerPdf'
import { PreapprovalLetterPdf } from './PreapprovalLetterPdf'
import { PrequalResultsPdf } from './PrequalResultsPdf'
import { ReadinessRoadmapPdf } from './ReadinessRoadmapPdf'
import type { RoadmapView } from '@/lib/documents/readinessRoadmap'
import type { LetterView } from '@/lib/documents/preapproval'
import type { PrequalResultsView } from '@/lib/documents/prequalResults'

/** Renders the document at the largest scale that fits one page (100% down to 82%). */
export function renderOnePage(make: (scale: number) => ReactElement<DocumentProps>) {
  return fitToOnePage(
    (scale) => pdf(make(scale)).toBlob(),
    async (blob) => pdfPageCount(await blob.arrayBuffer()),
  )
}

export const feeWorksheetPdf = (worksheet: FeeWorksheet, brand: DocBrand) => renderOnePage((scale) => <FeeWorksheetPdf worksheet={worksheet} brand={brand} scale={scale} />)

export const loanComparisonPdf = (comparison: LoanComparison, brand: DocBrand) => renderOnePage((scale) => <LoanComparisonPdf comparison={comparison} brand={brand} scale={scale} />)

export const preapprovalLetterPdf = (letter: LetterView, brand: DocBrand) => renderOnePage((scale) => <PreapprovalLetterPdf letter={letter} brand={brand} scale={scale} />)

export const prequalResultsPdf = (results: PrequalResultsView, brand: DocBrand) => renderOnePage((scale) => <PrequalResultsPdf results={results} brand={brand} scale={scale} />)

export const openHouseFlyerPdf = (flyer: FlyerView) => renderOnePage((scale) => <OpenHouseFlyerPdf flyer={flyer} scale={scale} />)

export const incomeAnalysisPdf = (analysis: IncomeAnalysisView, brand: DocBrand) => renderOnePage((scale) => <IncomeAnalysisPdf analysis={analysis} brand={brand} scale={scale} />)

/** The roadmap (Connor, 2026-11-16) flows over 3–5 pages instead of fitting one; more than 8 is refused. */
export async function readinessRoadmapPdf(roadmap: RoadmapView, brand: DocBrand): Promise<FitResult<Blob>> {
  const file = await pdf(<ReadinessRoadmapPdf roadmap={roadmap} brand={brand} />).toBlob()
  const pages = await pdfPageCount(await file.arrayBuffer())
  return pages <= 8 ? { ok: true, file, scale: 1 } : { ok: false, pages }
}

/** The Borrower Summary (Connor, 2026-11-24) flows like his sample, usually 1–2 pages; more than 4 is refused. */
export async function borrowerSummaryPdf(summary: SummaryView, brand: DocBrand): Promise<FitResult<Blob>> {
  const file = await pdf(<BorrowerSummaryPdf summary={summary} brand={brand} />).toBlob()
  const pages = await pdfPageCount(await file.arrayBuffer())
  return pages <= 4 ? { ok: true, file, scale: 1 } : { ok: false, pages }
}
