// Loaded only when a quote PDF is made (the PDF library is large).

import { renderOnePage } from '@/components/pdf/render'
import { QuickQuotePdf } from '@/components/pdf/QuickQuotePdf'
import type { DocBrand } from '@/lib/documents/brand'
import type { QuickQuoteDoc } from '@/lib/documents/quickQuote'

export const quickQuotePdf = (doc: QuickQuoteDoc, brand: DocBrand, photo: string | null) => renderOnePage((scale) => <QuickQuotePdf doc={doc} brand={brand} photo={photo} scale={scale} />)
