import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowRightIcon, CheckIcon, GlobeIcon, MailIcon, PhoneIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/shared'
import { AnswerGroups, AnswerTile, Initials, OutcomeChip, TheirNote } from '@/components/profile/WebFormAnswers'
import { answersView, formTitle, leadSummary, useMarkHandled, useOpenWebForms, type OpenWebForm, type SubmissionOutcome } from '@/lib/api/webForms'
import { relativeTime } from '@/lib/dates'
import { formatPhone, phoneDigits } from '@/lib/pipeline/helpers'

const LABEL: Record<SubmissionOutcome, string> = {
  new_lead: 'New lead',
  existing_open_loan: 'Added to an open file',
  new_loan_existing_person: 'Returning client',
  partner_inquiry: 'Partner inquiry',
  form_update: 'More answers, same form',
}

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

function Row({ form }: { form: OpenWebForm }) {
  const mark = useMarkHandled()
  const [more, setMore] = useState(false)
  const view = answersView(form.answers, form.tracking)
  const summary = leadSummary(view)
  const a = form.answers
  const phone = phoneDigits(text(a.phone ?? a.phone_number ?? a.phoneNumber))
  const email = text(a.email ?? a.email_address ?? a.emailAddress)
  const isPartner = form.kind === 'partner'
  const company = text(a.brokerage ?? a.company ?? a.company_name ?? a.companyName)
  const role = text(a.contact_type ?? a.partner_type ?? a.contactType)
  const meta = [isPartner ? [role && role[0].toUpperCase() + role.slice(1), company].filter(Boolean).join(' · ') : formTitle(form.formType), relativeTime(form.receivedAt), !isPartner && phone && formatPhone(phone)].filter(Boolean).join(' · ')

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
    <li className="flex gap-3 py-4">
      <Initials name={form.name} partner={isPartner} />
      <div className="@container min-w-0 flex-1 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{form.name}</span>
              <OutcomeChip outcome={form.outcome} label={LABEL[form.outcome]} />
            </p>
            <p className="text-xs text-muted-foreground">{meta}</p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            {isPartner ? (
              <>
                {email && (
                  <Button size="sm" asChild>
                    <a href={`mailto:${email}`}>
                      <MailIcon />
                      Email
                    </a>
                  </Button>
                )}
                <Button size="sm" variant="outline" asChild title="Website partner forms are saved as partners on their own">
                  <Link to={`/partners?q=${encodeURIComponent(email || form.name)}`}>
                    View partner
                    <ArrowRightIcon />
                  </Link>
                </Button>
              </>
            ) : (
              <>
                {phone && (
                  <Button size="sm" asChild>
                    <a href={`tel:${phone}`}>
                      <PhoneIcon />
                      Call
                    </a>
                  </Button>
                )}
                {form.loanId && (
                  <Button size="sm" variant="outline" asChild>
                    <Link to={`/loans/${form.loanId}`}>
                      Open file
                      <ArrowRightIcon />
                    </Link>
                  </Button>
                )}
              </>
            )}
            <Button size="sm" variant="ghost" onClick={done} disabled={mark.isPending}>
              <CheckIcon />
              Done
            </Button>
          </div>
        </div>

        {!isPartner && (summary.goal || summary.pills.length > 0) && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {summary.goal && <span className="font-semibold">{summary.goal}</span>}
            {summary.pills.map((p) => (
              <span key={p} className="rounded-md bg-muted px-2 py-0.5">
                {p}
              </span>
            ))}
          </div>
        )}
        {!isPartner && summary.tiles.length > 0 && (
          <div className="grid grid-cols-2 gap-2 @xl:grid-cols-4">
            {summary.tiles.map((t) => (
              <AnswerTile key={t.key} field={t} className="bg-muted/40" />
            ))}
          </div>
        )}
        {summary.note && <TheirNote note={summary.note} />}
        {!isPartner && view.originShort && <span className="inline-block rounded-md border border-dashed px-2 py-0.5 text-xs text-muted-foreground">{view.originShort}</span>}
        {!isPartner && summary.more > 0 && (
          <div>
            <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setMore((m) => !m)} aria-expanded={more}>
              {more ? 'Hide answers' : `+ ${summary.more} more answer${summary.more === 1 ? '' : 's'}`}
            </button>
            {more && (
              <div className="mt-2 rounded-lg bg-muted/50 p-3">
                <AnswerGroups view={view} />
              </div>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

/** Web forms nobody has handled yet: new leads and partner inquiries, with enough of the answers to triage. Hidden when there are none. */
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
      <ul className="-my-4 divide-y">
        {list.map((f) => (
          <Row key={f.id} form={f} />
        ))}
      </ul>
    </Card>
  )
}
