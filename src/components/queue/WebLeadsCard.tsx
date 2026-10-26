import { Link } from 'react-router'
import { ArrowRightIcon, CheckIcon, GlobeIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/shared'
import { useMarkHandled, useOpenWebForms, type OpenWebForm, type SubmissionOutcome } from '@/lib/api/webForms'
import { relativeTime } from '@/lib/dates'

const LABEL: Record<SubmissionOutcome, string> = {
  new_lead: 'New lead',
  existing_open_loan: 'Added to an open file',
  new_loan_existing_person: 'Returning client',
  partner_inquiry: 'Partner inquiry',
}

function Row({ form }: { form: OpenWebForm }) {
  const mark = useMarkHandled()
  const done = () =>
    mark.mutate(
      { id: form.id, handled: true },
      {
        onSuccess: () =>
          toast.success(`${form.name}: done`, {
            action: { label: 'Undo', onClick: () => mark.mutate({ id: form.id, handled: false }) },
          }),
        onError: (e) => toast.error(e.message),
      },
    )
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div className="min-w-0">
        <p className="text-sm font-medium">
          {form.name}
          <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[0.7rem] font-medium text-muted-foreground">{LABEL[form.outcome]}</span>
        </p>
        <p className="text-xs text-muted-foreground">
          {form.formType ? form.formType.replace(/[_-]+/g, ' ') : 'web form'} · {relativeTime(form.receivedAt)}
          {form.contactLine && ` · ${form.contactLine}`}
        </p>
      </div>
      <div className="flex shrink-0 gap-1.5">
        {form.loanId && (
          <Button size="sm" variant="outline" asChild>
            <Link to={`/loans/${form.loanId}`}>
              Open file
              <ArrowRightIcon />
            </Link>
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={done} disabled={mark.isPending}>
          <CheckIcon />
          Done
        </Button>
      </div>
    </li>
  )
}

/** Web forms nobody has handled yet: new leads and partner inquiries. Hidden when there are none. */
export function WebLeadsCard() {
  const forms = useOpenWebForms()
  const list = forms.data ?? []
  if (list.length === 0) return null
  const partners = list.filter((f) => f.kind === 'partner').length
  return (
    <Card
      title={`From the website (${list.length})`}
      description={`${list.length - partners} lead form${list.length - partners === 1 ? '' : 's'}${partners ? ` and ${partners} partner inquir${partners === 1 ? 'y' : 'ies'}` : ''} waiting. First texts and emails for new leads are in the Action Queue.`}
      action={<GlobeIcon className="size-4 text-muted-foreground" />}
    >
      <ul className="divide-y">
        {list.map((f) => (
          <Row key={f.id} form={f} />
        ))}
      </ul>
    </Card>
  )
}
