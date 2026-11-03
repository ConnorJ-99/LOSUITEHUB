import { useState } from 'react'
import { PaperclipIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { confirmAction, Input, TextArea, ToggleChip } from '@/components/shared'
import { EditDialog } from '@/components/urla/parts'
import { useLoanDocuments, type LoanDocument } from '@/lib/api/documents'
import { useFilePeople, useSendMessage, type FilePerson } from '@/lib/api/messages'
import { useQueueDraft } from '@/lib/api/queue'
import { useProfile } from '@/lib/api/settings'
import type { LoanProfile } from '@/lib/api/types'
import { useAuth } from '@/lib/auth/context'
import { prequalFollowUpText } from '@/lib/documents/prequalResults'
import { documentMessage, isSendableKind, type SendableKind } from '@/lib/messaging/documentMessages'
import { TONE_CLASS } from './tone'
import { useSendPlan } from './useSendPlan'

function Form({ loan, doc, people, onClose }: { loan: LoanProfile; doc: LoanDocument & { kind: SendableKind }; people: FilePerson[]; onClose: () => void }) {
  const rules = useSendPlan(loan)
  const send = useSendMessage()
  const [personId, setPersonId] = useState(people.find((p) => p.id === doc.contactId)?.id ?? people[0].id)
  const person = people.find((p) => p.id === personId) ?? people[0]
  const draft = (p: FilePerson) => documentMessage(doc.kind, p.firstName, rules?.loName ?? loan.assignedLo?.name ?? null)
  const [subject, setSubject] = useState(() => draft(person).subject)
  const [body, setBody] = useState(() => draft(person).body)
  // Prequal results get Connor's follow-up text in the Action Queue instead (decision 7).
  const isPrequal = doc.kind === 'prequal_results'
  const [alsoText, setAlsoText] = useState(!isPrequal)
  const { state } = useAuth()
  const lo = useProfile(loan.assignedLo?.id ?? (state.status === 'signedIn' ? state.user.id : null))
  const queueDraft = useQueueDraft(loan.id, loan.organizationId)
  const [text, setText] = useState(() => draft(person).text)
  // One key per message: a double click or retry can't send either one twice.
  const [keys] = useState(() => ({ email: crypto.randomUUID(), text: crypto.randomUUID() }))

  if (!rules) return <p className="text-sm text-muted-foreground">Loading…</p>
  const emailPlan = rules.plan(person, 'email', body, subject)
  const textPlan = rules.plan(person, 'text', text, null)
  const textBlocked = textPlan.problems.length > 0

  const pickPerson = (id: string) => {
    const p = people.find((x) => x.id === id) ?? people[0]
    setPersonId(p.id)
    // Re-greet the new person (edits to the wording are replaced).
    setSubject(draft(p).subject)
    setBody(draft(p).body)
    setText(draft(p).text)
  }

  const submit = async () => {
    if (emailPlan.problems.length) return toast.error(emailPlan.problems[0])
    const withText = alsoText && !textBlocked
    const ok = await confirmAction(
      `Email ${doc.fileName} to ${person.firstName} at ${emailPlan.to}${withText ? `, and text a heads-up to their mobile` : ''}? It goes out through GHL from ${emailPlan.fromEmail}.`,
      { confirmLabel: 'Send' },
    )
    if (!ok) return
    send.mutate(
      { contactId: person.id, loanId: loan.id, channel: 'email', body, subject, idempotencyKey: keys.email, documentIds: [doc.id] },
      {
        onSuccess: (r) => {
          if (r.alreadySent) toast.info(r.error ? `That email already failed: ${r.error}` : 'That email was already sent.')
          else {
            toast.success(`${doc.fileName} emailed to ${person.firstName}`)
            if (isPrequal) {
              const cell = lo.data?.personalCell ?? null
              // A promise, not mutate's callbacks: the dialog closes before it finishes.
              queueDraft
                .mutateAsync({ title: `Text ${person.firstName}: prequal results sent`, draft: { channel: 'text', to: `${person.firstName} ${person.lastName} (borrower)`, subject: null, body: prequalFollowUpText(person.firstName, cell) } })
                .then(() => toast.success(cell ? 'Follow-up text drafted in the Action Queue' : 'Follow-up text drafted in the Action Queue, without a personal cell: add yours in Settings → My profile'))
                .catch((e: Error) => toast.error(`The email went, but the follow-up text wasn't drafted: ${e.message}`))
            }
          }
          if (!withText) return onClose()
          send.mutate(
            { contactId: person.id, loanId: loan.id, channel: 'text', body: text, subject: null, idempotencyKey: keys.text },
            {
              onSuccess: () => toast.success(`Heads-up text sent to ${person.firstName}`),
              onError: (e) => toast.error(`The email went, but the text didn't: ${e.message}`),
              onSettled: onClose,
            },
          )
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  return (
    <EditDialog
      title={`Send ${doc.fileName}`}
      description="By email with the PDF attached, through GHL. The same checks as every send: consent, opt-outs, sending hours, and the loan officer's number."
      open
      onOpenChange={(o) => !o && onClose()}
      onSubmit={submit}
      saving={send.isPending}
      submitLabel={send.isPending ? 'Sending…' : 'Send'}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">To</span>
          {people.length > 1 ? (
            <select className="rounded-md border bg-card px-1.5 py-0.5" value={person.id} onChange={(e) => pickPerson(e.target.value)} aria-label="Send to">
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.firstName} {p.lastName}
                </option>
              ))}
            </select>
          ) : (
            <span>{person.firstName}</span>
          )}
          <span>· {person.email ?? 'no email'}</span>
          <span className="text-muted-foreground">from</span>
          <span>{emailPlan.fromEmail ?? '—'}</span>
          <span className={cn('ml-auto', rules.window.open ? TONE_CLASS.ok : TONE_CLASS.warn)}>{rules.window.label}</span>
        </div>
        <Input label="Subject" value={subject} onChange={setSubject} />
        <TextArea label="Email" value={body} onChange={setBody} rows={7} />
        <p className="flex items-center gap-1.5 text-sm">
          <PaperclipIcon className="size-4 text-muted-foreground" />
          {doc.fileName}
        </p>
        {emailPlan.problems.length > 0 && (
          <ul className="space-y-1 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {emailPlan.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <div className="space-y-2 border-t pt-3">
          <ToggleChip label="Also text a heads-up (no document or link)" pressed={alsoText && !textBlocked} onChange={setAlsoText} disabled={textBlocked} />
          {textBlocked ? (
            <p className="text-xs text-muted-foreground">No heads-up text: {textPlan.problems[0]}</p>
          ) : (
            alsoText && <TextArea label="Text" value={text} onChange={setText} rows={2} />
          )}
        </div>
      </div>
    </EditDialog>
  )
}

/** Sends a saved estimate or pre-approval letter to a borrower on the file. */
export function SendDocumentDialog({ loan, doc, onClose }: { loan: LoanProfile; doc: LoanDocument & { kind: SendableKind }; onClose: () => void }) {
  const people = useFilePeople(loan.id)
  if (!people.data?.length) return null
  return <Form loan={loan} doc={doc} people={people.data} onClose={onClose} />
}

/** The send dialog for a PDF just saved on the Fees, Pricing, Letters or Prequal tab ("Send…" on the saved toast). */
export function SendSavedPdf({ loan, docId, onClose }: { loan: LoanProfile; docId: string | null; onClose: () => void }) {
  const docs = useLoanDocuments(loan.id)
  const doc = docId ? docs.data?.find((d) => d.id === docId) : undefined
  if (!doc || !isSendableKind(doc.kind)) return null
  return <SendDocumentDialog loan={loan} doc={{ ...doc, kind: doc.kind }} onClose={onClose} />
}
