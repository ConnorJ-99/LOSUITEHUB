import { useState } from 'react'
import { ChevronDownIcon, CopyIcon, MessageSquareTextIcon, ShieldCheckIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/shared'
import type { LoanProfile } from '@/lib/api/types'
import { answersText, answersView, formTitle, personFromAnswers, rawLines, useWebForms, type SubmissionOutcome, type WebForm } from '@/lib/api/webForms'
import { relativeTime } from '@/lib/dates'
import { AnswerGroups, Initials, OutcomeChip } from './WebFormAnswers'

const OUTCOME_LABEL: Record<SubmissionOutcome, string> = {
  new_lead: 'Started this lead',
  existing_open_loan: 'Added to an open file',
  new_loan_existing_person: 'Returning client, new lead',
  partner_inquiry: 'Partner inquiry',
  form_update: 'More answers, same form',
}

const stamp = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

function FormRow({ form, name, thisLoan, startOpen }: { form: WebForm; name: string; thisLoan: boolean; startOpen: boolean }) {
  const [open, setOpen] = useState(startOpen)
  const view = answersView(form.answers, form.tracking)
  const raw = rawLines(form.answers)
  const meta = [`${relativeTime(form.receivedAt)} · ${stamp.format(new Date(form.receivedAt))}`, view.originShort, !thisLoan && 'another file'].filter(Boolean).join(' · ')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(answersText(view))
      toast.success('Answers copied')
    } catch {
      toast.error("Couldn't copy. Select the answers and copy them by hand.")
    }
  }
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <Initials name={name} />
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold">{formTitle(form.formType)}</span>
            <OutcomeChip outcome={form.outcome} label={OUTCOME_LABEL[form.outcome]} />
            {view.smsOk && (
              <span className="inline-flex items-center gap-1 rounded-full bg-nurture/10 px-2 py-0.5 text-[0.7rem] font-medium text-nurture">
                <MessageSquareTextIcon className="size-3" />
                SMS OK
              </span>
            )}
          </span>
          <span className="block text-xs text-muted-foreground">{meta}</span>
        </button>
        {open ? (
          <Button size="sm" variant="outline" onClick={copy}>
            <CopyIcon />
            Copy answers
          </Button>
        ) : (
          <button type="button" onClick={() => setOpen(true)} aria-label="Show answers">
            <ChevronDownIcon className="mt-1 size-4 text-muted-foreground" />
          </button>
        )}
      </div>
      {open && (
        <Tabs defaultValue="answers" className="mt-3">
          <TabsList variant="line">
            <TabsTrigger value="answers">Answers</TabsTrigger>
            <TabsTrigger value="origin">Where they came from</TabsTrigger>
            <TabsTrigger value="raw">Raw</TabsTrigger>
          </TabsList>
          <TabsContent value="answers" className="rounded-lg bg-muted/50 p-3">
            <AnswerGroups view={view} />
          </TabsContent>
          <TabsContent value="origin" className="rounded-lg bg-muted/50 p-3">
            {view.origin.length ? (
              <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
                {view.origin.map((o) => (
                  <div key={o.label} className="contents">
                    <dt className="text-muted-foreground">{o.label}</dt>
                    <dd className="break-words">{o.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-sm text-muted-foreground">The form didn't say where they came from.</p>
            )}
          </TabsContent>
          <TabsContent value="raw" className="rounded-lg bg-muted/50 p-3">
            <p className="mb-2 text-xs text-muted-foreground">Exactly as the website sent it, blanks left out.</p>
            <dl className="grid gap-x-4 gap-y-1 font-mono text-xs sm:grid-cols-[auto_1fr]">
              {raw.map((r) => (
                <div key={r.key} className="contents">
                  <dt className="text-muted-foreground">{r.key}</dt>
                  <dd className="break-all">{r.value}</dd>
                </div>
              ))}
            </dl>
          </TabsContent>
        </Tabs>
      )}
    </li>
  )
}

/** Forms this person sent from mps.mortgage, newest open, with every answer. Hidden when there are none. */
export function WebFormsCard({ loan }: { loan: LoanProfile }) {
  const forms = useWebForms(loan.id, loan.borrower?.id ?? null)
  if (!forms.data?.length) return null
  const borrowerName = loan.borrower ? `${loan.borrower.firstName} ${loan.borrower.lastName}` : null
  return (
    <Card title={`Web forms (${forms.data.length})`} description="Submitted on mps.mortgage · kept exactly as sent">
      <ul className={cn('divide-y', '-my-3')}>
        {forms.data.map((f, i) => (
          <FormRow key={f.id} form={f} name={borrowerName ?? personFromAnswers(f.answers).name} thisLoan={f.loanId === loan.id} startOpen={i === 0} />
        ))}
      </ul>
      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground">
        <ShieldCheckIcon className="size-3.5" />
        Anything that looked like an SSN or account number was removed before saving.
      </p>
    </Card>
  )
}
