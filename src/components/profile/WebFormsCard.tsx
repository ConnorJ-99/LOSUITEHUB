import { useState } from 'react'
import { ChevronDownIcon, GlobeIcon } from 'lucide-react'
import { cn } from 'cn'
import { Card } from '@/components/shared'
import type { LoanProfile } from '@/lib/api/types'
import { answerLines, useWebForms, type SubmissionOutcome, type WebForm } from '@/lib/api/webForms'
import { relativeTime } from '@/lib/dates'

const OUTCOME_LABEL: Record<SubmissionOutcome, string> = {
  new_lead: 'Started this lead',
  existing_open_loan: 'Added to an open file',
  new_loan_existing_person: 'Returning client, new lead',
  partner_inquiry: 'Partner inquiry',
}

function FormRow({ form, thisLoan }: { form: WebForm; thisLoan: boolean }) {
  const [open, setOpen] = useState(false)
  const lines = answerLines(form.answers)
  const tracking = Object.entries(form.tracking)
  return (
    <li className="py-2">
      <button type="button" className="flex w-full items-start justify-between gap-2 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <span className="min-w-0">
          <span className="block text-sm font-medium">{form.formType ? form.formType.replace(/[_-]+/g, ' ') : 'Web form'}</span>
          <span className="block text-xs text-muted-foreground">
            {relativeTime(form.receivedAt)} · {OUTCOME_LABEL[form.outcome]}
            {!thisLoan && ' · another file'}
            {form.source && ` · ${form.source}`}
          </span>
        </span>
        <ChevronDownIcon className={cn('mt-1 size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <dl className="mt-2 grid gap-x-4 gap-y-1 rounded-md bg-muted/40 p-2.5 text-sm sm:grid-cols-[auto_1fr]">
          {lines.length === 0 && <dd className="text-muted-foreground">No other answers.</dd>}
          {lines.map((l) => (
            <div key={l.label} className="contents">
              <dt className="text-muted-foreground">{l.label}</dt>
              <dd className="break-words">{l.value}</dd>
            </div>
          ))}
          {tracking.length > 0 && (
            <>
              <dt className="text-muted-foreground">Came from</dt>
              <dd className="break-words">{tracking.map(([k, v]) => `${k.replace('utm_', '')}: ${v}`).join(' · ')}</dd>
            </>
          )}
        </dl>
      )}
    </li>
  )
}

/** Forms this person sent from mps.mortgage, with every answer. Hidden when there are none. */
export function WebFormsCard({ loan }: { loan: LoanProfile }) {
  const forms = useWebForms(loan.id, loan.borrower?.id ?? null)
  if (!forms.data?.length) return null
  return (
    <Card title={`Web forms (${forms.data.length})`} description="Submitted on mps.mortgage. Answers are kept as sent.">
      <ul className="divide-y">
        {forms.data.map((f) => (
          <FormRow key={f.id} form={f} thisLoan={f.loanId === loan.id} />
        ))}
      </ul>
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <GlobeIcon className="size-3.5" />
        Anything that looked like an SSN or account number was removed before saving.
      </p>
    </Card>
  )
}
