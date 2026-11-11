import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { keys } from '@/lib/api/client'
import { saveGeneratedPdf, type GeneratedPdf } from '@/lib/api/documents'
import { useOrganization, useProfile } from '@/lib/api/settings'
import { useBrandImage } from '@/lib/api/brandFiles'
import type { LoanProfile } from '@/lib/api/types'
import { useAuth } from '@/lib/auth/context'
import { brandProblems, docBrand, type DocBrand } from '@/lib/documents/brand'
import type { FitResult } from '@/lib/documents/fit'
import { isSendableKind } from '@/lib/messaging/documentMessages'

type RenderLib = typeof import('./render')

export interface PdfRequest extends Omit<GeneratedPdf, 'file'> {
  /** Renders it with the PDF library, which loads only now. */
  render: (lib: RenderLib, brand: DocBrand) => Promise<FitResult<Blob>>
  /** What to shorten when it won't fit on one page. */
  tooLong: string
  /** No "Saved" notice (sharing estimates saves several at once). */
  quiet?: boolean
}

/**
 * Makes a one-page PDF with the company and LO letterhead, saves it to the
 * file's Documents, and offers to open it, or (estimates and pre-approval
 * letters) to email it to the borrower: render <SendSavedPdf> with
 * `sendingId` and `closeSend` once in the calling tab, or pass `onSend`
 * when the tab closes before the toast does (the Letters editor).
 */
export function useSavePdf(loan: LoanProfile, onSend?: (documentId: string) => void) {
  const { state } = useAuth()
  const me = state.status === 'signedIn' ? state.user.id : null
  const org = useOrganization()
  const lo = useProfile(loan.assignedLo?.id ?? me)
  // The uploaded logo and the LO's signature (Settings), drawn into the PDF.
  const logo = useBrandImage(org.data?.logoPath)
  const signature = useBrandImage(lo.data?.signaturePath)
  const brandNow = () => docBrand(org.data ?? null, lo.data ?? null, { logo: logo.data, signature: signature.data })
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [sendingId, setSendingId] = useState<string | null>(null)

  /** Returns the saved document's id, or null when it wasn't saved (the reason is shown). */
  const save = async ({ render, tooLong, quiet, ...doc }: PdfRequest): Promise<string | null> => {
    const brand = brandNow()
    const missing = brandProblems(brand)
    if (missing.length) {
      toast.error(`Add ${missing.join(' and ')} first. Every borrower document shows them.`)
      return null
    }
    setSaving(true)
    try {
      const fit = await render(await import('./render'), brand)
      if (!fit.ok) {
        toast.error(`This won't fit on one page even at 82% (${fit.pages} pages). ${tooLong}`)
        return null
      }
      const id = await saveGeneratedPdf(loan.id, loan.organizationId, { ...doc, file: fit.file })
      await queryClient.invalidateQueries({ queryKey: keys.documents(loan.id) })
      if (quiet) return id
      const url = URL.createObjectURL(fit.file)
      const open = { label: 'Open', onClick: () => window.open(url, '_blank') }
      toast.success(
        `Saved "${doc.fileName}" to Documents`,
        isSendableKind(doc.kind) ? { action: { label: 'Send…', onClick: () => (onSend ?? setSendingId)(id) }, cancel: open, duration: 10000 } : { action: open, duration: 10000 },
      )
      return id
    } catch (e) {
      toast.error((e as Error).message)
      return null
    } finally {
      setSaving(false)
    }
  }
  /** Renders without saving, for a live preview: a link to the PDF, or why it can't be made. */
  const preview = async (render: PdfRequest['render']): Promise<{ url: string } | { error: string }> => {
    const fit = await render(await import('./render'), brandNow())
    return fit.ok ? { url: URL.createObjectURL(fit.file) } : { error: `Too long for one page even at 82% (${fit.pages} pages). Shorten the conditions or what was reviewed.` }
  }
  return { save, preview, saving, sendingId, closeSend: () => setSendingId(null), ready: org.isSuccess && (lo.isSuccess || !lo.isEnabled) && !logo.isLoading && !signature.isLoading }
}
