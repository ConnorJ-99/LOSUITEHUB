import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { keys } from '@/lib/api/client'
import { saveGeneratedPdf, type GeneratedPdf } from '@/lib/api/documents'
import { useOrganization, useProfile } from '@/lib/api/settings'
import type { LoanProfile } from '@/lib/api/types'
import { useAuth } from '@/lib/auth/context'
import { brandProblems, docBrand, type DocBrand } from '@/lib/documents/brand'
import type { FitResult } from '@/lib/documents/fit'

type RenderLib = typeof import('./render')

export interface PdfRequest extends Omit<GeneratedPdf, 'file'> {
  /** Renders it with the PDF library, which loads only now. */
  render: (lib: RenderLib, brand: DocBrand) => Promise<FitResult<Blob>>
  /** What to shorten when it won't fit on one page. */
  tooLong: string
}

/** Makes a one-page PDF with the company and LO letterhead, saves it to the file's Documents, and offers to open it. */
export function useSavePdf(loan: LoanProfile) {
  const { state } = useAuth()
  const me = state.status === 'signedIn' ? state.user.id : null
  const org = useOrganization()
  const lo = useProfile(loan.assignedLo?.id ?? me)
  const queryClient = useQueryClient()
  const [saving, setSaving] = useState(false)

  const save = async ({ render, tooLong, ...doc }: PdfRequest): Promise<boolean> => {
    const brand = docBrand(org.data ?? null, lo.data ?? null)
    const missing = brandProblems(brand)
    if (missing.length) {
      toast.error(`Add ${missing.join(' and ')} first. Every borrower document shows them.`)
      return false
    }
    setSaving(true)
    try {
      const fit = await render(await import('./render'), brand)
      if (!fit.ok) {
        toast.error(`This won't fit on one page even at 82% (${fit.pages} pages). ${tooLong}`)
        return false
      }
      await saveGeneratedPdf(loan.id, loan.organizationId, { ...doc, file: fit.file })
      await queryClient.invalidateQueries({ queryKey: keys.documents(loan.id) })
      const url = URL.createObjectURL(fit.file)
      toast.success(`Saved "${doc.fileName}" to Documents`, { action: { label: 'Open', onClick: () => window.open(url, '_blank') }, duration: 10000 })
      return true
    } catch (e) {
      toast.error((e as Error).message)
      return false
    } finally {
      setSaving(false)
    }
  }
  return { save, saving, ready: org.isSuccess && (lo.isSuccess || !lo.isEnabled) }
}
