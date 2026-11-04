import { useState } from 'react'
import { CalendarClockIcon, MailIcon, MessageSquareIcon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { confirmAction, Input, TextArea } from '@/components/shared'
import { useScheduleMessage, useSendMessage, type FilePerson } from '@/lib/api/messages'
import { scheduleLabel } from '@/lib/messaging/schedule'
import { ScheduleDialog } from './ScheduleDialog'
import type { LoanProfile } from '@/lib/api/types'
import { formatPhone } from '@/lib/pipeline/helpers'
import { MAX_TEXT_LENGTH } from '../../../supabase/functions/ghl/sendRules'
import { TONE_CLASS } from './tone'
import { useSendPlan } from './useSendPlan'

const newKey = () => crypto.randomUUID()

/**
 * Write and send one text or email through GHL. What's in the way (consent,
 * opt-out, sending hours, test mode, the LO's number) shows before you click,
 * from the same rules the server checks again on send.
 */
export function Composer({ loan, people }: { loan: LoanProfile; people: FilePerson[] }) {
  const rules = useSendPlan(loan)
  const send = useSendMessage()
  const schedule = useScheduleMessage()
  const [scheduling, setScheduling] = useState(false)
  const [channel, setChannel] = useState<'text' | 'email'>('text')
  const [personId, setPersonId] = useState(people[0]?.id ?? '')
  const [body, setBody] = useState('')
  const [subject, setSubject] = useState('')
  // One key per message being written: a double click or retry reuses it, so it can't go twice.
  const [key, setKey] = useState(newKey)

  const person = people.find((p) => p.id === personId) ?? people[0]
  if (!person || !rules) return null
  const plan = rules.plan(person, channel, body, subject)
  const window = rules.window
  // "Write a message first" and the subject aren't worth a warning before you've typed.
  const blockers = plan.problems.filter((p) => !(p === 'Write a message first.' || (p === 'An email needs a subject.' && !body.trim())))
  const to = channel === 'text' ? (person.phone ? formatPhone(person.phone) : 'no mobile') : (person.email ?? 'no email')
  const from = channel === 'text' ? (plan.fromNumber ? `${rules.loName} · ${formatPhone(plan.fromNumber)}` : '—') : (plan.fromEmail ?? '—')

  // Scheduling for later: everything but "outside sending hours right now" (the time picked is checked instead).
  const laterProblems = plan.problems.filter((p) => !p.includes('Nothing sends outside them'))

  const submit = async () => {
    if (plan.problems.length) return toast.error(plan.problems[0])
    const what = channel === 'text' ? `this text to ${person.firstName} at ${to}` : `this email to ${person.firstName} at ${to}`
    if (!(await confirmAction(`Send ${what}? It goes out through GHL from ${from}.`, { confirmLabel: channel === 'text' ? 'Send text' : 'Send email' }))) return
    send.mutate(
      { contactId: person.id, loanId: loan.id, channel, body, subject: channel === 'email' ? subject : null, idempotencyKey: key },
      {
        onSuccess: (r) => {
          if (r.alreadySent) toast.info(r.error ? `That message already failed: ${r.error}` : 'That message was already sent.')
          else toast.success(`${channel === 'text' ? 'Text' : 'Email'} sent to ${person.firstName}`)
          setBody('')
          setSubject('')
          setKey(newKey())
        },
        // A failed send keeps the text and its key: GHL refused it, so sending again needs a new key.
        onError: (e) => {
          toast.error(e.message)
          if (/GHL didn't send it/.test(e.message)) setKey(newKey())
        },
      },
    )
  }

  return (
    <div className="mt-4 space-y-3 border-t pt-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <div className="flex rounded-lg bg-muted p-0.5">
          {(['text', 'email'] as const).map((c) => (
            <button key={c} type="button" onClick={() => setChannel(c)} className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1', channel === c ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground')}>
              {c === 'text' ? <MessageSquareIcon className="size-3.5" /> : <MailIcon className="size-3.5" />}
              {c === 'text' ? 'Text' : 'Email'}
            </button>
          ))}
        </div>
        <span>
          <span className="text-muted-foreground">To </span>
          {people.length > 1 ? (
            <select className="rounded-md border bg-card px-1.5 py-0.5" value={person.id} onChange={(e) => setPersonId(e.target.value)} aria-label="Send to">
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.firstName} {p.lastName}
                </option>
              ))}
            </select>
          ) : (
            person.firstName
          )}{' '}
          · {to}
        </span>
        <span>
          <span className="text-muted-foreground">From </span>
          {from}
        </span>
        <span className={cn('ml-auto', window.open ? TONE_CLASS.ok : TONE_CLASS.warn)}>{window.label}</span>
      </div>
      {channel === 'email' && <Input label="Subject" hideLabel placeholder="Subject" value={subject} onChange={setSubject} />}
      <TextArea label="Message" value={body} onChange={setBody} placeholder={`Write a ${channel === 'text' ? 'text' : 'email'} to ${person.firstName}…`} rows={channel === 'text' ? 3 : 6} />
      {blockers.length > 0 && (
        <ul className="space-y-1 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">
          {channel === 'text' ? `${body.trim().length} / ${MAX_TEXT_LENGTH}` : 'Sent as plain text'}
          {rules.testMode && ' · Test mode: only people named TEST'}
        </span>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={() => (laterProblems.length ? toast.error(laterProblems[0]) : setScheduling(true))} disabled={send.isPending || schedule.isPending || laterProblems.length > 0}>
            <CalendarClockIcon />
            Schedule…
          </Button>
          <Button onClick={submit} disabled={send.isPending || plan.problems.length > 0}>
            <SendIcon />
            {send.isPending ? 'Sending…' : channel === 'text' ? 'Send text' : 'Send email'}
          </Button>
        </div>
      </div>
      {scheduling && (
        <ScheduleDialog
          what={channel === 'text' ? `this text to ${person.firstName}` : `this email to ${person.firstName}`}
          busy={schedule.isPending}
          onClose={() => setScheduling(false)}
          onSchedule={(sendAt) =>
            schedule.mutate(
              { contactId: person.id, loanId: loan.id, channel, body, subject: channel === 'email' ? subject : null, idempotencyKey: key, sendAt },
              {
                onSuccess: () => {
                  toast.success(`Scheduled for ${scheduleLabel(sendAt)}`)
                  setScheduling(false)
                  setBody('')
                  setSubject('')
                  setKey(newKey())
                },
                onError: (e) => toast.error(e.message),
              },
            )
          }
        />
      )}
    </div>
  )
}
