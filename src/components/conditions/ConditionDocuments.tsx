import { useState } from 'react'
import { FileTextIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { TextArea, confirmAction } from '@/components/shared'
import { useConditions, useUpdateCondition } from '@/lib/api/conditions'
import { openStoredFile, useRevokeLink, useReviewItem, useUploadLinks, type ItemFile } from '@/lib/api/uploadRequests'
import { conditionReady } from '@/lib/documents/uploadRequests'
import { useDeleteDocumentRequest, useUpdateDocumentRequest, type DocumentRequest, type RequestStatus } from '@/lib/api/documentRules'
import type { LoanDocument } from '@/lib/api/documents'
import { formatIsoDate } from '@/lib/dates'
import { matchingDocument } from '@/lib/documents/requests'

// Docs & Conditions is conditions only (Connor, 2026-11-17): what was the
// checklist card now sits under each condition: the documents asked for, the
// files that came in, Accept / Reject, and the upload links sent.

const STATUS: Record<RequestStatus, { label: string; className: string }> = {
  requested: { label: 'Waiting', className: 'bg-amber-100 text-amber-900' },
  received: { label: 'Received', className: 'bg-sky-100 text-sky-900' },
  reviewed: { label: 'Accepted', className: 'bg-emerald-100 text-emerald-900' },
  rejected: { label: 'Needs attention', className: 'bg-red-100 text-red-800' },
  waived: { label: 'Waived', className: 'bg-muted text-muted-foreground' },
}

const day = (iso: string | null) => (iso ? formatIsoDate(iso.slice(0, 10)) : '')

/** One document asked for: who it's from, its files, and Accept / Reject / Waive. */
export function RequestRow({ request, requests, docs, loanId, files, who }: { request: DocumentRequest; requests: DocumentRequest[]; docs: LoanDocument[]; loanId: string; files: ItemFile[]; who: string | null }) {
  const update = useUpdateDocumentRequest(loanId)
  const review = useReviewItem(loanId)
  const conditions = useConditions(loanId)
  const updateCondition = useUpdateCondition(loanId)
  const remove = useDeleteDocumentRequest(loanId)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const fail = (e: Error) => toast.error(e.message)
  // Accept; when every item for its condition is accepted, ask (never automatic) about clearing the condition.
  const accept = () =>
    review.mutate(
      { id: request.id, accept: true },
      {
        onSuccess: async () => {
          const cond = request.conditionId ? (conditions.data ?? []).find((c) => c.id === request.conditionId) : null
          if (!cond || cond.status === 'cleared' || cond.status === 'waived') return
          const after = requests.map((r) => ({ conditionId: r.conditionId ?? null, status: r.id === request.id ? ('reviewed' as const) : r.status }))
          if (!conditionReady(after, cond.id)) return
          if (await confirmAction(`Every document for the condition "${cond.body}" is accepted. Mark the condition cleared?`, { confirmLabel: 'Mark cleared' }))
            updateCondition.mutate({ id: cond.id, changes: { status: 'cleared' } }, { onSuccess: () => toast.success('Condition cleared'), onError: fail })
        },
        onError: fail,
      },
    )
  const reject = () =>
    review.mutate(
      { id: request.id, accept: false, reason },
      {
        onSuccess: () => {
          toast.success('Sent back: it shows again on the borrower’s upload page')
          setRejecting(false)
          setReason('')
        },
        onError: fail,
      },
    )
  const move = (status: RequestStatus, documentId?: string | null) => update.mutate({ id: request.id, status, documentId }, { onError: fail })
  const match = request.status === 'requested' ? matchingDocument(request, docs, requests) : null
  const linked = request.documentId ? docs.find((d) => d.id === request.documentId) : undefined
  const s = STATUS[request.status]
  const dates = [`Asked ${day(request.requestedAt)}`, request.receivedAt && `received ${day(request.receivedAt)}`, request.reviewedAt && `reviewed ${day(request.reviewedAt)}`].filter(Boolean).join(' · ')

  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 py-1.5">
      <div className="min-w-0 flex-[1_1_14rem]">
        <p className={cn('text-sm', request.status === 'waived' && 'text-muted-foreground line-through')}>
          {request.label}
          {who && <span className="text-xs text-muted-foreground"> · {who}</span>}
        </p>
        <p className="text-xs text-muted-foreground">
          {dates}
          {request.dueOn && ` · due ${formatIsoDate(request.dueOn)}`}
          {linked && !files.length && ` · ${linked.fileName}`}
        </p>
        {request.instructions && <p className="text-xs text-muted-foreground italic">{request.instructions}</p>}
        {request.status === 'rejected' && request.rejectReason && <p className="text-xs text-red-700">Sent back: {request.rejectReason}</p>}
        {files.length > 0 && (
          <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs">
            {files.map((f) => (
              <button key={f.id} type="button" className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => void openStoredFile(f.storagePath).catch(fail)}>
                <FileTextIcon className="size-3" />
                {f.fileName}
              </button>
            ))}
          </p>
        )}
        {rejecting && (
          <div className="mt-1.5 space-y-1.5">
            <TextArea label="What's wrong (the borrower sees this)" value={reason} onChange={setReason} rows={2} placeholder="e.g. Page 2 of 3 is missing" />
            <div className="flex gap-1.5">
              <Button size="xs" variant="destructive" disabled={!reason.trim() || review.isPending} onClick={reject}>
                Send back
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setRejecting(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {match && (
          <p className="mt-1 text-xs">
            <span className="text-muted-foreground">Uploaded: {match.fileName}. </span>
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => move('received', match.id)}>
              Mark received with this file
            </button>
          </p>
        )}
      </div>
      <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', s.className)}>{s.label}</span>
      <div className="flex gap-1">
        {request.status === 'requested' && (
          <>
            <Button size="xs" variant="outline" disabled={update.isPending} onClick={() => move('received', null)}>
              Mark received
            </Button>
            <Button size="xs" variant="ghost" disabled={update.isPending} onClick={() => move('waived')}>
              Waive
            </Button>
          </>
        )}
        {request.status === 'received' && (
          <>
            <Button size="xs" variant="outline" disabled={review.isPending} onClick={accept}>
              Accept
            </Button>
            <Button size="xs" variant="ghost" disabled={review.isPending} onClick={() => setRejecting(true)}>
              Reject…
            </Button>
          </>
        )}
        {request.status === 'rejected' && (
          <Button size="xs" variant="ghost" disabled={update.isPending} onClick={() => move('received')}>
            Undo
          </Button>
        )}
        {(request.status === 'reviewed' || request.status === 'waived') && (
          <Button size="xs" variant="ghost" disabled={update.isPending} onClick={() => move(request.status === 'reviewed' ? 'received' : 'requested')}>
            Undo
          </Button>
        )}
        <Button size="xs" variant="ghost" disabled={remove.isPending} onClick={async () => (await confirmAction(`Stop asking for "${request.label}"? The condition stays.`, { confirmLabel: 'Remove', destructive: true })) && remove.mutate(request.id, { onError: fail })}>
          Remove
        </Button>
      </div>
    </li>
  )
}

/** The upload links sent on this file: who, opened, what's still needed, and Turn off. */
export function UploadLinks({ loanId, requests, whoName }: { loanId: string; requests: DocumentRequest[]; whoName: (contactId: string | null) => string }) {
  const links = useUploadLinks(loanId)
  const revoke = useRevokeLink(loanId)
  if (!(links.data ?? []).length) return null
  return (
    <section className="mt-4 border-t pt-3">
      <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Upload links sent</h3>
      <ul className="divide-y">
        {(links.data ?? []).map((l) => {
          const live = !l.revokedAt && Date.parse(l.expiresAt) > Date.now()
          const waiting = requests.filter((r) => r.linkId === l.id && (r.status === 'requested' || r.status === 'rejected')).length
          return (
            <li key={l.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5 text-xs">
              <span className="font-medium">{whoName(l.contactId)}</span>
              <span className="text-muted-foreground">
                Sent {day(l.createdAt)} · {l.firstOpenedAt ? `opened ${day(l.lastOpenedAt ?? l.firstOpenedAt)}` : 'not opened yet'}
                {l.dueOn && ` · due ${formatIsoDate(l.dueOn)}`} · {waiting ? `${waiting} still needed` : 'nothing waiting'} · {l.revokedAt ? 'turned off' : live ? `expires ${day(l.expiresAt)}` : 'expired'}
              </span>
              {live && (
                <Button
                  size="xs"
                  variant="ghost"
                  className="ml-auto"
                  disabled={revoke.isPending}
                  onClick={async () => (await confirmAction('Turn this upload link off? It stops working right away. To ask again, send a new link.', { confirmLabel: 'Turn off', destructive: true })) && revoke.mutate(l.id, { onError: (e) => toast.error(e.message) })}
                >
                  Turn off
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
