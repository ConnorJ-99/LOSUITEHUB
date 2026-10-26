import { useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { SummaryBar } from '@/components/shared'
import { CoBorrowerDialog } from '@/components/urla/CoBorrowerDialog'
import { useUpdateStage } from '@/lib/api/loans'
import { useSavePrequal } from '@/lib/api/prequal'
import { useProperties } from '@/lib/api/properties'
import type { LoanProfile, Property } from '@/lib/api/types'
import { useApplication, type Application } from '@/lib/api/urla'
import { formatCurrency, formatPercent } from '@/lib/format'
import { draftFrom, hasChanges, prequalChanges, prequalSummary, type PrequalDraft, type QuickBorrower } from '@/lib/prequal/draft'
import { BorrowerSection, DebtsSection, HomesSection, LoanSection, SavingsSection } from './PrequalSections'
import { CallNotes } from './CallNotes'
import { CreditHistorySection } from './CreditHistorySection'
import { PrequalResults } from './PrequalResults'
import { ReadinessCard, useLiveReadiness } from './Readiness'

/** The phone prequal: a short 1003 with live qualification, saved into the same records. */
export function PrequalTab({ loan }: { loan: LoanProfile }) {
  const app = useApplication(loan.id)
  const properties = useProperties(loan.id)
  if (app.isLoading || properties.isLoading) return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
  const error = app.error ?? properties.error
  if (error) return <p className="py-12 text-center text-sm text-destructive">{error.message}</p>
  if (app.data!.borrowers.length === 0) return <p className="py-12 text-center text-sm text-muted-foreground">No borrower on this loan.</p>

  const subject = properties.data?.find((p) => p.id === loan.details.subjectPropertyId) ?? null
  const saved = draftFrom(loan, app.data!, properties.data ?? [], false)
  // Start fresh from the saved records whenever they change (after Save, or an edit on another tab).
  return <PrequalForm key={JSON.stringify(saved)} loan={loan} app={app.data!} subject={subject} properties={properties.data ?? []} saved={saved} />
}

function PrequalForm({ loan, app, subject, properties, saved }: { loan: LoanProfile; app: Application; subject: Property | null; properties: Property[]; saved: PrequalDraft }) {
  const [draft, setDraft] = useState<PrequalDraft>(() => draftFrom(loan, app, properties))
  const [addingBorrower, setAddingBorrower] = useState(false)
  const save = useSavePrequal(loan.id, loan.organizationId)
  const updateStage = useUpdateStage()

  const isPurchase = loan.purpose === 'purchase'
  const summary = prequalSummary(loan, draft, properties)
  const changes = prequalChanges(isPurchase, saved, draft)
  const dirty = hasChanges(changes)
  const live = useLiveReadiness(loan, app, summary, draft)
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

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-4">
          <CallNotes loan={loan} app={app} draft={draft} onApply={setDraft} />
          <LoanSection isPurchase={isPurchase} loan={draft.loan} onChange={(l) => setDraft((d) => ({ ...d, loan: l }))} summary={summary} subject={subject} />
          {draft.borrowers.map((b) => (
            <BorrowerSection key={b.contactId} borrower={b} onChange={setBorrower} />
          ))}
          <div>
            <Button size="sm" variant="ghost" onClick={() => setAddingBorrower(true)} disabled={dirty}>
              <PlusIcon />
              Add co-borrower
            </Button>
            {dirty && <span className="ml-2 text-xs text-muted-foreground">Save first to add a co-borrower</span>}
          </div>
          <DebtsSection debts={draft.debts} borrowers={draft.borrowers} onChange={(debts) => setDraft((d) => ({ ...d, debts }))} />
          <HomesSection homes={draft.properties} onChange={(properties) => setDraft((d) => ({ ...d, properties }))} />
          <SavingsSection assets={draft.assets} borrowers={draft.borrowers} onChange={(assets) => setDraft((d) => ({ ...d, assets }))} />
          <CreditHistorySection loan={loan} app={app} />
        </div>
        <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">
          <ReadinessCard loan={loan} result={live} />
          <PrequalResults
            isPurchase={isPurchase}
            loan={draft.loan}
            summary={summary}
            onUsePrice={(purchasePrice) => setDraft((d) => ({ ...d, loan: { ...d.loan, purchasePrice } }))}
            canMarkPrequalified={(loan.stage === 'lead' || loan.stage === 'contacted') && !dirty}
            onMarkPrequalified={onMarkPrequalified}
          />
        </div>
      </div>

      <SummaryBar
        items={[
          ...(isPurchase ? [{ label: 'Max price', value: formatCurrency(summary.max?.price) }] : []),
          { label: 'Payment', value: formatCurrency(summary.scenario.payment?.total) },
          { label: 'DTI', value: summary.dti.back === null ? '—' : `${formatPercent(summary.dti.front, 1)} / ${formatPercent(summary.dti.back, 1)}`, warning: summary.dti.back !== null && summary.dti.back > draft.loan.maxDtiPct },
          { label: 'LTV', value: formatPercent(summary.scenario.ltv, 2) },
        ]}
        action={
          <Button onClick={onSave} disabled={!dirty || save.isPending}>
            {save.isPending ? 'Saving…' : dirty ? 'Save' : 'Saved'}
          </Button>
        }
      />

      {addingBorrower && <CoBorrowerDialog loanId={loan.id} existingBorrowerIds={draft.borrowers.map((b) => b.contactId)} onClose={() => setAddingBorrower(false)} onAdded={() => setAddingBorrower(false)} />}
    </>
  )
}
