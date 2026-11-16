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
import { Card, FormGrid, NumberInput } from '@/components/shared'
import { useUpdateStage } from '@/lib/api/loans'
import { useSavePrequal } from '@/lib/api/prequal'
import { useFeeTemplates } from '@/lib/api/pricing'
import { prequalFeeEstimate } from '@/lib/estimates/prequal'
import { useOrganization } from '@/lib/api/settings'
import type { LoanProfile, Property } from '@/lib/api/types'
import type { Application } from '@/lib/api/urla'
import { APPROVAL_LIMIT_LABELS, approvalTypeFor, maxApproval, prequalChecks } from '@/lib/calc'
import { formatCurrency, formatPercent } from '@/lib/format'
import { approvalFacts, approvalFormFrom, approvalInput, type ApprovalForm } from '@/lib/prequal/maxApproval'
import { draftFrom, hasChanges, prequalChanges, prequalSummary, type PrequalDraft, type QuickBorrower } from '@/lib/prequal/draft'
import { MaxApprovalInputs, MaxApprovalResults } from './MaxApproval'
import { CreditHistorySection } from './CreditHistorySection'
import { PrequalResults } from './PrequalResults'
import { ReadinessCard, useLiveReadiness } from './Readiness'
import { SendPrequalResults } from './SendPrequalResults'

export interface SummaryFigure {
  label: string
  value: string
  warning?: boolean
}

export interface PrequalParts {
  /** Above the 1003: Max Approval what-ifs and credit. */
  top: ReactNode
  /** The side column: Max Approval, readiness, results, the PDF. */
  panel: ReactNode
  /** The summary bar's figures. */
  figures: SummaryFigure[]
  /** Save for the phone prequal while it has changes; null when saved. */
  saveButton: ReactNode | null
}

/** Loads nothing itself: the 1003 tab passes the application and homes it already has. */
export function PrequalWorkspace({ loan, app, properties, children }: { loan: LoanProfile; app: Application; properties: Property[]; children: (parts: PrequalParts) => ReactNode }) {
  const subject = properties.find((p) => p.id === loan.details.subjectPropertyId) ?? null
  const saved = draftFrom(loan, app, properties, false)
  // Start fresh from the saved records whenever they change (after Save, or a 1003 section saving).
  return <PrequalForm key={JSON.stringify(saved)} loan={loan} app={app} subject={subject} properties={properties} saved={saved} render={children} />
}

function PrequalForm({ loan, app, subject, properties, saved, render }: { loan: LoanProfile; app: Application; subject: Property | null; properties: Property[]; saved: PrequalDraft; render: (parts: PrequalParts) => ReactNode }) {
  const [draft, setDraft] = useState<PrequalDraft>(() => draftFrom(loan, app, properties))
  const save = useSavePrequal(loan.id, loan.organizationId)
  const updateStage = useUpdateStage()

  const isPurchase = loan.purpose === 'purchase'
  const templates = useFeeTemplates()
  const feeEstimate = prequalFeeEstimate(loan, templates.data ?? [])
  const summary = prequalSummary(loan, draft, properties, feeEstimate)
  const changes = prequalChanges(isPurchase, saved, draft)
  const dirty = hasChanges(changes)
  const live = useLiveReadiness(loan, app, summary, draft)
  // Max Approval (purchase files): the highest price where every limit passes. No specific home needed.
  const org = useOrganization()
  const [approvalForm, setApprovalForm] = useState<ApprovalForm>(() => approvalFormFrom(loan.details))
  const facts = approvalFacts(draft, summary, org.data)
  const approvalIn = approvalInput(draft.loan, approvalForm, facts)
  const approvalKey = JSON.stringify(approvalIn)
  const approval = useMemo(
    () =>
      isPurchase
        ? maxApproval({
            ...approvalIn,
            // Closing costs and prepaids from the company fee list (Smart Fees) at each price, else 3% of the price.
            costsAt: feeEstimate && ((price, loanAmount) => feeEstimate(price, loanAmount, { mortgageType: draft.loan.mortgageType, noteRate: draft.loan.noteRate, termMonths: draft.loan.termMonths, occupancy: approvalForm.occupancy, upfrontFeePct: draft.loan.upfrontFeePct })),
          })
        : null,
    // Recalculated when the input's contents or the fee list change.
    [approvalKey, templates.dataUpdatedAt, isPurchase],
  )
  const max = approval?.max ?? null
  const approvalChecks = isPurchase
    ? prequalChecks({ mortgageType: draft.loan.mortgageType, creditScore: summary.creditScore, ltvPct: max?.ltv ?? null, backDtiPct: max?.dti.back ?? null, maxDtiPct: approvalIn.maxDtiPct, cashNeeded: max?.cashNeeded ?? null, funds: max?.funds ?? null, isPurchase: true })
    : summary.checks
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


  const results = isPurchase && approval ? <MaxApprovalResults loan={loan} loanType={approvalTypeFor(draft.loan.mortgageType)} result={approval} /> : null
  const saveButton = (
    <Button onClick={onSave} disabled={!dirty || save.isPending}>
      {save.isPending ? 'Saving…' : dirty ? 'Save to 1003' : 'Saved'}
    </Button>
  )

  // Above the 1003: the Max Approval what-ifs (purchase) and the credit the 1003 itself has no place for.
  const top = (
    <div className="space-y-4">
      {isPurchase && approval && <MaxApprovalInputs loan={draft.loan} onLoanChange={(l) => setDraft((d) => ({ ...d, loan: l }))} form={approvalForm} onChange={setApprovalForm} facts={facts} />}
      <Card title="Credit" description="Estimated scores until credit is pulled, and credit history. Everything else is figured from the 1003 below.">
        <FormGrid>
          {draft.borrowers.map((b) => (
            <NumberInput
              key={b.contactId}
              label={`${b.firstName || 'Borrower'}${b.role === 'co_borrower' ? ' (co)' : ''}: credit score (estimate)`}
              value={b.creditScore}
              onChange={(creditScore) => setBorrower({ ...b, creditScore })}
              maxDecimals={0}
              span={2}
            />
          ))}
        </FormGrid>
        {dirty && (
          <div className="mt-3 flex items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground">Not saved yet</span>
            {saveButton}
          </div>
        )}
      </Card>
      <CreditHistorySection loan={loan} app={app} />
    </div>
  )

  const panel = (
    <>
      {results}
      <ReadinessCard loan={loan} view={live} />
      <PrequalResults
        isPurchase={isPurchase}
        loan={draft.loan}
        summary={summary}
        checks={approvalChecks}
        canMarkPrequalified={(loan.stage === 'lead' || loan.stage === 'contacted') && !dirty}
        onMarkPrequalified={onMarkPrequalified}
      />
      <SendPrequalResults loan={loan} app={app} subject={subject} draft={draft} summary={summary} dirty={dirty} atMax={isPurchase ? max : undefined} />
    </>
  )

  const figures: SummaryFigure[] = isPurchase
    ? [
        { label: 'Max approval', value: formatCurrency(max?.price) },
        { label: 'Limited by', value: approval?.limitedBy ? APPROVAL_LIMIT_LABELS[approval.limitedBy] : '—' },
        { label: 'Payment', value: formatCurrency(max?.payment.total) },
        { label: 'DTI', value: max ? `${formatPercent(max.dti.front, 1)} / ${formatPercent(max.dti.back, 1)}` : '—' },
      ]
    : [
        { label: 'Payment', value: formatCurrency(summary.scenario.payment?.total) },
        { label: 'DTI', value: summary.dti.back === null ? '—' : `${formatPercent(summary.dti.front, 1)} / ${formatPercent(summary.dti.back, 1)}`, warning: summary.dti.back !== null && summary.dti.back > draft.loan.maxDtiPct },
        { label: 'LTV', value: formatPercent(summary.scenario.ltv, 2) },
      ]

  return render({ top, panel, figures, saveButton: dirty ? saveButton : null })
}
