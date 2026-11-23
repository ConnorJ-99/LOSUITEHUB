// The prequal, merged into the 1003 tab (Connor, 2026-11-16: "the 1003 is in
// place of the phone prequal ... the calculated amounts are from the 1003").
// PrequalWorkspace works everything out from the saved 1003 and hands the 1003
// tab its pieces: above the 1003, the Max Approval what-ifs and the credit the
// 1003 has no place for (estimated scores, credit history); the side column
// (Max Approval, readiness with suggested documents, prequal results, the
// Prequal Results PDF to send or download); and the summary bar figures.
import { useMemo, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { NumberInput } from '@/components/shared'
import { useUpdateStage } from '@/lib/api/loans'
import { useSavePrequal } from '@/lib/api/prequal'
import { useFeeTemplates } from '@/lib/api/pricing'
import { prequalFeeEstimate, selectedClosingCosts } from '@/lib/estimates/prequal'
import { useOrganization } from '@/lib/api/settings'
import type { LoanProfile, Property } from '@/lib/api/types'
import type { Application } from '@/lib/api/urla'
import { maxApproval } from '@/lib/calc'
import { formatCurrency, formatPercent } from '@/lib/format'
import { approvalFacts, approvalFormFrom, approvalInput, type ApprovalForm } from '@/lib/prequal/maxApproval'
import { draftFrom, hasChanges, prequalChanges, prequalSummary, type PrequalDraft, type QuickBorrower } from '@/lib/prequal/draft'
import { MaxApprovalCard } from './MaxApproval'
import { CollapsibleCard, Fold } from './Fold'
import { CreditHistorySection } from './CreditHistorySection'
import { PrequalResults } from './PrequalResults'
import { SendPrequalResults } from './SendPrequalResults'

export interface SummaryFigure {
  label: string
  value: string
  warning?: boolean
}

export interface PrequalParts {
  /** The side column's first card: Max approval (purchases), or the payment and prequal results (refinances). */
  first: ReactNode
  /** The side column's credit card: estimated scores and credit history. */
  credit: ReactNode
  /** The summary bar's figures (none on purchases: the Max approval card shows them). */
  figures: SummaryFigure[]
  /** Save for the phone prequal while it has changes; null when saved. */
  saveButton: ReactNode | null
}

/** Loads nothing itself: the 1003 tab passes the application and homes it already has. */
export function PrequalWorkspace({ loan, app, properties, children }: { loan: LoanProfile; app: Application; properties: Property[]; children: (parts: PrequalParts) => ReactNode }) {
  const subject = properties.find((p) => p.id === loan.details.subjectPropertyId) ?? null
  const saved = draftFrom(loan, app, properties, false)
  return <PrequalForm loan={loan} app={app} subject={subject} properties={properties} saved={saved} render={children} />
}

function PrequalForm({ loan, app, subject, properties, saved, render }: { loan: LoanProfile; app: Application; subject: Property | null; properties: Property[]; saved: PrequalDraft; render: (parts: PrequalParts) => ReactNode }) {
  const [draft, setDraft] = useState<PrequalDraft>(() => draftFrom(loan, app, properties))
  const [approvalForm, setApprovalForm] = useState<ApprovalForm>(() => approvalFormFrom(loan.details))
  // Start fresh from the saved records whenever they change (after Save, or a 1003 section or AI Fill saving).
  // Done here instead of remounting, so the page below (and the AI Summary card mid-fill) keeps its state.
  const savedKey = JSON.stringify(saved)
  const [seenKey, setSeenKey] = useState(savedKey)
  if (seenKey !== savedKey) {
    setSeenKey(savedKey)
    setDraft(draftFrom(loan, app, properties))
    setApprovalForm(approvalFormFrom(loan.details))
  }
  const save = useSavePrequal(loan.id, loan.organizationId)
  const updateStage = useUpdateStage()

  const isPurchase = loan.purpose === 'purchase'
  const templates = useFeeTemplates()
  const feeEstimate = prequalFeeEstimate(loan, templates.data ?? [])
  const summary = prequalSummary(loan, draft, properties, feeEstimate)
  const changes = prequalChanges(isPurchase, saved, draft)
  const dirty = hasChanges(changes)
  // Max Approval (purchase files): the highest price where every limit passes. No specific home needed.
  const org = useOrganization()
  // Closing costs: typed over in the card, else the Selected estimate's (Connor, 2026-11-23), else the fee list at each price.
  const facts = approvalFacts(draft, summary, org.data, selectedClosingCosts(loan.details))
  const approvalIn = approvalInput(draft.loan, approvalForm, facts)
  const approvalKey = JSON.stringify([approvalIn, approvalForm.closingCosts, approvalForm.closingCostsPct, facts.selectedCosts])
  const approval = useMemo(
    () =>
      isPurchase
        ? maxApproval({
            ...approvalIn,
            // Closing costs and prepaids: typed or the Selected estimate (approvalIn), else the company fee list (Smart Fees) at each price, else 3% of the price.
            costsAt:
              approvalIn.costsAt ??
              (feeEstimate && ((price, loanAmount) => feeEstimate(price, loanAmount, { mortgageType: draft.loan.mortgageType, noteRate: draft.loan.noteRate, termMonths: draft.loan.termMonths, occupancy: approvalForm.occupancy, upfrontFeePct: draft.loan.upfrontFeePct }))),
          })
        : null,
    // Recalculated when the input's contents or the fee list change.
    [approvalKey, templates.dataUpdatedAt, isPurchase],
  )
  const max = approval?.max ?? null
  const setBorrower = (next: QuickBorrower) => setDraft((d) => ({ ...d, borrowers: d.borrowers.map((b) => (b.contactId === next.contactId ? next : b)) }))

  const onSave = () =>
    save.mutate(changes, {
      onSuccess: () => toast.success('Prequal saved to the 1003'),
      onError: (e) => toast.error(`Could not save everything: ${e.message}`),
    })
  const onMarkPrequalified = () =>
    updateStage.mutate(
      { loanId: loan.id, stage: 'pre_qualified' },
      { onSuccess: () => toast.success('Moved to Pre-Qualified'), onError: (e) => toast.error(e.message) },
    )


  const saveButton = (
    <Button onClick={onSave} disabled={!dirty || save.isPending}>
      {save.isPending ? 'Saving…' : dirty ? 'Save to 1003' : 'Saved'}
    </Button>
  )

  // The side column's first card (Connor, 2026-11-19 layout): Max approval on purchases; the payment and the results PDF otherwise.
  // The Readiness and Quick checks cards are no longer on this page (Readiness stays on the Nurture view).
  const first =
    isPurchase && approval ? (
      <MaxApprovalCard
        loan={loan}
        draftLoan={draft.loan}
        onLoanChange={(l) => setDraft((d) => ({ ...d, loan: l }))}
        form={approvalForm}
        onChange={setApprovalForm}
        facts={facts}
        result={approval}
        saveButton={saveButton}
        sendResults={<SendPrequalResults loan={loan} app={app} subject={subject} draft={draft} summary={summary} dirty={dirty} atMax={max} compact />}
      />
    ) : (
      <>
        <PrequalResults isPurchase={isPurchase} loan={draft.loan} summary={summary} checks={[]} canMarkPrequalified={false} onMarkPrequalified={onMarkPrequalified} />
        <SendPrequalResults loan={loan} app={app} subject={subject} draft={draft} summary={summary} dirty={dirty} />
      </>
    )

  // The credit the 1003 itself has no place for: estimated scores, then credit history (opens on a click).
  const credit = (
    <CollapsibleCard title="Credit" summary="Estimated scores and credit history">
      <p className="mb-2 text-sm text-muted-foreground">Estimated scores until credit is pulled.</p>
      <div className="grid grid-cols-2 gap-2">
        {draft.borrowers.map((b) => (
          <NumberInput
            key={b.contactId}
            label={`${b.firstName || 'Borrower'}${b.role === 'co_borrower' ? ' (co)' : ''}: score (est.)`}
            value={b.creditScore}
            onChange={(creditScore) => setBorrower({ ...b, creditScore })}
            maxDecimals={0}
          />
        ))}
      </div>
      {dirty && !isPurchase && (
        <div className="mt-3 flex items-center justify-end gap-2">
          <span className="text-xs text-muted-foreground">Not saved yet</span>
          {saveButton}
        </div>
      )}
      <div className="mt-3 border-t">
        <Fold title="Credit history">
          <CreditHistorySection loan={loan} app={app} />
        </Fold>
      </div>
    </CollapsibleCard>
  )

  // Purchases: none, since the Max approval card shows the same figures.
  const figures: SummaryFigure[] = isPurchase
    ? []
    : [
        { label: 'Payment', value: formatCurrency(summary.scenario.payment?.total) },
        { label: 'DTI', value: summary.dti.back === null ? '—' : `${formatPercent(summary.dti.front, 1)} / ${formatPercent(summary.dti.back, 1)}`, warning: summary.dti.back !== null && summary.dti.back > draft.loan.maxDtiPct },
        { label: 'LTV', value: formatPercent(summary.scenario.ltv, 2) },
      ]

  return render({ first, credit, figures, saveButton: dirty ? saveButton : null })
}
