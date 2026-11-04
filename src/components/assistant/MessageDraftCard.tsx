import { useState } from 'react'
import { MailIcon, MessageSquareIcon, PaperclipIcon, PencilIcon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { confirmAction, Input, TextArea, ToggleChip } from '@/components/shared'
import { TONE_CLASS } from '@/components/messages/tone'
import { useSendPlan } from '@/components/messages/useSendPlan'
import { useEstimateData } from '@/components/estimates/useEstimateData'
import { useEstimatePdf } from '@/components/estimates/useEstimatePdf'
import { useLoan } from '@/lib/api/loans'
import { useFilePeople, useSendMessage, type FilePerson } from '@/lib/api/messages'
import type { LoanProfile } from '@/lib/api/types'
import { useActionStatuses, useMarkAction } from '@/lib/assistant/chat'
import type { AssistantCard } from '@/lib/assistant/cards'
import { hasLink } from '@/lib/assistant/sendTools'
import { formatPhone } from '@/lib/pipeline/helpers'

type MessageCard = Extract<AssistantCard, { type: 'message' }>

/**
 * A message the assistant drafted: who it's to, from which number or email,
 * the words, any Fee Estimate PDFs and the heads-up text. Nothing goes out
 * until Send, which runs the same approval send path (and the same checks:
 * consent, opt-outs, sending hours, test mode, the LO's number) as the
 * Messages tab. Edit changes the words first.
 */
export function MessageDraftCard({ card }: { card: MessageCard }) {
  const loan = useLoan(card.loanId)
  const people = useFilePeople(card.loanId)
  const person = people.data?.find((p) => p.id === card.contactId)
  if (loan.error || people.error) return <p className="text-sm text-destructive">{(loan.error ?? people.error)?.message}</p>
  if (!loan.data || !people.data) return <p className="text-sm text-muted-foreground">Loading the draft…</p>
  if (!person) return <p className="text-sm text-destructive">{card.name} is no longer on this file, so this draft can't be sent.</p>
  return card.estimates.length ? <WithPdfs card={card} loan={loan.data} person={person} /> : <DraftView card={card} loan={loan.data} person={person} makePdfs={null} />
}

/** Loads the Estimate tool's data only when Fee Estimate PDFs are attached. */
function WithPdfs({ card, loan, person }: { card: MessageCard; loan: LoanProfile; person: FilePerson }) {
  const data = useEstimateData(loan)
  const pdf = useEstimatePdf(loan, data)
  const makePdfs = async (): Promise<string[] | null> => {
    const ids: string[] = []
    for (const a of card.estimates) {
      const e = data.list.find((x) => x.id === a.id)
      if (!e) {
        toast.error(`${a.name} is no longer on this file.`)
        return null
      }
      const id = await pdf.save(e)
      if (!id) return null
      ids.push(id)
    }
    return ids
  }
  return <DraftView card={card} loan={loan} person={person} makePdfs={data.loading || !pdf.ready ? 'loading' : makePdfs} />
}

function DraftView({ card, loan, person, makePdfs }: { card: MessageCard; loan: LoanProfile; person: FilePerson; makePdfs: null | 'loading' | (() => Promise<string[] | null>) }) {
  const rules = useSendPlan(loan)
  const send = useSendMessage()
  const statuses = useActionStatuses(card.actionId ? [card.actionId] : [])
  const mark = useMarkAction()
  const [editing, setEditing] = useState(false)
  const [subject, setSubject] = useState(card.subject ?? '')
  const [body, setBody] = useState(card.body)
  const [headsUp, setHeadsUp] = useState(card.headsUp ?? '')
  const [withHeadsUp, setWithHeadsUp] = useState(!!card.headsUp)
  const [busy, setBusy] = useState(false)
  // One key per message, so a double tap or retry can't send it twice.
  const [keys] = useState(() => ({ main: `assistant:${card.actionId ?? crypto.randomUUID()}:main`, text: `assistant:${card.actionId ?? crypto.randomUUID()}:text` }))
  const status = card.actionId ? statuses.data?.get(card.actionId) : undefined

  if (!rules) return <p className="text-sm text-muted-foreground">Loading the draft…</p>
  const isEmail = card.channel === 'email'
  const plan = rules.plan(person, card.channel, body, isEmail ? subject : null)
  const textPlan = rules.plan(person, 'text', headsUp, null)
  const textOk = withHeadsUp && headsUp.trim() && textPlan.problems.length === 0 && !hasLink(headsUp)
  const to = isEmail ? (person.email ?? 'no email') : person.phone ? formatPhone(person.phone) : 'no mobile'
  const from = isEmail ? (plan.fromEmail ?? '—') : plan.fromNumber ? `${rules.loName ?? 'Loan officer'} · ${formatPhone(plan.fromNumber)}` : '—'
  const linkInText = !isEmail && hasLink(body)
  const problems = [...plan.problems.filter((p) => !(p === 'Write a message first.' && body.trim())), ...(linkInText ? ['Texts never carry links. Take the link out.'] : [])]
  const sent = status === 'sent'

  const submit = async () => {
    if (problems.length) return toast.error(problems[0])
    const attach = card.estimates.length ? ` with ${card.estimates.length === 1 ? 'the Fee Estimate PDF' : `${card.estimates.length} Fee Estimate PDFs`}` : ''
    const also = isEmail && textOk ? ', and a heads-up text' : ''
    if (!(await confirmAction(`Send this ${isEmail ? 'email' : 'text'} to ${person.firstName} at ${to}${attach}${also}? It goes out through GHL from ${from}.`, { confirmLabel: isEmail ? 'Send email' : 'Send text' }))) return
    setBusy(true)
    try {
      let documentIds: string[] = []
      if (typeof makePdfs === 'function') {
        const ids = await makePdfs()
        if (!ids) return
        documentIds = ids
      }
      const r = await send.mutateAsync({ contactId: person.id, loanId: loan.id, channel: card.channel, body, subject: isEmail ? subject : null, idempotencyKey: keys.main, documentIds })
      if (r.alreadySent && r.error) throw new Error(`That message already failed: ${r.error}`)
      let textNote = ''
      if (isEmail && textOk) {
        try {
          await send.mutateAsync({ contactId: person.id, loanId: loan.id, channel: 'text', body: headsUp, subject: null, idempotencyKey: keys.text })
          textNote = ' and the heads-up text'
        } catch (e) {
          toast.error(`The email went, but the heads-up text didn't: ${(e as Error).message}`)
        }
      }
      if (card.actionId) mark.mutate({ id: card.actionId, status: 'sent', result: { channel: card.channel, subject: isEmail ? subject : null, body, documentIds, headsUp: textNote ? headsUp : null } })
      toast.success(`Sent to ${person.firstName}: the ${isEmail ? 'email' : 'text'}${textNote}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const Icon = isEmail ? MailIcon : MessageSquareIcon
  return (
    <div className="rounded-lg border bg-card p-3 shadow-soft">
      <p className="flex items-center gap-1.5 text-sm font-semibold">
        <Icon className="size-4 text-primary" />
        {sent ? `Sent to ${card.name}` : `${isEmail ? 'Email' : 'Text'} to ${card.name}`}
      </p>
      <dl className="mt-1.5 space-y-0.5 text-xs text-muted-foreground">
        <div>To: {to}</div>
        <div>From: {from}</div>
      </dl>
      {editing && !sent ? (
        <div className="mt-2 space-y-2">
          {isEmail && <Input label="Subject" value={subject} onChange={setSubject} />}
          <TextArea label="Message" value={body} onChange={setBody} rows={isEmail ? 8 : 4} />
        </div>
      ) : (
        <div className="mt-2 rounded-md bg-muted/50 p-2.5 text-sm">
          {isEmail && <p className="font-medium">{subject}</p>}
          <p className="whitespace-pre-wrap">{body}</p>
        </div>
      )}
      {card.estimates.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs">
          {card.estimates.map((e) => (
            <li key={e.id} className="flex items-center gap-1">
              <PaperclipIcon className="size-3 text-muted-foreground" />
              {e.name} (Fee Estimate PDF, saved to Documents when you send)
            </li>
          ))}
        </ul>
      )}
      {isEmail && (card.headsUp || editing) && !sent && (
        <div className="mt-2 space-y-1.5">
          <ToggleChip label="Also text a heads-up (no link)" pressed={withHeadsUp} onChange={setWithHeadsUp} />
          {withHeadsUp && (editing ? <TextArea label="Heads-up text" value={headsUp} onChange={setHeadsUp} rows={2} /> : <p className="rounded-md bg-muted/50 p-2 text-sm">{headsUp}</p>)}
          {withHeadsUp && headsUp.trim() && !textOk && <p className="text-xs text-amber-800">{hasLink(headsUp) ? 'The heads-up text has a link; texts never carry links.' : textPlan.problems[0]} The email can still go.</p>}
        </div>
      )}
      {!sent && problems.length > 0 && (
        <ul className="mt-2 space-y-0.5 rounded-md bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {sent ? (
        <p className={`mt-2 w-fit ${TONE_CLASS.ok}`}>Sent through GHL</p>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" onClick={submit} disabled={busy || send.isPending || problems.length > 0 || makePdfs === 'loading' || status === undefined && !!card.actionId && statuses.isPending}>
            <SendIcon />
            {busy ? 'Sending…' : isEmail ? 'Send email' : 'Send text'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing((e) => !e)} disabled={busy}>
            <PencilIcon />
            {editing ? 'Done editing' : 'Edit'}
          </Button>
        </div>
      )}
    </div>
  )
}
