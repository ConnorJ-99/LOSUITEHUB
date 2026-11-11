import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input, Select, TextArea, ToggleChip, confirmAction } from '@/components/shared'
import { db } from '@/lib/api/client'
import { createShare, shareKeys, useShareRecipients, type ShareRecipient } from '@/lib/api/estimateShares'
import { useMessagingSettings } from '@/lib/api/ghl'
import { useSendMessage } from '@/lib/api/messages'
import type { LoanProfile } from '@/lib/api/types'
import { productLabel } from '@/lib/documents/feeWorksheet'
import { nowIso } from '@/lib/dates'
import type { Estimate } from '@/lib/estimates/estimate'
import { MAX_SHARED, fillLink, shareExpiry, shareMessage, shareSnapshot, shareUrl, type ShareSource } from '@/lib/estimates/share'
import { formatCurrency, formatPercent } from '@/lib/format'
import type { EstimateData } from './useEstimateData'
import type { useEstimatePdf } from './useEstimatePdf'

type Channel = 'text' | 'email'

const canText = (r: ShareRecipient) => !!r.phone && r.smsConsent === true && !r.smsOptedOutAt
const canEmail = (r: ShareRecipient) => !!r.email && r.emailConsent === true && !r.emailOptedOutAt
/** Only borrowers with an email can open the page (they confirm it there). */
const reachable = (r: ShareRecipient) => !!r.email && (canText(r) || canEmail(r))

/**
 * Share 1 to 5 estimates with a borrower by link (build plan Phase 7). Makes
 * each option's estimate PDF, freezes the numbers on a new link, then sends the
 * text or email through the approval and send checks after a confirm. If the
 * send fails, the new link is revoked so nothing is left open.
 */
export function ShareEstimatesDialog({
  loan,
  data,
  pdf,
  estimates,
  initial,
  onClose,
}: {
  loan: LoanProfile
  data: EstimateData
  pdf: ReturnType<typeof useEstimatePdf>
  estimates: Estimate[]
  initial: string[]
  onClose: () => void
}) {
  const recipients = useShareRecipients(loan.id)
  const settings = useMessagingSettings()
  const send = useSendMessage()
  const queryClient = useQueryClient()
  const [picked, setPicked] = useState<string[]>(initial.slice(0, MAX_SHARED))
  const [contactId, setContactId] = useState<string | null>(null)
  const [channel, setChannel] = useState<Channel>('text')
  const [days, setDays] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [subject, setSubject] = useState('Your loan options from MPS Mortgage')
  const [busy, setBusy] = useState(false)

  const people = recipients.data ?? []
  const person = people.find((p) => p.contactId === contactId) ?? null
  const loName = loan.assignedLo?.name ?? 'MPS Mortgage'

  useEffect(() => {
    if (contactId || !recipients.data) return
    const first = recipients.data.find(reachable)
    if (first) {
      setContactId(first.contactId)
      setChannel(canText(first) ? 'text' : 'email')
    }
  }, [recipients.data, contactId])
  useEffect(() => {
    if (days == null && settings.data) setDays(String(settings.data.estimateShareDays))
  }, [settings.data, days])
  const defaultMessage = useMemo(() => shareMessage(person?.firstName ?? 'there', loName.split(' ')[0] || loName, picked.length || 1), [person, loName, picked.length])
  const words = message ?? defaultMessage

  const toggle = (id: string, on: boolean) => {
    if (on && picked.length >= MAX_SHARED) return toast.error(`Up to ${MAX_SHARED} estimates in one link.`)
    setPicked((p) => (on ? [...p, id] : p.filter((x) => x !== id)))
  }
  const n = Number(days)
  const daysOk = Number.isInteger(n) && n >= 1 && n <= 60
  const channelOk = person && (channel === 'text' ? canText(person) : canEmail(person))
  const ready = !!person && channelOk && picked.length >= 1 && daysOk && words.trim().length > 0 && (channel === 'text' || subject.trim().length > 0)

  const share = async () => {
    if (!person || !ready) return
    const chosen = picked.map((id) => estimates.find((e) => e.id === id)).filter((e): e is Estimate => !!e)
    // Every option needs a complete worksheet before anything is saved.
    const sheets = chosen.map((e) => ({ e, w: pdf.worksheetFor(e) }))
    const incomplete = sheets.find((x) => !x.w.worksheet)
    if (incomplete) return toast.error(`"${incomplete.e.name}": fill in the ${incomplete.w.missing.join(', ')} first.`)
    const how = channel === 'text' ? `a text to ${person.name}` : `an email to ${person.name} (${person.email})`
    if (!(await confirmAction(`Send ${how} with a link to ${chosen.length} option${chosen.length === 1 ? '' : 's'}? The link works for ${n} day${n === 1 ? '' : 's'}.`, { confirmLabel: 'Send' }))) return
    setBusy(true)
    let shareId: string | null = null
    try {
      const sources: ShareSource[] = []
      for (const { e, w } of sheets) {
        const docId = await pdf.save(e, undefined, undefined, true)
        if (!docId) throw new Error(`The estimate PDF for "${e.name}" could not be made.`)
        sources.push({
          estimateId: e.id,
          program: productLabel(w.scenario) || 'Loan option',
          ratePct: w.scenario.noteRate,
          pointsPct: w.scenario.pointsPct,
          lenderCredit: w.scenario.lenderCredit,
          loanAmount: w.scenario.loanAmount ?? 0,
          purchasePrice: loan.purpose === 'purchase' ? w.scenario.purchasePrice : null,
          worksheet: w.worksheet!,
          figures: w.figures,
          pdfDocumentId: docId,
        })
      }
      const created = await createShare({
        organizationId: loan.organizationId,
        loanId: loan.id,
        contactId: person.contactId,
        channel,
        estimateIds: chosen.map((e) => e.id),
        snapshot: shareSnapshot(sources, nowIso()),
        expiresAt: shareExpiry(n),
      })
      shareId = created.id
      const body = fillLink(words.trim(), shareUrl(window.location.origin, created.token))
      await send.mutateAsync({ contactId: person.contactId, loanId: loan.id, channel, body, subject: channel === 'email' ? subject.trim() : null, idempotencyKey: `share-${created.id}` })
      shareId = null
      toast.success(`Sent the link to ${person.name}`)
      onClose()
    } catch (e) {
      if (shareId) {
        // The message didn't go: close the link so nothing is left open.
        await db().from('estimate_shares').update({ revoked_at: new Date().toISOString() }).eq('id', shareId)
      }
      toast.error((e as Error).message)
    } finally {
      await queryClient.invalidateQueries({ queryKey: shareKeys.list(loan.id) })
      await data.refresh()
      setBusy(false)
    }
  }

  const options = people.filter(reachable).map((p) => ({ value: p.contactId, label: `${p.name}${p.role === 'co_borrower' ? ' (co-borrower)' : ''}` }))
  const left = people.filter((p) => !reachable(p))

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Share estimates</DialogTitle>
          <DialogDescription>The borrower gets a link that opens after they confirm their email. The numbers are frozen as they are now; later edits don't change what they see.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[65vh] space-y-4 overflow-y-auto">
          <div>
            <p className="mb-1.5 text-sm font-medium">Options to share (up to {MAX_SHARED})</p>
            <div className="flex flex-wrap gap-1.5">
              {estimates.map((e) => {
                const f = data.figuresOf(e)
                return <ToggleChip key={e.id} label={`${e.name} · ${formatPercent(f.ratePct)} · ${formatCurrency(f.pitia)}/mo`} pressed={picked.includes(e.id)} onChange={(on) => toggle(e.id, on)} />
              })}
            </div>
            {picked.length > 0 && <p className="mt-1 text-xs text-muted-foreground">They'll show as {picked.map((_, i) => `Option ${i + 1}`).join(', ')} in this order, with the product, never the lender.</p>}
          </div>
          {recipients.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : options.length === 0 ? (
            <p className="text-sm text-destructive">No borrower on this file has an email and text or email consent recorded. Add their email and record consent first.</p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              <Select label="Send to" value={contactId} onChange={(id) => {
                setContactId(id)
                const p = people.find((x) => x.contactId === id)
                if (p) setChannel(canText(p) ? 'text' : 'email')
              }} options={options} />
              <Select<Channel>
                label="By"
                value={channel}
                onChange={setChannel}
                options={[...(person && canText(person) ? [{ value: 'text' as const, label: 'Text' }] : []), ...(person && canEmail(person) ? [{ value: 'email' as const, label: 'Email' }] : [])]}
              />
              <Input label="Link works for (days)" type="number" min={1} max={60} value={days ?? ''} onChange={setDays} error={daysOk ? undefined : '1 to 60 days'} />
            </div>
          )}
          {left.length > 0 && <p className="text-xs text-muted-foreground">Not listed: {left.map((p) => `${p.name} (${!p.email ? 'no email' : 'no consent recorded'})`).join(', ')}.</p>}
          {channel === 'email' && <Input label="Subject" value={subject} onChange={setSubject} required />}
          <div>
            <TextArea label="Message" value={words} onChange={setMessage} rows={4} />
            <p className="mt-1 text-xs text-muted-foreground">{'{link}'} is replaced with the link. Sent from your GoHighLevel {channel === 'text' ? 'number' : 'email'} after the usual checks.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={() => void share()} disabled={busy || !ready}>
            {busy ? 'Sending…' : 'Send link'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
