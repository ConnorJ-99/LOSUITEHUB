import { useState } from 'react'
import { DownloadIcon, MailIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/shared'
import { SendSavedPdf } from '@/components/messages/SendDocumentDialog'
import { useSavePdf } from '@/components/pdf/useSavePdf'
import { linkGhlContact, useGhlStatus } from '@/lib/api/ghl'
import type { LoanProfile, Property } from '@/lib/api/types'
import type { ApprovalAt } from '@/lib/calc'
import type { Application } from '@/lib/api/urla'
import { nowIso, todayIso } from '@/lib/dates'
import { joinNames, worksheetFileName } from '@/lib/documents/feeWorksheet'
import { PREQUAL_RESULTS_TEMPLATE, prequalResultsProblems, prequalResultsView, type PrequalResultsInput } from '@/lib/documents/prequalResults'
import type { PrequalDraft, PrequalSummary } from '@/lib/prequal/draft'

/**
 * "Send prequal results" (decision 7), once the prequal is saved: matches or
 * adds the borrower in GHL (assigned to the loan officer), saves the one-page
 * Prequal Results PDF to Documents, then opens the email for Connor to
 * proofread. Sending it drafts the follow-up text in the Action Queue.
 */
export function SendPrequalResults({ loan, app, subject, draft, summary, dirty, atMax, compact }: { loan: LoanProfile; app: Application; subject: Property | null; draft: PrequalDraft; summary: PrequalSummary; dirty: boolean; /** Purchases: the Max Approval figures, which the PDF shows. */ atMax?: ApprovalAt | null; /** Just the Send button and a Download link, for inside the Max approval card. */ compact?: boolean }) {
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const pdf = useSavePdf(loan, setSendingId)
  const ghl = useGhlStatus()

  const names = app.borrowers.map((b) => `${b.person.firstName} ${b.person.lastName}`)
  const primary = app.borrowers.find((b) => b.role === 'primary') ?? app.borrowers[0]
  const input: PrequalResultsInput = {
    borrowerNames: names,
    isPurchase: loan.purpose === 'purchase',
    mortgageType: draft.loan.mortgageType,
    termMonths: draft.loan.termMonths,
    ...(atMax !== undefined
      ? {
          purchasePrice: atMax?.price ?? null,
          loanAmount: atMax?.loanAmount ?? null,
          maxPrice: atMax?.price ?? null,
          payment: atMax?.payment ?? null,
          downPayment: atMax?.downPayment ?? null,
          closingCosts: atMax?.costs ?? null,
          closingCostsEstimated: true,
          cashNeeded: atMax?.cashToClose ?? null,
        }
      : {
          purchasePrice: draft.loan.purchasePrice,
          loanAmount: summary.loanAmount,
          maxPrice: summary.max?.price ?? null,
          payment: summary.scenario.payment ?? null,
          downPayment: summary.cash?.downPayment ?? null,
          closingCosts: summary.cash?.closingCosts ?? null,
          closingCostsEstimated: summary.cash?.closingCostsEstimated ?? false,
          cashNeeded: summary.cashNeeded ?? summary.cash?.total ?? null,
        }),
    preparedOn: todayIso(),
  }
  const problems = prequalResultsProblems(input)
  const fileName = worksheetFileName('Prequal Results', joinNames(names), nowIso())
  const render: Parameters<typeof pdf.preview>[0] = (lib, brand) => lib.prequalResultsPdf(prequalResultsView(input), brand)

  // Download (Connor, 2026-11-16): the same PDF to hand over or attach yourself; nothing is saved or sent.
  const download = async () => {
    if (problems.length) return toast.error(problems[0])
    setBusy(true)
    try {
      const made = await pdf.preview(render)
      if ('error' in made) return toast.error(made.error)
      const a = document.createElement('a')
      a.href = made.url
      a.download = fileName.endsWith('.pdf') ? fileName : `${fileName}.pdf`
      a.click()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const start = async () => {
    if (problems.length) return toast.error(problems[0])
    setBusy(true)
    try {
      // GHL first: the borrower's contact, matched or added and assigned to the loan officer.
      const canEmail = ghl.data?.ready === true
      if (canEmail) {
        try {
          const linked = await linkGhlContact(loan.organizationId, loan.id, primary.contactId)
          if ('skipped' in linked) toast.info(linked.skipped)
          else if (linked.created) toast.success(`${primary.person.firstName} added to GHL, assigned to the loan officer`)
        } catch (e) {
          return toast.error((e as Error).message)
        }
      }
      const id = await pdf.save({
        kind: 'prequal_results',
        fileName,
        propertyId: subject?.id ?? null,
        templateVersion: PREQUAL_RESULTS_TEMPLATE,
        tooLong: 'Shorten the borrower names.',
        render,
      })
      if (!id) return
      if (canEmail) setSendingId(id)
      else toast.error('The PDF is saved in Documents, but GHL is not connected yet, so it cannot be emailed from MPS HQ.')
    } finally {
      setBusy(false)
    }
  }

  if (compact) {
    const why = dirty ? 'Save first, so the results match the file.' : problems[0]
    return (
      <div className="flex flex-col gap-1">
        <Button variant="outline" onClick={start} disabled={dirty || busy || pdf.saving || !pdf.ready} title={why ?? 'A one-page PDF for the borrower: buying power, payment, cash needed and next steps. No rates.'}>
          <MailIcon />
          {busy || pdf.saving ? 'Preparing…' : 'Send prequal results'}
        </Button>
        <button type="button" className="text-left text-xs text-primary hover:underline disabled:text-muted-foreground disabled:no-underline" onClick={download} disabled={dirty || busy || pdf.saving || !pdf.ready}>
          Download PDF
        </button>
        <SendSavedPdf loan={loan} docId={sendingId} onClose={() => setSendingId(null)} />
      </div>
    )
  }

  return (
    <Card title="Prequal results" description="A one-page PDF for the borrower: buying power, payment, cash needed and next steps. No rates.">
      <Button className="w-full" onClick={start} disabled={dirty || busy || pdf.saving || !pdf.ready}>
        <MailIcon />
        {busy || pdf.saving ? 'Preparing…' : 'Send prequal results'}
      </Button>
      <Button className="mt-2 w-full" variant="outline" onClick={download} disabled={dirty || busy || pdf.saving || !pdf.ready}>
        <DownloadIcon />
        Download PDF
      </Button>
      {dirty ? (
        <p className="mt-2 text-xs text-muted-foreground">Save first, so the results match the file.</p>
      ) : (
        problems.length > 0 && <p className="mt-2 text-xs text-muted-foreground">{problems[0]}</p>
      )}
      <SendSavedPdf loan={loan} docId={sendingId} onClose={() => setSendingId(null)} />
    </Card>
  )
}
