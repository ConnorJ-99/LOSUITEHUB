import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MailIcon, MessageSquareIcon, PencilIcon, SendIcon, UsersIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { confirmAction, Input, TextArea } from '@/components/shared'
import { TONE_CLASS } from '@/components/messages/tone'
import { db, unwrap } from '@/lib/api/client'
import { useGhlLinks, useMessagingSettings } from '@/lib/api/ghl'
import { useActionStatuses, useMarkAction } from '@/lib/assistant/chat'
import type { AssistantCard } from '@/lib/assistant/cards'
import { EXCLUDE_LABEL, mergeFirstName, withOptOut, type ExcludeReason } from '@/lib/assistant/filters'
import { hasLink } from '@/lib/assistant/sendTools'
import { useAuth } from '@/lib/auth/context'
import { planBatches, scheduleLabel } from '@/lib/messaging/schedule'
import { formatPhone } from '@/lib/pipeline/helpers'
import { hasTestName, sendWindow } from '../../../supabase/functions/ghl/sendRules'

type BulkCardData = Extract<AssistantCard, { type: 'bulk' }>
const PER_MINUTE = 20

/** How far a bulk send has got: sent, still waiting, or didn't go (with the reasons). */
function useBulkProgress(actionId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['assistant', 'bulk', actionId],
    enabled: enabled && !!actionId,
    refetchInterval: 30_000,
    queryFn: async () => {
      const rows = unwrap<{ used_at: string | null; voided_at: string | null }[]>(await db().from('send_approvals').select('used_at, voided_at').like('client_key', `bulk:${actionId}:%`))
      return { total: rows.length, sent: rows.filter((r) => r.used_at).length, stopped: rows.filter((r) => r.voided_at).length }
    },
  })
}

/**
 * A message to many clients. Shows the exact count, who's left out and why,
 * the number it goes from, the pacing and today's cap. "Send to N clients"
 * schedules one approval per person (each still checked when it goes: consent,
 * opt-outs, sending hours, test mode), 20 a minute, through the every-minute
 * timer. Nothing goes before that tap.
 */
export function BulkCard({ card }: { card: BulkCardData }) {
  const { state } = useAuth()
  const me = state.status === 'signedIn' ? state.user.id : null
  const settings = useMessagingSettings()
  const links = useGhlLinks()
  const used = useQuery({ queryKey: ['assistant', 'bulkToday'], queryFn: async () => unwrap<number>(await db().rpc('bulk_approved_today')) })
  const statuses = useActionStatuses(card.actionId ? [card.actionId] : [])
  const mark = useMarkAction()
  const status = card.actionId ? statuses.data?.get(card.actionId) : undefined
  const sent = status === 'sent'
  const progress = useBulkProgress(card.actionId, sent)
  const [editing, setEditing] = useState(false)
  const [subject, setSubject] = useState(card.subject ?? '')
  const [body, setBody] = useState(card.body)
  const [showList, setShowList] = useState(false)
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null)

  const s = settings.data
  const isEmail = card.channel === 'email'
  const link = links.data?.find((l) => l.profileId === me)
  const from = isEmail ? (s?.emailDomainVerified && link?.ghlEmail ? link.ghlEmail : 'info@mps.mortgage') : link?.ghlNumber ? `Your GHL number · ${formatPhone(link.ghlNumber)}` : 'not linked yet'
  // Test mode only ever sends to people named TEST, so the others are left out here too.
  const testMode = s?.testMode ?? true
  const recipients = testMode ? card.recipients.filter((r) => hasTestName(r.name, null)) : card.recipients
  const testOut = card.recipients.length - recipients.length
  const counts = (Object.keys(EXCLUDE_LABEL) as ExcludeReason[]).map((r) => [r, card.excluded.filter((x) => x.reason === r).length] as const).filter(([, n]) => n > 0)
  const cap = s?.bulkDailyCap ?? 250
  const left = Math.max(0, cap - (used.data ?? 0))
  const n = recipients.length
  const minutes = Math.ceil(n / PER_MINUTE)
  const finalBody = isEmail ? body : withOptOut(body)
  const problems = [
    !n ? 'Nobody to send to.' : null,
    n > left ? `Over today's limit: ${left} of ${cap} left today (Settings → Sending).` : null,
    !isEmail && !link?.ghlNumber ? "Your GHL number isn't linked (Settings → GoHighLevel)." : null,
    !isEmail && hasLink(body) ? 'Texts never carry links.' : null,
    isEmail && !subject.trim() ? 'An email needs a subject.' : null,
    !body.trim() ? 'Write the message.' : null,
  ].filter((x): x is string => !!x)

  const send = async () => {
    if (!s || !card.actionId) return
    if (problems.length) return toast.error(problems[0])
    const slots = planBatches(n, new Date(), (at) => sendWindow(s.sendHours, at).open, PER_MINUTE)
    if (!slots) return toast.error('No sending hours in the next week to fit these in (Settings → Sending).')
    const ok = await confirmAction(
      `Send this ${isEmail ? 'email' : 'text'} to ${n} client${n === 1 ? '' : 's'}? It goes ${PER_MINUTE} a minute from ${from}, starting ${scheduleLabel(slots[0])}${minutes > 1 ? `, over about ${minutes} minutes of sending hours` : ''}. Each one still checks consent, opt-outs and sending hours when it goes.`,
      { confirmLabel: `Send to ${n} client${n === 1 ? '' : 's'}` },
    )
    if (!ok) return
    setBusy({ done: 0, total: n })
    let done = 0
    try {
      for (let i = 0; i < n; i++) {
        const r = recipients[i]
        unwrap(
          await db().rpc('approve_send', {
            p_loan_id: r.loanId,
            p_contact_id: r.contactId,
            p_channel: card.channel,
            p_subject: isEmail ? subject : null,
            p_body: mergeFirstName(finalBody, r.firstName),
            p_document_ids: [],
            p_client_key: `bulk:${card.actionId}:${r.contactId}`,
            p_send_at: slots[i].toISOString(),
          }),
        )
        done++
        if (done % 5 === 0 || done === n) setBusy({ done, total: n })
      }
      toast.success(`Scheduled all ${n}. They go ${PER_MINUTE} a minute from ${scheduleLabel(slots[0])}.`)
    } catch (e) {
      toast.error(`Scheduled ${done} of ${n}, then stopped: ${(e as Error).message}`)
    } finally {
      mark.mutate({ id: card.actionId, status: 'sent', result: { scheduled: done, of: n, channel: card.channel, subject: isEmail ? subject : null, body: finalBody, from: slots[0].toISOString() } })
      used.refetch()
      setBusy(null)
    }
  }

  const Icon = isEmail ? MailIcon : MessageSquareIcon
  return (
    <div className="space-y-2 rounded-lg border bg-card p-3 shadow-soft">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="size-4 text-primary" />
        {isEmail ? 'Email' : 'Text'} to {card.segmentLabel.toLowerCase()}
      </p>
      {editing && !sent ? (
        <div className="space-y-2">
          {isEmail && <Input label="Subject" value={subject} onChange={setSubject} />}
          <TextArea label="Message ({first name} is filled in for each person)" value={body} onChange={setBody} rows={isEmail ? 8 : 4} />
        </div>
      ) : (
        <div className="rounded-md bg-muted/50 p-2.5 text-sm">
          {isEmail && <p className="font-medium">{subject}</p>}
          <p className="whitespace-pre-wrap">{finalBody}</p>
        </div>
      )}
      <dl className="space-y-1 border-t pt-2 text-sm">
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Recipients</dt>
          <dd className="font-semibold tabular-nums">{n} client{n === 1 ? '' : 's'}</dd>
        </div>
        {counts.map(([r, k]) => (
          <div key={r} className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Left out: {EXCLUDE_LABEL[r]}</dt>
            <dd className="tabular-nums">{k}</dd>
          </div>
        ))}
        {testOut > 0 && (
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">Left out: test mode (TEST names only)</dt>
            <dd className="tabular-nums">{testOut}</dd>
          </div>
        )}
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Sends from</dt>
          <dd className="text-right">{from}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Pacing</dt>
          <dd className="text-right">
            {PER_MINUTE} a minute{n > PER_MINUTE ? ` · about ${minutes} minutes` : ''}, in sending hours
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">Today's limit</dt>
          <dd className="tabular-nums">
            {left} of {cap} left
          </dd>
        </div>
      </dl>
      {showList && (
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-2 text-xs">
          {recipients.map((r) => (
            <p key={r.contactId}>{r.name}</p>
          ))}
          {card.excluded.length > 0 && <p className="pt-1 font-medium text-muted-foreground">Left out</p>}
          {card.excluded.map((x) => (
            <p key={x.name} className="text-muted-foreground">
              {x.name} · {EXCLUDE_LABEL[x.reason]}
            </p>
          ))}
        </div>
      )}
      {!sent && problems.length > 0 && n > 0 && (
        <ul className="space-y-0.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {sent ? (
        <p className={`w-fit ${TONE_CLASS.ok}`}>
          {progress.data ? `Scheduled ${progress.data.total}: ${progress.data.sent} sent${progress.data.stopped ? `, ${progress.data.stopped} didn't go (see Today → Scheduled)` : ''}` : 'Scheduled'}
        </p>
      ) : (
        <div className="space-y-2">
          <Button className="w-full" onClick={send} disabled={!!busy || problems.length > 0 || !card.actionId || !s}>
            <SendIcon />
            {busy ? `Scheduling ${busy.done} of ${busy.total}…` : `Send to ${n} client${n === 1 ? '' : 's'}`}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => setEditing((e) => !e)} disabled={!!busy}>
              <PencilIcon />
              {editing ? 'Done editing' : 'Edit message'}
            </Button>
            <Button variant="outline" onClick={() => setShowList((v) => !v)}>
              <UsersIcon />
              {showList ? 'Hide list' : 'See list'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
