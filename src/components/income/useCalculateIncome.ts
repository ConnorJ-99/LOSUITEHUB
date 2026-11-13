// "Calculate income" (Stage 4): one borrower's analyzed uploads → draft
// worksheets (src/lib/income/fromDocuments.ts), saved beside any worksheet
// Connor typed. Only on a click; never automatic.
import { toast } from 'sonner'
import { useAnalyses } from '@/lib/api/analyses'
import { useLoanDocuments } from '@/lib/api/documents'
import { useSaveIncomeDrafts } from '@/lib/api/income'
import type { LoanProfile } from '@/lib/api/types'
import { useApplication } from '@/lib/api/urla'
import { todayIso } from '@/lib/dates'
import { incomeDrafts, unmatchedEmployers, type IncomeDoc } from '@/lib/income/fromDocuments'
import { computeWorksheet } from '@/lib/income/worksheets'

export function useCalculateIncome(loan: LoanProfile) {
  const analyses = useAnalyses(loan.id)
  const docs = useLoanDocuments(loan.id)
  const app = useApplication(loan.id)
  const save = useSaveIncomeDrafts(loan.id, loan.organizationId)
  /** False before the upload analysis script has run (then there's nothing to calculate from). */
  const available = analyses.data !== null && analyses.data !== undefined

  const run = async (contactId: string, only?: 'wages' | 'bank_statement' | 'returns'): Promise<{ count: number; unmatched: string[] }> => {
    const borrowers = app.data?.borrowers ?? []
    const borrower = borrowers.find((b) => b.contactId === contactId)
    if (!borrower || !analyses.data || !docs.data) return { count: 0, unmatched: [] }
    const incomeDocs: IncomeDoc[] = []
    for (const a of analyses.data.values()) {
      if (a.status !== 'ready' && a.status !== 'needs_review') continue
      const d = docs.data.find((x) => x.id === a.documentId)
      // This borrower's uploads, plus unassigned ones when there's only one borrower.
      if (!d || !(d.contactId === contactId || (d.contactId === null && borrowers.length === 1))) continue
      // Connor's type wins; the AI's suggestion only fills in for "other".
      const kind = d.kind !== 'other' ? d.kind : (a.suggestedKind ?? 'other')
      incomeDocs.push({ documentId: d.id, fileName: d.fileName, kind, fields: a.fields })
    }
    const jobs = borrower.employments.map((e) => ({ id: e.id, employerName: e.employerName, current: e.status === 'current', selfEmployed: e.isSelfEmployed, startDate: e.startDate, endDate: e.endDate }))
    const drafts = incomeDrafts({ docs: incomeDocs, jobs, today: todayIso(), only })
    const unmatched = !only || only === 'wages' ? unmatchedEmployers(incomeDocs, jobs) : []
    if (drafts.length === 0) return { count: 0, unmatched }
    await save.mutateAsync(
      drafts.map((d) => ({ contactId, kind: d.data.kind, label: d.label, inputs: d.data.inputs, resultMonthly: computeWorksheet(d.data).monthly, employmentId: d.employmentId, sourceDocumentIds: d.sourceDocumentIds, sourceNotes: d.notes, inputSources: d.inputSources })),
    )
    return { count: drafts.length, unmatched }
  }

  const calculate = (contactId: string, firstName: string, only?: 'wages' | 'bank_statement' | 'returns') =>
    run(contactId, only).then(
      ({ count: n, unmatched }) => {
        const left = unmatched.length ? ` Left out: ${unmatched.join(', ')} (not a current job on ${firstName}'s 1003; add the job, then calculate again).` : ''
        if (n) toast.success(`${n} draft worksheet${n === 1 ? '' : 's'} for ${firstName}. Check each one, then Accept to push it to the 1003.${left}`)
        else if (left) toast.warning(`Nothing calculated for ${firstName}.${left}`)
        else toast.info(`Nothing to calculate for ${firstName} yet: no analyzed pay stubs, W-2s, bank statements or tax returns${only ? ' of that kind' : ''}.`)
      },
      (e: Error) => toast.error(e.message),
    )

  return { available, busy: save.isPending, calculate }
}
