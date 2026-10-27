// Loaded only when a PDF is made (the PDF library is large).

import type { ReactElement } from 'react'
import { pdf, type DocumentProps } from '@react-pdf/renderer'
import type { DocBrand } from '@/lib/documents/brand'
import type { FeeWorksheet } from '@/lib/documents/feeWorksheet'
import { fitToOnePage } from '@/lib/documents/fit'
import type { LoanComparison } from '@/lib/documents/loanComparison'
import { pdfPageCount } from '@/lib/documents/pdfText'
import { FeeWorksheetPdf } from './FeeWorksheetPdf'
import { LoanComparisonPdf } from './LoanComparisonPdf'
import { PreapprovalLetterPdf } from './PreapprovalLetterPdf'
import type { LetterView } from '@/lib/documents/preapproval'

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
