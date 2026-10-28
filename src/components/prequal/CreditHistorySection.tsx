import { useState } from 'react'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CurrencyInput, DateInput, FormGrid, Input, Select, ToggleChip, confirmAction } from '@/components/shared'
import { EditDialog } from '@/components/urla/parts'
import { useCreditEvents, useDeleteCreditEvent, useSaveCreditEvent, type CreditEventDraft } from '@/lib/api/creditEvents'
import { useUpdateLoanDetails } from '@/lib/api/loans'
import type { IncomeDocType, LoanProfile } from '@/lib/api/types'
import type { Application } from '@/lib/api/urla'
import { formatIsoDate } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'
import { DOC_TYPE_LABEL, EVENT_LABEL, type CreditEventType } from '@/lib/prequal/readiness'

const DOC_OPTIONS = (Object.keys(DOC_TYPE_LABEL) as IncomeDocType[]).map((v) => ({ value: v, label: DOC_TYPE_LABEL[v] }))
const EVENT_OPTIONS = (Object.keys(EVENT_LABEL) as CreditEventType[]).map((v) => ({ value: v, label: EVENT_LABEL[v] }))
const DAYS_OPTIONS = ['30', '60', '90', '120'].map((v) => ({ value: v, label: `${v} days` }))

function EventDialog({ loan, app, initial, onClose }: { loan: LoanProfile; app: Application; initial: CreditEventDraft; onClose: () => void }) {
  const [e, setE] = useState(initial)
  const save = useSaveCreditEvent(loan.id, loan.organizationId)
  const set = <K extends keyof CreditEventDraft>(key: K) => (value: CreditEventDraft[K]) => setE((s) => ({ ...s, [key]: value }))
  const late = e.eventType === 'late_payment'
  const dateLabel = late ? 'Month of the late payment' : e.eventType === 'collection' ? 'Date reported' : 'Discharge or completion date'

  return (
    <EditDialog
      title={e.id ? 'Edit credit event' : 'Add credit event'}
      open
      onOpenChange={(o) => !o && onClose()}
      saving={save.isPending}
      onSubmit={() => save.mutate(e, { onSuccess: () => { toast.success('Credit history saved'); onClose() }, onError: (err) => toast.error(err.message) })}
    >
      <FormGrid className="lg:grid-cols-4">
        {app.borrowers.length > 1 && (
          <Select label="Whose" value={e.contactId} onChange={set('contactId')} options={app.borrowers.map((b) => ({ value: b.contactId, label: `${b.person.firstName} ${b.person.lastName}`.trim() }))} span={2} />
        )}
        <Select label="What happened" value={e.eventType} onChange={set('eventType')} options={EVENT_OPTIONS} required span={2} />
        <DateInput label={dateLabel} value={e.eventDate} onChange={set('eventDate')} hint={late ? 'Mortgage lates count for 12 months' : e.eventType === 'collection' ? undefined : 'The waiting period counts from this date'} span={2} />
        {late && (
          <>
            <Select label="Days late" value={e.daysLate ? String(e.daysLate) : null} onChange={(v) => set('daysLate')(Number(v))} options={DAYS_OPTIONS} required />
            <div className="flex items-end pb-1">
              <ToggleChip label="Mortgage payment" pressed={e.isMortgage} onChange={set('isMortgage')} />
            </div>
          </>
        )}
        {e.eventType === 'collection' && <CurrencyInput label="Amount" value={e.amount} onChange={set('amount')} span={2} />}
        <Input label="Notes" value={e.notes ?? ''} onChange={(v) => set('notes')(v || null)} placeholder="e.g. truck loan, paid off since" span={4} />
      </FormGrid>
    </EditDialog>
  )
}

/**
 * How income will be documented, the timeline, and credit history (person
 * facts). Each saves on its own, separate from the prequal's Save.
 */
export function CreditHistorySection({ loan, app }: { loan: LoanProfile; app: Application }) {
  const update = useUpdateLoanDetails(loan.id)
  const events = useCreditEvents(loan.id, app.borrowers.map((b) => b.contactId))
  const remove = useDeleteCreditEvent(loan.id)
  const [editing, setEditing] = useState<CreditEventDraft | null>(null)
  const [timeline, setTimeline] = useState(loan.details.timeline ?? '')
  const primary = app.borrowers.find((b) => b.role === 'primary') ?? app.borrowers[0]
  const nameOf = (contactId: string) => app.borrowers.find((b) => b.contactId === contactId)?.person.firstName ?? ''

  const saveDetail = (changes: { incomeDocType?: IncomeDocType | null; timeline?: string | null }, label: string) =>
    update.mutate(changes, { onSuccess: () => toast.success(`${label} saved`), onError: (e) => toast.error(e.message) })

  return (
    <Card title="Program and credit history" description="Saved as you go. These feed the readiness result.">
      <FormGrid>
        <Select
          label="How income will be documented"
          value={loan.details.incomeDocType}
          options={DOC_OPTIONS}
          onChange={(v) => saveDetail({ incomeDocType: v }, 'Income documentation')}
          onClear={() => saveDetail({ incomeDocType: null }, 'Income documentation')}
          placeholder="Not decided (full doc)"
          span={3}
        />
        <Input
          label="Timeline"
          value={timeline}
          onChange={setTimeline}
          onBlur={() => timeline.trim() !== (loan.details.timeline ?? '') && saveDetail({ timeline: timeline.trim() || null }, 'Timeline')}
          placeholder="e.g. 3-6 months, after the lease ends"
          span={3}
        />
      </FormGrid>

      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Credit history</p>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setEditing({ id: null, contactId: primary.contactId, eventType: 'late_payment', eventDate: null, daysLate: 30, isMortgage: false, amount: null, notes: null })}
        >
          <PlusIcon />
          Add
        </Button>
      </div>
      {(events.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No bankruptcies, foreclosures, short sales, late payments or collections noted.</p>
      ) : (
        <ul className="divide-y">
          {events.data!.map((e) => (
            <li key={e.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
              <span className="min-w-0">
                {EVENT_LABEL[e.eventType]}
                {e.eventType === 'late_payment' && ` (${e.daysLate} days${e.isMortgage ? ', mortgage' : ''})`}
                {e.eventType === 'collection' && e.amount !== null && ` (${formatCurrency(e.amount)})`}
                <span className="text-muted-foreground">
                  {' '}
                  · {e.eventDate ? formatIsoDate(e.eventDate) : 'date unknown'}
                  {app.borrowers.length > 1 && ` · ${nameOf(e.contactId)}`}
                  {e.notes && ` · ${e.notes}`}
                </span>
              </span>
              <span className="flex shrink-0 gap-1">
                <Button size="icon-sm" variant="ghost" aria-label="Edit" onClick={() => setEditing(e)}>
                  <PencilIcon />
                </Button>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Delete"
                  disabled={remove.isPending}
                  onClick={async () => (await confirmAction(`Delete this ${EVENT_LABEL[e.eventType].toLowerCase()}?`, { confirmLabel: 'Delete', destructive: true })) && remove.mutate(e.id, { onError: (err) => toast.error(err.message) })}
                >
                  <Trash2Icon />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {editing && <EventDialog loan={loan} app={app} initial={editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}
