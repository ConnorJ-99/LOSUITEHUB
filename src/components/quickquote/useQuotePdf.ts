import { useBrandImage } from '@/lib/api/brandFiles'
import { useLoExtras } from '@/lib/api/quickQuotes'
import { useOrganization, useProfile } from '@/lib/api/settings'
import { brandProblems, docBrand } from '@/lib/documents/brand'
import { quickQuoteDoc, type QuickQuoteDocInput } from '@/lib/documents/quickQuote'

export type QuotePdfResult = { ok: true; file: Blob } | { ok: false; error: string }

/**
 * Makes the one-page quote PDF with the company letterhead and the loan
 * officer's block (photo and booking QR when set in Settings). Works with no
 * borrower file; saving it to Documents is the caller's step.
 */
export function useQuotePdf(loUserId: string | null) {
  const org = useOrganization()
  const lo = useProfile(loUserId)
  const extras = useLoExtras(loUserId)
  const logo = useBrandImage(org.data?.logoPath)
  const photo = useBrandImage(extras.data?.photoPath)

  const make = async (input: Omit<QuickQuoteDocInput, 'loName' | 'bookingUrl'>): Promise<QuotePdfResult> => {
    const brand = docBrand(org.data ?? null, lo.data ?? null, { logo: logo.data })
    const missing = brandProblems(brand)
    if (missing.length) return { ok: false, error: `Add ${missing.join(' and ')} first. Every borrower document shows them.` }
    const doc = quickQuoteDoc({ ...input, loName: brand.lo.name, bookingUrl: extras.data?.bookingUrl ?? null })
    if (doc.columns.length === 0) return { ok: false, error: 'Put at least one option with a rate on the quote.' }
    const { quickQuotePdf } = await import('./renderQuote')
    const fit = await quickQuotePdf(doc, brand, photo.data ?? null)
    return fit.ok ? { ok: true, file: fit.file } : { ok: false, error: `The quote won't fit on one page even at 82% (${fit.pages} pages). Shorten the note.` }
  }

  // A photo or booking link that can't load doesn't stop the PDF (it's made without them).
  const ready = org.isSuccess && lo.isSuccess && !logo.isLoading && !photo.isLoading && (extras.isSuccess || extras.isError)
  return { make, ready, hasPhoto: !!photo.data, bookingUrl: extras.data?.bookingUrl ?? null }
}
