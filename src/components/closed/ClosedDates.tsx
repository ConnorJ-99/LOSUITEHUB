import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DateInput, FormGrid, Input } from '@/components/shared'
import { useLoanChanges, useSetLoanDates } from '@/lib/api/loans'
import { formatIsoDate } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'

const FIELD: Record<string, string> = { closing_date: 'Closed on', funding_date: 'Funded on', revenue_type: 'Revenue type', revenue_value: 'Revenue', assigned_lo_id: 'Loan officer' }
const shown = (field: string, v: string | null) => {
  if (v == null) return 'blank'
  if (field.endsWith('_date')) return formatIsoDate(v)
  if (field === 'revenue_value') return formatCurrency(Number(v))
  if (field === 'assigned_lo_id') return 'changed'
  return v
}

/**
 * A closed file's Closed on and Funded on, editable so old loans can be
 * corrected. Saving only writes the dates (and the change log, with the
 * reason): it never moves GHL or anything else.
 */
export function ClosedDates({ loanId, closingDate, fundingDate }: { loanId: string; closingDate: string | null; fundingDate: string | null }) {
  const save = useSetLoanDates(loanId)
  const changes = useLoanChanges(loanId)
  const [closed, setClosed] = useState(closingDate)
  const [funded, setFunded] = useState(fundingDate)
  const [reason, setReason] = useState('')
  const [history, setHistory] = useState(false)
  const dirty = closed !== closingDate || funded !== fundingDate
  const backwards = !!closed && !!funded && funded < closed
  const submit = () =>
    save.mutate(
      { closingDate: closed, fundingDate: funded, reason: reason.trim() || null },
      {
        onSuccess: () => {
          toast.success('Dates saved')
          setReason('')
        },
        onError: (e) => toast.error(e.message),
      },
    )
  const list = changes.data ?? []

  return (
    <div>
      <FormGrid>
        <DateInput label="Closed on" value={closed} onChange={setClosed} span={2} />
        <DateInput label="Funded on" value={funded} onChange={setFunded} span={2} error={backwards ? "Can't be before the closed date" : undefined} hint={!fundingDate && !dirty ? 'Not recorded: production uses the closed date' : undefined} />
        {dirty && <Input label="Reason (optional)" value={reason} onChange={setReason} span={2} placeholder="e.g. Corrected from the CD" />}
      </FormGrid>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        {list.length > 0 ? (
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setHistory((h) => !h)}>
            {history ? 'Hide' : 'Show'} change history ({list.length})
          </button>
        ) : (
          <span />
        )}
        {dirty && (
          <Button size="sm" disabled={save.isPending || backwards} onClick={submit}>
            {save.isPending ? 'Saving…' : 'Save dates'}
          </Button>
        )}
      </div>
      {history && (
        <ul className="mt-2 divide-y rounded-md border text-xs">
          {list.map((c) => (
            <li key={c.id} className="px-3 py-1.5">
              <span className="font-medium">{FIELD[c.field] ?? c.field}</span>: {shown(c.field, c.oldValue)} → {shown(c.field, c.newValue)}
              <span className="text-muted-foreground">
                {' '}
                · {c.changedBy ?? 'system'} · {new Date(c.changedAt).toLocaleString('en-US', { timeZone: 'America/Chicago' })}
                {c.reason && ` · "${c.reason}"`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
