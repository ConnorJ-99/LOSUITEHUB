import { useRef, useState } from 'react'
import { CalendarClockIcon, CalendarPlusIcon, FileTextIcon, LanguagesIcon, LinkIcon, MailIcon, MessageSquareIcon, SendIcon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { confirmAction, Input } from '@/components/shared'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { sentOrDrafted, suggestReply, translateText, useScheduleMessage, useSendMessage, type FilePerson } from '@/lib/api/messages'
import { useAiStatus } from '@/lib/api/assistant'
import { scheduleLabel } from '@/lib/messaging/schedule'
import { ScheduleDialog } from './ScheduleDialog'
import { BookAppointmentDialog } from './BookAppointmentDialog'
import { confirmationText } from '@/lib/messaging/appointments'
import { TemplatesDialog } from './TemplatesDialog'
import type { LoanProfile } from '@/lib/api/types'
import { formatPhone } from '@/lib/pipeline/helpers'
import { MAX_TEXT_LENGTH } from '../../../supabase/functions/ghl/sendRules'
import { TONE_CLASS } from './tone'
import { useSendPlan } from './useSendPlan'
import { useFileRole } from '@/lib/api/fileRole'
import { usePortalLinks } from '@/lib/api/portal'
import { useTeamAccess } from '@/lib/api/team'
import { useAuth } from '@/lib/auth/context'
import { LINK_BAR, resolveTags, TAGS, tagsIn, tagValues } from '@/lib/messaging/mergeTags'
import { applicationLinkFor } from '@/lib/team/secondaryRoles'
import { TagEditor, type TagEditorHandle } from './TagEditor'

const newKey = () => crypto.randomUUID()

/**
 * Write and send one text or email through GHL. What's in the way (consent,
 * opt-out, sending hours, test mode, the LO's number) shows before you click,
 * from the same rules the server checks again on send.
 */
export function Composer({ loan, people }: { loan: LoanProfile; people: FilePerson[] }) {
  // A file's processor drafts for the loan officer (Connor, 2026-11-16): nothing sends, so sending hours don't apply yet.
  const fileRole = useFileRole(loan.id)
  const drafting = fileRole.role === 'processor'
  const approver = fileRole.loName ?? 'the loan officer'
  // The file's LO Assistant sends from their own GHL number (Connor, 2026-11-17); merge tags fill from the FILE's loan officer.
  const asLoa = fileRole.role === 'loa'
  const { state } = useAuth()
  const meId = state.status === 'signedIn' ? state.user.id : null
  const team = useTeamAccess()
  const meMember = team.data?.members.find((m) => m.id === meId) ?? null
  const loMember = team.data?.members.find((m) => m.id === loan.assignedLo?.id) ?? null
  const rules = useSendPlan(loan, asLoa && meId ? { id: meId, name: meMember?.name ?? (state.status === 'signedIn' ? state.user.fullName : 'You') } : null)
  const portalLinks = usePortalLinks(loan.id)
  const editor = useRef<TagEditorHandle>(null)
  // "Suggest a reply" (Connor, 2026-11-16): the AI writes only when asked, into this box.
  const ai = useAiStatus()
  const [suggesting, setSuggesting] = useState(false)
  // Translate (Connor, 2026-11-18): swaps the typed text for Spanish in the box; sending is still the click below.
  const [translating, setTranslating] = useState(false)
  const [beforeTranslation, setBeforeTranslation] = useState<{ english: string; spanish: string } | null>(null)
  const send = useSendMessage()
  const schedule = useScheduleMessage()
  const [scheduling, setScheduling] = useState(false)
  // Book appointment (Connor, 2026-11-18): the file's LO or an admin, on the LO's GHL calendar.
  const canBook = fileRole.role === 'lo' || fileRole.role === 'admin'
  const [booking, setBooking] = useState(false)
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
  // Merge tags, filled for this person on this file; anything that can't be filled blocks Send.
  const now = Date.now()
  const uploadLink = portalLinks.data?.find((l) => l.contactId === person.id && new Date(l.expiresAt).getTime() > now)?.url ?? null
  const values = tagValues({
    borrowerFirst: person.firstName,
    sender: meMember,
    lo: loMember ? { ...loMember, applicationLink: applicationLinkFor(loMember) } : loan.assignedLo ? { fullName: loan.assignedLo.name } : null,
    documentUploadLink: uploadLink,
  })
  const filled = resolveTags(body, values)
  const filledSubject = resolveTags(subject, values)
  const missing = [...new Set([...filled.missing, ...(channel === 'email' ? filledSubject.missing : [])])]
  const hasTags = tagsIn(body).length > 0 || (channel === 'email' && tagsIn(subject).length > 0)
  const sendPlan = rules.plan(person, channel, filled.text, filledSubject.text)
  const base = drafting ? { ...sendPlan, problems: sendPlan.problems.filter((p) => p === 'Write a message first.' || p === 'An email needs a subject.') } : sendPlan
  const plan = { ...base, problems: [...base.problems, ...(missing.length ? [`Missing: ${missing.join(', ')}`] : [])] }
  const window = rules.window
  // "Write a message first" and the subject aren't worth a warning before you've typed.
  const blockers = plan.problems.filter((p) => !(p === 'Write a message first.' || (p === 'An email needs a subject.' && !body.trim())))
  const to = channel === 'text' ? (person.phone ? formatPhone(person.phone) : 'no mobile') : (person.email ?? 'no email')
  const from =
    channel === 'text'
      ? plan.fromNumber
        ? `${rules.fromName} · ${formatPhone(plan.fromNumber)}${asLoa ? ` · LO Assistant for ${rules.loName ?? 'the loan officer'}` : ''}`
        : '—'
      : `${plan.fromEmail ?? '—'}${asLoa && plan.fromEmail ? ` · LO Assistant for ${rules.loName ?? 'the loan officer'}` : ''}`
  const loFirst = (rules.loName ?? 'the loan officer').split(/\s+/)[0]

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
      { contactId: person.id, loanId: loan.id, channel, body: filled.text, subject: channel === 'email' ? filledSubject.text : null, idempotencyKey: key },
      {
        onSuccess: (r) => {
          if (r.alreadySent) toast.info(r.error ? `That message already failed: ${r.error}` : 'That message was already sent.')
          else toast.success(sentOrDrafted(r, `${channel === 'text' ? 'Text' : 'Email'} sent to ${person.firstName}`))
          setBody('')
          setSubject('')
          setBeforeTranslation(null)
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

  const translate = async () => {
    if (!body.trim()) return toast.error('Write the message first.')
    setTranslating(true)
    try {
      const spanish = await translateText({ loanId: loan.id, text: body })
      setBeforeTranslation({ english: body, spanish })
      setBody(spanish)
      toast.success('Translated to Spanish. Read it over before you send it.')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setTranslating(false)
    }
  }

  const undoTranslation = async () => {
    if (!beforeTranslation) return
    if (body !== beforeTranslation.spanish && !(await confirmAction('Go back to your English? Changes you made to the Spanish will be lost.', { confirmLabel: 'Back to English' }))) return
    setBody(beforeTranslation.english)
    setBeforeTranslation(null)
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
        {canBook && (
          <Button size="xs" variant="outline" onClick={() => setBooking(true)} title={`Book a time on ${loFirst}'s GHL calendar for ${person.firstName}. A confirmation text is put in the box for you to send.`}>
            <CalendarPlusIcon />
            Book appointment
          </Button>
        )}
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
        {ai.data?.ready && channel === 'text' && (
          <Button size="xs" variant="outline" onClick={() => void translate()} disabled={translating || !body.trim()} title="Replace what you wrote with Spanish, to read over before you send. Nothing is sent.">
            <LanguagesIcon />
            {translating ? 'Translating…' : 'Translate to Spanish'}
          </Button>
        )}
      </div>
      {channel === 'email' && <Input label="Subject" hideLabel placeholder="Subject" value={subject} onChange={setSubject} />}
      <div className="@container">
        <div className={cn('gap-4', body.trim() && '@3xl:grid @3xl:grid-cols-[minmax(0,1fr)_18rem]')}>
          <div className="space-y-2">
            <TagEditor ref={editor} label="Message" value={body} onChange={setBody} placeholder={`Write a ${channel === 'text' ? 'text' : 'email'} to ${person.firstName}…`} rows={channel === 'text' ? 3 : 6} />
            {beforeTranslation && body.trim() && (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <LanguagesIcon className="size-3" />
                Translated to Spanish.
                <button type="button" className="font-medium text-primary hover:underline" onClick={() => void undoTranslation()}>
                  Back to my English
                </button>
              </p>
            )}
            {/* Insert link bar (Connor, 2026-11-17): chips that fill from the file's loan officer at send time. */}
            <div>
              <p className="text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">Insert link · resolves to the file's loan officer ({rules.loName ?? 'none yet'}){asLoa ? ', not you' : ''}</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {LINK_BAR.map((b) => (
                  <Button key={b.key} type="button" size="xs" variant="outline" onClick={() => editor.current?.insertTag(b.key)}>
                    <LinkIcon />
                    {b.label}
                  </Button>
                ))}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" size="xs" variant="ghost">
                      More fields…
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    {TAGS.filter((t) => !t.link).map((t) => (
                      <DropdownMenuItem key={t.key} onSelect={() => editor.current?.insertTag(t.key)}>
                        {t.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </div>
          {body.trim() && (
            <div className="mt-3 rounded-lg border bg-muted/40 p-3 text-sm @3xl:mt-0">
              <p className="text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">Preview · what {person.firstName} receives</p>
              <p className="mt-1 text-xs text-muted-foreground">From {channel === 'text' ? (plan.fromNumber ? formatPhone(plan.fromNumber) : '—') : (plan.fromEmail ?? '—')}</p>
              {channel === 'email' && filledSubject.text.trim() && <p className="mt-2 font-medium">{filledSubject.text}</p>}
              <p className="mt-2 break-words whitespace-pre-wrap">{filled.text}</p>
              {hasTags && (
                <p className={cn('mt-2 text-xs', missing.length ? 'text-destructive' : 'text-emerald-700')}>
                  {missing.length ? `! Missing: ${missing.join(', ')}. Send is blocked until it's filled.` : `✓ Every field filled${loMember ? ` from ${loFirst}'s profile` : ''}`}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
      {asLoa && <p className="text-xs text-muted-foreground">Replies to your number show on this file and in {loFirst}'s inbox and yours.</p>}
      {blockers.length > 0 && (
        <ul className="space-y-1 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground tabular-nums">
          {channel === 'text' ? `${filled.text.trim().length} / ${MAX_TEXT_LENGTH}` : 'Sent as plain text'}
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
            {drafting ? (send.isPending ? 'Saving…' : `Save for ${approver} to approve`) : send.isPending ? 'Sending…' : asLoa ? (channel === 'text' ? 'Send from my number' : 'Send email') : channel === 'text' ? 'Send text' : 'Send email'}
          </Button>
        </div>
      </div>
      {booking && (
        <BookAppointmentDialog
          loanId={loan.id}
          person={{ id: person.id, firstName: person.firstName }}
          loName={rules.loName ?? 'the loan officer'}
          onClose={() => setBooking(false)}
          onBooked={(r, minutes) => {
            setBooking(false)
            const text = confirmationText({ borrowerFirst: person.firstName, loFirst, start: r.start, minutes, bookedByLo: meId === loan.assignedLo?.id })
            // The confirmation goes in the box as a text; it's sent only with the usual click.
            if (!body.trim()) {
              setChannel('text')
              setBody(text)
              setBeforeTranslation(null)
            } else {
              void confirmAction('Replace what you wrote with the booking confirmation text?', { confirmLabel: 'Replace' }).then((ok) => {
                if (!ok) return
                setChannel('text')
                setBody(text)
                setBeforeTranslation(null)
              })
            }
          }}
        />
      )}
      {templating && (
        <TemplatesDialog
          channel={channel}
          borrowerFirst={person.firstName}
          loName={rules.loName}
          loId={loan.assignedLo?.id ?? null}
          asLoa={asLoa}
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
              { contactId: person.id, loanId: loan.id, channel, body: filled.text, subject: channel === 'email' ? filledSubject.text : null, idempotencyKey: key, sendAt },
              {
                onSuccess: () => {
                  toast.success(`Scheduled for ${scheduleLabel(sendAt)}`)
                  setScheduling(false)
                  setBeforeTranslation(null)
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
