import { useState } from 'react'
import { PaperclipIcon } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { cn } from 'cn'
import { confirmAction, Input, TextArea, ToggleChip } from '@/components/shared'
import { EditDialog } from '@/components/urla/parts'
import { TONE_CLASS } from '@/components/messages/tone'
import { useSendPlan } from '@/components/messages/useSendPlan'
import { keys } from '@/lib/api/client'
import { saveGeneratedPdf } from '@/lib/api/documents'
import { useLoan } from '@/lib/api/loans'
import { useFilePeople, useSendMessage, type FilePerson } from '@/lib/api/messages'
import { useAddNote } from '@/lib/api/notes'
import type { LoanProfile } from '@/lib/api/types'
import { QUICK_QUOTE_TEMPLATE } from '@/lib/documents/quickQuote'
import { quoteMessage } from '@/lib/quickquote/send'

export interface QuoteEmail {
  fileName: string
  optionCount: number
  validThrough: string
  /** Makes the PDF as the quote stands now. */
  makePdf: () => Promise<{ ok: true; file: Blob } | { ok: false; error: string }>
  /** The timeline note once it's sent (who it went to, whether a text went too). */
  noteFor: (to: string, withText: boolean) => string
}

function Form({ loan, person, quote, onSaved, onSent, onClose }: { loan: LoanProfile; person: FilePerson; quote: QuoteEmail; onSaved: (documentId: string) => Promise<void>; onSent: () => Promise<void>; onClose: () => void }) {
  const rules = useSendPlan(loan)
  const send = useSendMessage()
  const addNote = useAddNote(person.id, loan.organizationId)
  const queryClient = useQueryClient()
  const loName = rules?.loName ?? loan.assignedLo?.name ?? null
  const [draft] = useState(() => quoteMessage(person.firstName, loName, quote.optionCount, quote.validThrough))
  const [subject, setSubject] = useState(draft.subject)
  const [body, setBody] = useState(draft.body)
  const [alsoText, setAlsoText] = useState(false)
  const [text, setText] = useState(draft.text)
  const [busy, setBusy] = useState(false)
  // One key per message: a double click or retry can't send either one twice.
  const [sendKeys] = useState(() => ({ email: crypto.randomUUID(), text: crypto.randomUUID() }))
  const [documentId, setDocumentId] = useState<string | null>(null)

  if (!rules) return <p className="text-sm text-muted-foreground">Loading…</p>
  const emailPlan = rules.plan(person, 'email', body, subject)
  const textPlan = rules.plan(person, 'text', text, null)
  const textBlocked = textPlan.problems.length > 0

  const submit = async () => {
    if (emailPlan.problems.length) return toast.error(emailPlan.problems[0])
    const withText = alsoText && !textBlocked
    const ok = await confirmAction(
      `Email the quote to ${person.firstName} at ${emailPlan.to}${withText ? ', and text a heads-up to their mobile' : ''}? It goes out through GHL from ${emailPlan.fromEmail}, and the PDF is saved to the file's Documents.`,
      { confirmLabel: 'Send' },
    )
    if (!ok) return
    setBusy(true)
    try {
      // The PDF goes on the file first (a retry reuses it), then by email.
      let docId = documentId
      if (!docId) {
        const pdf = await quote.makePdf()
        if (!pdf.ok) throw new Error(pdf.error)
        docId = await saveGeneratedPdf(loan.id, loan.organizationId, { file: pdf.file, fileName: quote.fileName, kind: 'quick_quote', propertyId: null, templateVersion: QUICK_QUOTE_TEMPLATE })
        setDocumentId(docId)
        await queryClient.invalidateQueries({ queryKey: keys.documents(loan.id) })
        await onSaved(docId)
      }
      const r = await send.mutateAsync({ contactId: person.id, loanId: loan.id, channel: 'email', body, subject, idempotencyKey: sendKeys.email, documentIds: [docId] })
      if (r.alreadySent && r.error) throw new Error(`That email already failed: ${r.error}`)
      let texted = false
      if (withText) {
        try {
          await send.mutateAsync({ contactId: person.id, loanId: loan.id, channel: 'text', body: text, subject: null, idempotencyKey: sendKeys.text })
          texted = true
        } catch (e) {
          toast.error(`The email went, but the text didn't: ${(e as Error).message}`)
        }
      }
      await onSent()
      try {
        await addNote.mutateAsync({ loanId: loan.id, kind: 'email', body: quote.noteFor(emailPlan.to ?? person.email ?? person.firstName, texted) })
      } catch (e) {
        toast.error(`Sent, but the timeline note didn't save: ${(e as Error).message}`)
      }
      toast.success(r.alreadySent ? 'That quote was already sent.' : `Quote emailed to ${person.firstName}`)
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <EditDialog
      title="Email quote"
      description="By email with the PDF attached, through GHL. The same checks as every send: consent, opt-outs, sending hours, and the loan officer's number."
      open
      onOpenChange={(o) => !o && !busy && onClose()}
      onSubmit={submit}
      saving={busy}
      submitLabel={busy ? 'Sending…' : 'Send'}
    >
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">To</span>
          <span>
            {person.firstName} · {person.email ?? 'no email'}
          </span>
          <span className="text-muted-foreground">from</span>
          <span>{emailPlan.fromEmail ?? '—'}</span>
          <span className={cn('ml-auto', rules.window.open ? TONE_CLASS.ok : TONE_CLASS.warn)}>{rules.window.label}</span>
        </div>
        <Input label="Subject" value={subject} onChange={setSubject} />
        <TextArea label="Email" value={body} onChange={setBody} rows={8} />
        <p className="flex items-center gap-1.5 text-sm">
          <PaperclipIcon className="size-4 text-muted-foreground" />
          {quote.fileName}
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
          {textBlocked ? <p className="text-xs text-muted-foreground">No heads-up text: {textPlan.problems[0]}</p> : alsoText && <TextArea label="Text" value={text} onChange={setText} rows={2} />}
        </div>
      </div>
    </EditDialog>
  )
}

/** Emails the quote PDF to the borrower on its file, saves the PDF to Documents and a note to the timeline. */
export function EmailQuoteDialog({ loanId, contactId, quote, onSaved, onSent, onClose }: { loanId: string; contactId: string; quote: QuoteEmail; onSaved: (documentId: string) => Promise<void>; onSent: () => Promise<void>; onClose: () => void }) {
  const loan = useLoan(loanId)
  const people = useFilePeople(loanId)
  if (!loan.data || !people.data) return null
  const person = people.data.find((p) => p.id === contactId) ?? people.data[0]
  if (!person) return null
  return <Form loan={loan.data} person={person} quote={quote} onSaved={onSaved} onSent={onSent} onClose={onClose} />
}
