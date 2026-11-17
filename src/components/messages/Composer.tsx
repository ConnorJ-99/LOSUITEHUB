import { useState } from 'react'
import { CalendarClockIcon, FileTextIcon, MailIcon, MessageSquareIcon, SendIcon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { confirmAction, Input, TextArea } from '@/components/shared'
import { sentOrDrafted, suggestReply, useScheduleMessage, useSendMessage, type FilePerson } from '@/lib/api/messages'
import { useAiStatus } from '@/lib/api/assistant'
import { scheduleLabel } from '@/lib/messaging/schedule'
import { ScheduleDialog } from './ScheduleDialog'
import { TemplatesDialog } from './TemplatesDialog'
import type { LoanProfile } from '@/lib/api/types'
import { formatPhone } from '@/lib/pipeline/helpers'
import { MAX_TEXT_LENGTH } from '../../../supabase/functions/ghl/sendRules'
import { TONE_CLASS } from './tone'
import { useSendPlan } from './useSendPlan'
import { useFileRole } from '@/lib/api/fileRole'

const newKey = () => crypto.randomUUID()

/**
 * Write and send one text or email through GHL. What's in the way (consent,
 * opt-out, sending hours, test mode, the LO's number) shows before you click,
 * from the same rules the server checks again on send.
 */
export function Composer({ loan, people }: { loan: LoanProfile; people: FilePerson[] }) {
  const rules = useSendPlan(loan)
  // A file's processor drafts for the loan officer (Connor, 2026-11-16): nothing sends, so sending hours don't apply yet.
  const fileRole = useFileRole(loan.id)
  const drafting = fileRole.role === 'processor'
  const approver = fileRole.loName ?? 'the loan officer'
  // "Suggest a reply" (Connor, 2026-11-16): the AI writes only when asked, into this box.
  const ai = useAiStatus()
  const [suggesting, setSuggesting] = useState(false)
  const send = useSendMessage()
  const schedule = useScheduleMessage()
  const [scheduling, setScheduling] = useState(false)
  // Templates (Connor, 2026-11-17): they fill the box only; sending is still the click below.
  const [templating, setTemplating] = useState(false)
  const [channel, setChannel] = useState<'text' | 'email'>('text')
  const [personId, setPersonId] = useState(people[0]?.id ?? '')
  const [body, setBody] = useState('')
  const [subject, setSubject] = useState('')
  // One key per message being written: a double click or retry reuses it, so it can't go twice.
  const [key, setKey] = useState(newKey)

  const person = people.find((p) => p.id === personId) ?? people[0]
  if (!person || !rules) return null
  const sendPlan = rules.plan(person, channel, body, subject)
  const plan = drafting ? { ...sendPlan, problems: sendPlan.problems.filter((p) => p === 'Write a message first.' || p === 'An email needs a subject.') } : sendPlan
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
    const ok = drafting
      ? await confirmAction(`Save ${what} for ${approver} to approve? Nothing is sent until they do, from their number.`, { confirmLabel: 'Save for approval' })
      : await confirmAction(`Send ${what}? It goes out through GHL from ${from}.`, { confirmLabel: channel === 'text' ? 'Send text' : 'Send email' })
    if (!ok) return
    send.mutate(
      { contactId: person.id, loanId: loan.id, channel, body, subject: channel === 'email' ? subject : null, idempotencyKey: key },
      {
        onSuccess: (r) => {
          if (r.alreadySent) toast.info(r.error ? `That message already failed: ${r.error}` : 'That message was already sent.')
          else toast.success(sentOrDrafted(r, `${channel === 'text' ? 'Text' : 'Email'} sent to ${person.firstName}`))
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

  const suggest = async () => {
    if (body.trim() && !(await confirmAction('Replace what you wrote with a suggested reply?', { confirmLabel: 'Replace' }))) return
    setSuggesting(true)
    try {
      const s = await suggestReply({ loanId: loan.id, contactId: person.id, channel })
      setChannel(s.channel)
      setBody(s.body)
      if (s.channel === 'email' && s.subject && !subject.trim()) setSubject(s.subject)
      toast.success('Suggested reply added. Read it over before you send it.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSuggesting(false)
    }
  }

  const applyTemplate = async (t: { body: string; subject: string }) => {
    if (body.trim() && !(await confirmAction('Replace what you wrote with this template?', { confirmLabel: 'Replace' }))) return
    setBody(t.body)
    if (channel === 'email') setSubject(t.subject)
    setTemplating(false)
    toast.success('Template added. Read it over and edit it before you send it.')
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
        <Button size="xs" variant="outline" onClick={() => setTemplating(true)} title="Fill the box with a ready-made message to edit. Nothing is sent.">
          <FileTextIcon />
          Templates
        </Button>
        {ai.data?.ready && (
          <Button size="xs" variant="outline" onClick={() => void suggest()} disabled={suggesting} title="The assistant writes a reply to their latest messages for you to edit. Nothing is sent.">
            <SparklesIcon />
            {suggesting ? 'Writing…' : 'Suggest a reply'}
          </Button>
        )}
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
          {!drafting && (
            <Button variant="outline" onClick={() => (laterProblems.length ? toast.error(laterProblems[0]) : setScheduling(true))} disabled={send.isPending || schedule.isPending || laterProblems.length > 0}>
              <CalendarClockIcon />
              Schedule…
            </Button>
          )}
          <Button onClick={submit} disabled={send.isPending || plan.problems.length > 0}>
            <SendIcon />
            {drafting ? (send.isPending ? 'Saving…' : `Save for ${approver} to approve`) : send.isPending ? 'Sending…' : channel === 'text' ? 'Send text' : 'Send email'}
          </Button>
        </div>
      </div>
      {templating && (
        <TemplatesDialog
          channel={channel}
          borrowerFirst={person.firstName}
          loName={rules.loName}
          loId={loan.assignedLo?.id ?? null}
          onUse={(t) => void applyTemplate(t)}
          onClose={() => setTemplating(false)}
        />
      )}
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
