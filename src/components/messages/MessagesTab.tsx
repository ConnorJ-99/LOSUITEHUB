import { useEffect, useState } from 'react'
import { MailIcon, MessageSquareIcon, RefreshCwIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, TextArea } from '@/components/shared'
import { EditDialog } from '@/components/urla/parts'
import { useGhlLinks, useGhlStatus } from '@/lib/api/ghl'
import {
  MATCHED_BY_LABEL,
  useCheckNewMessages,
  useConsentHistory,
  useFilePeople,
  useMarkRead,
  useRecordConsent,
  useRestoreConsent,
  useThread,
  type FilePerson,
  type Message,
} from '@/lib/api/messages'
import type { LoanProfile } from '@/lib/api/types'
import { useAuth } from '@/lib/auth/context'
import { relativeTime } from '@/lib/dates'
import { consentChip, dayLabel, groupByDay, sharedPhoneIds, timeOfDay } from '@/lib/messaging/thread'
import { formatPhone } from '@/lib/pipeline/helpers'
import { Composer } from './Composer'
import { TONE_CLASS } from './tone'

type Filter = 'all' | 'text' | 'email'

/** Owners and admins can ask GHL for anything new; the result says what came in. */
export function CheckNewMessagesButton({ size = 'sm' }: { size?: 'sm' | 'default' }) {
  const check = useCheckNewMessages()
  const run = () =>
    check.mutate(undefined, {
      onSuccess: (r) => {
        const parts = [`${r.saved} new message${r.saved === 1 ? '' : 's'}`]
        if (r.needsMatching) parts.push(`${r.needsMatching} need matching`)
        if (r.optOuts) parts.push(`${r.optOuts} opt-out${r.optOuts === 1 ? '' : 's'}`)
        if (r.mode === 'test_only' && r.skippedNotTest) parts.push(`${r.skippedNotTest} skipped (test mode: TEST contacts only)`)
        if (r.failed) parts.push(`${r.failed} couldn't be read`)
        toast.success(parts.join(' · '))
        if (r.logError) toast.warning(r.logError)
      },
      onError: (e) => toast.error(e.message),
    })
  return (
    <Button size={size} variant="outline" disabled={check.isPending} onClick={run}>
      <RefreshCwIcon className={check.isPending ? 'animate-spin' : undefined} />
      {check.isPending ? 'Checking GHL…' : 'Check for new messages'}
    </Button>
  )
}

function Bubble({ m, who, isNew }: { m: Message; who: string | null; isNew: boolean }) {
  const inbound = m.direction === 'inbound'
  const meta = [m.channel === 'text' ? 'Text' : 'Email', timeOfDay(m.sentAt), who && (inbound ? `from ${who}` : `to ${who}`), !inbound && m.status ? m.status : null].filter(Boolean).join(' · ')
  return (
    <div className={cn('flex flex-col', inbound ? 'items-start' : 'items-end')}>
      <div
        className={cn(
          'max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm whitespace-pre-wrap break-words',
          inbound ? 'bg-muted' : 'border border-primary/15 bg-primary/5',
          m.channel === 'email' && 'w-full max-w-[85%] bg-card ring-1 ring-border',
        )}
      >
        {m.channel === 'email' && (
          <>
            <p className="text-xs text-muted-foreground">{[m.fromAddress, m.toAddress && `→ ${m.toAddress}`].filter(Boolean).join(' ') || 'Email'}</p>
            {m.subject && <p className="mt-0.5 font-semibold">{m.subject}</p>}
          </>
        )}
        <p className={m.channel === 'email' ? 'mt-1.5 text-muted-foreground' : undefined}>{m.body || <span className="italic text-muted-foreground">(no text)</span>}</p>
      </div>
      <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
        {m.channel === 'text' ? <MessageSquareIcon className="size-3" /> : <MailIcon className="size-3" />}
        {meta}
        {isNew && <span className="font-medium text-primary">· New</span>}
      </p>
    </div>
  )
}

/** Records consent, or restores it after an opt-out. Either way a person writes how they agreed, and it's kept. */
function ConsentDialog({ person, channel, mode, onClose }: { person: FilePerson; channel: 'text' | 'email'; mode: 'record' | 'restore'; onClose: () => void }) {
  const restore = useRestoreConsent()
  const record = useRecordConsent()
  const [note, setNote] = useState('')
  const what = channel === 'text' ? 'texts' : 'email'
  const save = () =>
    (mode === 'restore' ? restore : record).mutate(
      { contactId: person.id, channel, note },
      {
        onSuccess: () => {
          toast.success(mode === 'restore' ? `${channel === 'text' ? 'Texting' : 'Email'} turned back on for ${person.firstName}` : `${person.firstName}'s consent to ${what} is recorded`)
          onClose()
        },
        onError: (e) => toast.error(e.message),
      },
    )
  return (
    <EditDialog
      title={mode === 'restore' ? `Turn ${channel === 'text' ? 'texting' : 'email'} back on for ${person.firstName}?` : `Record ${person.firstName}'s consent to ${what}`}
      description={
        mode === 'restore'
          ? `${person.firstName} opted out. Only turn it back on if they asked to hear from you again. The note is kept in their consent history.`
          : `Only if ${person.firstName} agreed to get ${what} from MPS Mortgage. The note is kept in their consent history.`
      }
      open
      onOpenChange={(o) => !o && onClose()}
      onSubmit={save}
      saving={restore.isPending || record.isPending}
      submitLabel={mode === 'restore' ? 'Turn back on' : 'Record consent'}
    >
      <TextArea
        label={mode === 'restore' ? 'How did they agree again?' : 'How did they agree?'}
        required
        value={note}
        onChange={setNote}
        placeholder={mode === 'restore' ? 'e.g. "Texted START on 11/2" or "Asked on our call 11/2 to text again"' : 'e.g. "Said yes to texts on our call 10/29" or "Checked the box on the website form"'}
      />
    </EditDialog>
  )
}

const SOURCE_LABEL = { stop_reply: 'replied STOP', ghl_dnd: 'Do Not Disturb in GHL', person: 'by a person' } as const

function ContactConsentCard({ people }: { people: FilePerson[] }) {
  const history = useConsentHistory(people.map((p) => p.id))
  const shared = sharedPhoneIds(people)
  const [editing, setEditing] = useState<{ person: FilePerson; channel: 'text' | 'email'; mode: 'record' | 'restore' } | null>(null)

  return (
    <Card title="Contact & consent">
      <div className="space-y-4">
        {people.map((p) => {
          const text = consentChip('text', p.smsConsent, p.smsOptedOutAt)
          const email = consentChip('email', p.emailConsent, p.emailOptedOutAt)
          const events = (history.data ?? []).filter((e) => e.contactId === p.id).slice(0, 3)
          return (
            <div key={p.id} className="space-y-1.5 text-sm">
              {people.length > 1 && (
                <p className="font-medium">
                  {p.firstName} {p.lastName}
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">{p.role === 'primary' ? 'Borrower' : 'Co-borrower'}</span>
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <span className="text-muted-foreground">Mobile </span>
                  {p.phone ? formatPhone(p.phone) : '—'}
                </span>
                <span className="flex items-center gap-1.5">
                  {shared.has(p.id) && <span className={TONE_CLASS.warn}>Shared phone</span>}
                  <span className={TONE_CLASS[text.tone]}>{text.label}</span>
                </span>
              </div>
              {p.smsOptedOutAt ? (
                <Button size="sm" variant="outline" onClick={() => setEditing({ person: p, channel: 'text', mode: 'restore' })}>
                  Restore texting…
                </Button>
              ) : (
                p.smsConsent !== true && (
                  <Button size="sm" variant="outline" onClick={() => setEditing({ person: p, channel: 'text', mode: 'record' })}>
                    Record text consent…
                  </Button>
                )
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="min-w-0 break-all">
                  <span className="text-muted-foreground">Email </span>
                  {p.email ?? '—'}
                </span>
                <span className={TONE_CLASS[email.tone]}>{email.label}</span>
              </div>
              {p.emailOptedOutAt ? (
                <Button size="sm" variant="outline" onClick={() => setEditing({ person: p, channel: 'email', mode: 'restore' })}>
                  Restore email…
                </Button>
              ) : (
                p.emailConsent !== true && (
                  <Button size="sm" variant="outline" onClick={() => setEditing({ person: p, channel: 'email', mode: 'record' })}>
                    Record email consent…
                  </Button>
                )
              )}
              {events.length > 0 && (
                <ul className="space-y-0.5 text-xs text-muted-foreground">
                  {events.map((e) => (
                    <li key={e.id}>
                      {relativeTime(e.createdAt)}: {e.channel === 'text' ? 'texting' : 'email'} {e.change === 'opted_out' ? `turned off (${SOURCE_LABEL[e.source]})` : `turned ${e.change === 'restored' ? 'back ' : ''}on: "${e.note}"`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
        {shared.size > 0 && <p className="text-xs text-muted-foreground">Texts from a shared number aren't matched to anyone automatically; an admin picks the right person.</p>}
      </div>
      {editing && <ConsentDialog person={editing.person} channel={editing.channel} mode={editing.mode} onClose={() => setEditing(null)} />}
    </Card>
  )
}

function GhlPanel({ loan, people, messages, canCheck }: { loan: LoanProfile; people: FilePerson[]; messages: Message[]; canCheck: boolean }) {
  const links = useGhlLinks()
  const lo = loan.assignedLo
  const link = lo ? links.data?.find((l) => l.profileId === lo.id) : undefined
  const last = messages.at(-1)
  return (
    <Card title="GoHighLevel">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        {people.map((p) => {
          const matched = [...messages].reverse().find((m) => m.contactId === p.id && m.matchedBy)
          return (
            <div key={p.id} className="contents">
              <dt className="text-muted-foreground">{people.length > 1 ? p.firstName : 'Status'}</dt>
              <dd>
                {p.ghlContactId ? <span className={TONE_CLASS.ok}>Linked</span> : <span className={TONE_CLASS.warn}>Not linked yet</span>}
                {matched?.matchedBy && <span className="ml-2 text-xs text-muted-foreground">matched by {MATCHED_BY_LABEL[matched.matchedBy].toLowerCase()}</span>}
              </dd>
            </div>
          )
        })}
        <dt className="text-muted-foreground">Texts from</dt>
        <dd>
          {!lo ? (
            <span className="text-amber-800">No loan officer on this file. Messages will wait for review.</span>
          ) : link?.numberConfirmedAt && link.ghlNumber ? (
            <>
              {formatPhone(link.ghlNumber)} <span className="text-xs text-muted-foreground">({lo.name})</span>
            </>
          ) : (
            <span className="text-amber-800">{lo.name} isn't linked to a confirmed GHL number yet (Settings → GoHighLevel).</span>
          )}
        </dd>
        <dt className="text-muted-foreground">Last message</dt>
        <dd>{last ? relativeTime(last.sentAt) : '—'}</dd>
      </dl>
      {!people.some((p) => p.ghlContactId) && <p className="mt-3 text-xs text-muted-foreground">A person is linked to their GHL contact the first time a message matches them by email or phone.</p>}
      {canCheck && (
        <div className="mt-3">
          <CheckNewMessagesButton />
        </div>
      )}
    </Card>
  )
}

/** The borrower's texts and emails from GHL in one thread, a composer to send through GHL, and consent and GHL status beside it. */
export function MessagesTab({ loan }: { loan: LoanProfile }) {
  const { state } = useAuth()
  const role = state.status === 'signedIn' ? state.user.role : null
  const canCheck = role === 'owner' || role === 'admin'
  const status = useGhlStatus()
  const people = useFilePeople(loan.id)
  const ids = (people.data ?? []).map((p) => p.id)
  const thread = useThread(ids)
  const { mutate: markMessagesRead } = useMarkRead()
  const [filter, setFilter] = useState<Filter>('all')

  const messages = thread.data ?? []
  // Opening the tab marks received messages read; the ones that were unread keep a "New" tag while you're here.
  const unreadKey = messages.filter((m) => m.direction === 'inbound' && !m.readAt).map((m) => m.id).join(',')
  const [newIds, setNewIds] = useState<Set<string>>(new Set())
  const idsKey = ids.join(',')
  useEffect(() => {
    if (!unreadKey) return
    markMessagesRead(idsKey.split(','), { onSuccess: () => setNewIds((prev) => new Set([...prev, ...unreadKey.split(',')])) })
  }, [unreadKey, idsKey, markMessagesRead])

  const nameOf = (id: string | null) => {
    if (!id || ids.length < 2) return null
    return people.data?.find((p) => p.id === id)?.firstName ?? null
  }
  const shown = messages.filter((m) => filter === 'all' || m.channel === filter)
  const first = people.data?.[0]?.firstName ?? 'the borrower'

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <Card
        title={`Conversation with ${first}`}
        description="Texts and emails together, from the MPS Mortgage GHL sub-account."
        action={
          <div className="flex rounded-lg bg-muted p-0.5 text-sm">
            {(['all', 'text', 'email'] as const).map((f) => (
              <button key={f} type="button" onClick={() => setFilter(f)} className={cn('rounded-md px-2.5 py-1', filter === f ? 'bg-card font-medium shadow-sm' : 'text-muted-foreground')}>
                {f === 'all' ? 'All' : f === 'text' ? 'Texts' : 'Email'}
              </button>
            ))}
          </div>
        }
      >
        {status.data && !status.data.ready && (
          <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">GHL isn't connected yet, so no new messages come in. Everything else on this file works as usual.</p>
        )}
        {thread.error || people.error ? (
          <p className="text-sm text-destructive">{(thread.error ?? people.error)?.message}</p>
        ) : thread.isPending && ids.length > 0 ? (
          <p className="text-sm text-muted-foreground">Loading messages…</p>
        ) : shown.length === 0 ? (
          <EmptyState
            icon={MessageSquareIcon}
            title={messages.length ? 'Nothing here with this filter' : 'No texts or emails yet'}
            description={messages.length ? undefined : `Texts and emails with ${first} through GHL show here once they come in.`}
          />
        ) : (
          <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
            {groupByDay(shown).map((g) => (
              <section key={g.label} className="space-y-3">
                <p className="mx-auto w-fit rounded-full bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">{g.label}</p>
                {g.messages.map((m) => (
                  <Bubble key={m.id} m={m} who={nameOf(m.contactId)} isNew={newIds.has(m.id) || (m.direction === 'inbound' && !m.readAt)} />
                ))}
              </section>
            ))}
          </div>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Times are Central{messages.length ? `; last message ${dayLabel(messages.at(-1)!.sentAt).toLowerCase()} at ${timeOfDay(messages.at(-1)!.sentAt)}` : ''}.
        </p>
        {people.data && people.data.length > 0 && <Composer loan={loan} people={people.data} />}
      </Card>
      <div className="space-y-4">
        {people.data && <ContactConsentCard people={people.data} />}
        {people.data && <GhlPanel loan={loan} people={people.data} messages={messages} canCheck={canCheck} />}
      </div>
    </div>
  )
}
