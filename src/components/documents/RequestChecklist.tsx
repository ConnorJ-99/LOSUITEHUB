import { useState } from 'react'
import { FileTextIcon, ListChecksIcon, PlusIcon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Card, EmptyState, TextArea, ToggleChip, confirmAction } from '@/components/shared'
import { useConditions, useUpdateCondition } from '@/lib/api/conditions'
import { openStoredFile, useRequestFiles, useReviewItem, useRevokeLink, useUploadLinks, type ItemFile } from '@/lib/api/uploadRequests'
import { conditionReady } from '@/lib/documents/uploadRequests'
import { openRequestDocuments } from './RequestDocumentsHost'
import { useSavedReadiness } from '@/components/prequal/Readiness'
import {
  useAddDocumentRequests,
  useDeleteDocumentRequest,
  useDocumentRequests,
  useUpdateDocumentRequest,
  type DocumentRequest,
  type RequestStatus,
} from '@/lib/api/documentRules'
import type { LoanDocument } from '@/lib/api/documents'
import type { LoanProfile } from '@/lib/api/types'
import { formatIsoDate } from '@/lib/dates'
import { matchingDocument, requestProgress, untrackedItems } from '@/lib/documents/requests'

const STATUS: Record<RequestStatus, { label: string; className: string }> = {
  requested: { label: 'Waiting', className: 'bg-amber-100 text-amber-900' },
  received: { label: 'Received', className: 'bg-sky-100 text-sky-900' },
  reviewed: { label: 'Accepted', className: 'bg-emerald-100 text-emerald-900' },
  rejected: { label: 'Needs attention', className: 'bg-red-100 text-red-800' },
  waived: { label: 'Waived', className: 'bg-muted text-muted-foreground' },
}

const day = (iso: string | null) => (iso ? formatIsoDate(iso.slice(0, 10)) : '')

function RequestRow({ request, requests, docs, loanId, files, conditionLabel }: { request: DocumentRequest; requests: DocumentRequest[]; docs: LoanDocument[]; loanId: string; files: ItemFile[]; conditionLabel: string | null }) {
  const update = useUpdateDocumentRequest(loanId)
  const review = useReviewItem(loanId)
  const conditions = useConditions(loanId)
  const updateCondition = useUpdateCondition(loanId)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
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
  const remove = useDeleteDocumentRequest(loanId)
  const fail = (e: Error) => toast.error(e.message)
  const move = (status: RequestStatus, documentId?: string | null) => update.mutate({ id: request.id, status, documentId }, { onError: fail })
  const match = request.status === 'requested' ? matchingDocument(request, docs, requests) : null
  const linked = request.documentId ? docs.find((d) => d.id === request.documentId) : undefined
  const s = STATUS[request.status]
  const dates = [`Asked ${day(request.requestedAt)}`, request.receivedAt && `received ${day(request.receivedAt)}`, request.reviewedAt && `reviewed ${day(request.reviewedAt)}`].filter(Boolean).join(' · ')

  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1 py-2">
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm', request.status === 'waived' && 'text-muted-foreground line-through')}>{request.label}</p>
        <p className="text-xs text-muted-foreground">
          {dates}
          {request.dueOn && ` · due ${formatIsoDate(request.dueOn)}`}
          {linked && !files.length && ` · ${linked.fileName}`}
          {conditionLabel && ` · for condition: ${conditionLabel}`}
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
            <Button size="sm" variant="outline" disabled={update.isPending} onClick={() => move('received', null)}>
              Mark received
            </Button>
            <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => move('waived')}>
              Waive
            </Button>
          </>
        )}
        {request.status === 'received' && (
          <>
            <Button size="sm" variant="outline" disabled={review.isPending} onClick={accept}>
              Accept
            </Button>
            <Button size="sm" variant="ghost" disabled={review.isPending} onClick={() => setRejecting(true)}>
              Reject…
            </Button>
          </>
        )}
        {request.status === 'rejected' && (
          <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => move('received')}>
            Undo
          </Button>
        )}
        {(request.status === 'reviewed' || request.status === 'waived') && (
          <Button size="sm" variant="ghost" disabled={update.isPending} onClick={() => move(request.status === 'reviewed' ? 'received' : 'requested')}>
            Undo
          </Button>
        )}
        <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={async () => (await confirmAction(`Stop tracking "${request.label}"?`, { confirmLabel: 'Remove', destructive: true })) && remove.mutate(request.id, { onError: fail })}>
          Remove
        </Button>
      </div>
    </li>
  )
}

function AddDialog({ loan, requests, open, onOpenChange }: { loan: LoanProfile; requests: DocumentRequest[]; open: boolean; onOpenChange: (open: boolean) => void }) {
  const view = useSavedReadiness(loan)
  const add = useAddDocumentRequests(loan.id, loan.organizationId)
  const items = view ? untrackedItems(view.checklist, requests) : []
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const id = (i: { contactId: string | null; key: string }) => `${i.contactId ?? ''}:${i.key}`
  const chosen = items.filter((i) => picked.has(id(i)))
  const groups = [...new Set(items.map((i) => i.who))].map((who) => ({ who, items: items.filter((i) => i.who === who) }))

  const save = () =>
    add.mutate(
      chosen.map((i) => ({ contactId: i.contactId, ruleKey: i.key, label: i.label, kind: i.kind })),
      {
        onSuccess: (n) => {
          toast.success(`${n} item${n === 1 ? '' : 's'} added to the checklist`)
          setPicked(new Set())
          onOpenChange(false)
        },
        onError: (e) => toast.error(e.message),
      },
    )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add from checklist</DialogTitle>
          <DialogDescription>Documents this file needs, from your checklist rules in Settings, that aren't tracked yet. Pick the ones you've asked for.</DialogDescription>
        </DialogHeader>
        {!view ? (
          <p className="text-sm text-muted-foreground">Loading… (the file needs at least one borrower on the 1003.)</p>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Everything on the checklist is already being tracked.</p>
        ) : (
          <div className="space-y-3">
            {groups.map((g) => (
              <section key={g.who}>
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.who}</h3>
                <ul className="divide-y">
                  {g.items.map((i) => (
                    <li key={id(i)} className="flex items-center justify-between gap-3 py-1.5">
                      <span className="text-sm">{i.label}</span>
                      <ToggleChip label="Add" pressed={picked.has(id(i))} onChange={(p) => setPicked((s) => { const n = new Set(s); if (p) n.add(id(i)); else n.delete(id(i)); return n })} />
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
        <DialogFooter>
          {items.length > 0 && (
            <Button variant="ghost" onClick={() => setPicked(new Set(items.map(id)))}>
              Pick all
            </Button>
          )}
          <Button disabled={chosen.length === 0 || add.isPending} onClick={save}>
            {add.isPending ? 'Adding…' : `Add ${chosen.length || ''}`.trim()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * What's been asked for on this file and where each item stands:
 * waiting → received (optionally tied to an upload) → reviewed, or waived.
 */
export function RequestChecklist({ loan, docs, people }: { loan: LoanProfile; docs: LoanDocument[]; people: { contactId: string; name: string }[] }) {
  const requests = useDocumentRequests(loan.id)
  const files = useRequestFiles(loan.id)
  const conditions = useConditions(loan.id)
  const links = useUploadLinks(loan.id)
  const revoke = useRevokeLink(loan.id)
  const [adding, setAdding] = useState(false)
  const conditionLabel = (id: string | null | undefined) => (id ? ((conditions.data ?? []).find((c) => c.id === id)?.body ?? null) : null)
  const list = requests.data ?? []
  const progress = requestProgress(list)
  const whoName = (contactId: string | null) => (contactId === null ? 'Whole file' : (people.find((p) => p.contactId === contactId)?.name ?? 'Someone no longer on the file'))
  const groups = [...new Set(list.map((r) => r.contactId))].map((c) => ({ contactId: c, name: whoName(c), items: list.filter((r) => r.contactId === c) }))

  return (
    <Card
      title="Checklist"
      description={list.length ? `${progress.done} of ${progress.total} received${progress.reviewed ? `, ${progress.reviewed} reviewed` : ''}.` : 'Documents you have asked the borrower for, and which have come in.'}
      action={
        <div className="flex flex-wrap gap-1.5">
          <Button size="sm" onClick={() => openRequestDocuments(loan.id)}>
            <SendIcon />
            Request documents
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            <PlusIcon />
            Add from checklist
          </Button>
        </div>
      }
    >
      {requests.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : requests.isError ? (
        <p className="text-sm text-destructive">{requests.error.message}</p>
      ) : list.length === 0 ? (
        <EmptyState icon={ListChecksIcon} title="Nothing tracked yet" description='Items are added when you send a document request from the Overview, or with "Add from checklist".' />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.contactId ?? 'file'}>
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.name}</h3>
              <ul className="divide-y">
                {g.items.map((r) => (
                  <RequestRow key={r.id} request={r} requests={list} docs={docs} loanId={loan.id} files={(files.data ?? []).filter((f) => f.requestId === r.id)} conditionLabel={conditionLabel(r.conditionId)} />
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {(links.data ?? []).length > 0 && (
        <section className="mt-4 border-t pt-3">
          <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Upload links</h3>
          <ul className="divide-y">
            {(links.data ?? []).map((l) => {
              const live = !l.revokedAt && Date.parse(l.expiresAt) > Date.now()
              const waiting = list.filter((r) => r.linkId === l.id && (r.status === 'requested' || r.status === 'rejected')).length
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
      )}
      {adding && <AddDialog loan={loan} requests={list} open={adding} onOpenChange={setAdding} />}
    </Card>
  )
}
