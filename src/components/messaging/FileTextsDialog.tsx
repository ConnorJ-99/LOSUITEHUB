import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { TextArea, ToggleChip, confirmAction } from '@/components/shared'
import { recordTextConsent, saveTextDrafts, sendFileText, useFileRecipients, useRefreshAfterTexts, type FileRecipient } from '@/lib/api/fileUpdates'
import { useAuth } from '@/lib/auth/context'
import { formatPhone } from '@/lib/pipeline/helpers'

export interface FileTextsRequest {
  loanId: string
  title: string
  description: string
  /** The draft for each person (null = not offered to them, e.g. a partner for a borrower intro). */
  build: (r: FileRecipient) => string | null
  /** Who starts ticked (default: everyone offered). */
  preselect?: (r: FileRecipient) => boolean
}

interface Item {
  r: FileRecipient
  body: string
  on: boolean
  consentOk: boolean
}

/**
 * Intro and update texts for a file's borrowers and partners: one editable
 * draft each with a tick box. Send (after a confirm, each through the approval
 * and send checks), save them to the Action Queue as drafts, or skip. Nothing
 * sends on its own.
 */
export function FileTextsDialog({ request, onClose }: { request: FileTextsRequest; onClose: () => void }) {
  const { state } = useAuth()
  const organizationId = state.status === 'signedIn' ? state.user.organizationId : null
  const recipients = useFileRecipients(request.loanId)
  const refresh = useRefreshAfterTexts(request.loanId)
  const [items, setItems] = useState<Item[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!recipients.data || items) return
    setItems(
      recipients.data.flatMap((r) => {
        const body = request.build(r)
        if (body == null) return []
        const sendable = !!r.phone && !r.smsOptedOutAt
        return [{ r, body, on: sendable && (request.preselect?.(r) ?? true), consentOk: r.smsConsent === true }]
      }),
    )
  }, [recipients.data, items, request])

  const set = (i: number, patch: Partial<Item>) => setItems((xs) => xs!.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const chosen = (items ?? []).filter((x) => x.on && x.body.trim())
  const blocked = chosen.filter((x) => !x.consentOk)

  const send = async () => {
    if (!organizationId || !chosen.length) return
    if (blocked.length) return toast.error(`Turn on "They said OK to texts" for ${blocked.map((x) => x.r.name).join(', ')}, or untick them.`)
    if (!(await confirmAction(`Send ${chosen.length} text${chosen.length === 1 ? '' : 's'} now from your GoHighLevel number?`, { confirmLabel: 'Send' }))) return
    setBusy(true)
    let sent = 0
    for (const x of chosen) {
      try {
        if (x.r.smsConsent !== true) await recordTextConsent(x.r, 'Said OK to texts (recorded with an intro or update text)')
        await sendFileText(organizationId, request.loanId, x.r, x.body.trim(), `upd-${request.loanId.slice(0, 8)}-${x.r.id.slice(0, 8)}-${hash(x.body)}`)
        sent++
      } catch (e) {
        toast.error(`${x.r.name}: ${(e as Error).message}`)
      }
    }
    setBusy(false)
    refresh()
    if (sent) toast.success(`Sent ${sent} text${sent === 1 ? '' : 's'}`)
    if (sent === chosen.length) onClose()
  }

  const saveDrafts = async () => {
    if (!organizationId || !chosen.length) return
    setBusy(true)
    try {
      await saveTextDrafts(organizationId, request.loanId, request.title, chosen.map((x) => ({ r: x.r, body: x.body.trim() })))
      refresh()
      toast.success(`Saved ${chosen.length} draft${chosen.length === 1 ? '' : 's'} to the Action Queue`)
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{request.title}</DialogTitle>
          <DialogDescription>{request.description}</DialogDescription>
        </DialogHeader>
        {!items ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No one on this file to text.</p>
        ) : (
          <ul className="max-h-[60vh] space-y-3 overflow-y-auto">
            {items.map((x, i) => {
              const why = !x.r.phone ? 'No phone number' : x.r.smsOptedOutAt ? 'Opted out of texts' : null
              return (
                <li key={`${x.r.kind}:${x.r.id}`} className={cn('rounded-md border px-3 py-2', !x.on && 'opacity-60')}>
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">
                      {x.r.name} <span className="font-normal text-muted-foreground">· {x.r.role}{x.r.phone ? ` · ${formatPhone(x.r.phone)}` : ''}</span>
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {!why && x.r.smsConsent !== true && <ToggleChip label="They said OK to texts" pressed={x.consentOk} onChange={(consentOk) => set(i, { consentOk })} />}
                      <ToggleChip label={why ?? (x.on ? 'Send' : 'Skip')} pressed={x.on} disabled={!!why} onChange={(on) => set(i, { on })} />
                    </div>
                  </div>
                  <TextArea label={`Text to ${x.r.name}`} value={x.body} onChange={(body) => set(i, { body })} rows={3} disabled={!!why} />
                </li>
              )
            })}
          </ul>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Skip
          </Button>
          <Button variant="outline" onClick={saveDrafts} disabled={busy || !chosen.length}>
            Save as drafts
          </Button>
          <Button onClick={send} disabled={busy || !chosen.length}>
            {busy ? 'Sending…' : `Send ${chosen.length || ''}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** A short, stable key for a message's words, so a double click finds the same approval. */
function hash(s: string): string {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}
