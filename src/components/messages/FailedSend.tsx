import { useState } from 'react'
import { AlertTriangleIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { confirmAction } from '@/components/shared'
import { useClearFailedSend, useSendMessage, type Message } from '@/lib/api/messages'

/**
 * A send that failed stays on screen with GHL's reason until someone resends
 * it (a new approval for the same words, with every check run again) or
 * dismisses it. Nothing is resent without the click.
 */
export function FailedSendActions({ m }: { m: Message }) {
  const send = useSendMessage()
  const clear = useClearFailedSend()
  // A new key for the resend: it's a new approval, not the old one again.
  const [key] = useState(() => crypto.randomUUID())
  const busy = send.isPending || clear.isPending
  const what = m.channel === 'text' ? 'text' : 'email'
  const canResend = !!m.contactId && !!m.loanId && !!m.body.trim() && (m.channel === 'text' || !!m.subject)

  const resend = async () => {
    if (!m.contactId || !m.loanId) return
    const docs = m.attachments.length ? ` with ${m.attachments.map((a) => a.fileName).join(', ')}` : ''
    if (!(await confirmAction(`Send this ${what} again${docs}? It goes out through GHL with the same words, and every check runs again.`, { confirmLabel: `Resend ${what}` }))) return
    send.mutate(
      { contactId: m.contactId, loanId: m.loanId, channel: m.channel, body: m.body, subject: m.channel === 'email' ? m.subject : null, idempotencyKey: key, documentIds: m.attachments.map((a) => a.documentId) },
      {
        onSuccess: (r) => {
          if (r.alreadySent) toast.info('That resend already went out.')
          else toast.success(`${what === 'text' ? 'Text' : 'Email'} resent`)
          clear.mutate({ messageId: m.id, reason: 'resent' })
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  const dismiss = async () => {
    if (!(await confirmAction(`Dismiss this failed ${what}? It stays in the conversation, marked failed, and nothing is sent.`, { confirmLabel: 'Dismiss' }))) return
    clear.mutate({ messageId: m.id, reason: 'dismissed' }, { onError: (e) => toast.error(e.message) })
  }

  return (
    <div className="mt-2 space-y-1.5 rounded-md bg-destructive/5 px-2.5 py-2 text-xs">
      <p className="flex items-start gap-1.5 text-destructive">
        <AlertTriangleIcon className="mt-0.5 size-3.5 shrink-0" />
        <span>Not sent{m.sendError ? `: ${m.sendError}` : ': GHL reports it failed.'}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy || !canResend} onClick={resend}>
          {send.isPending ? 'Resending…' : 'Resend'}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={dismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  )
}
