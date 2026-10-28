import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ExternalLinkIcon, KeyboardIcon, PlusIcon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, PageHeader, ToggleChip, ToggleChipGroup, confirmAction } from '@/components/shared'
import { LenderDialog } from '@/components/lenders/LenderDialog'
import { UploadDocumentDialog } from '@/components/lenders/UploadDocumentDialog'
import { LenderMark } from '@/components/products/ProgramCard'
import { blankLender, useDeleteLenderDocument, useLenderDocuments, useLenderPrograms, useLenders, useSetProgramActive, useUpdateLenderDocument, type Lender, type LenderDocument, type LenderDraft, type LenderProgram } from '@/lib/api/lenders'
import { readMatrix, usePendingImports, useStartTypedMatrix } from '@/lib/api/matrixImports'
import { useAiStatus } from '@/lib/api/assistant'
import { openGuidelinePdf, searchPassages, type Passage } from '@/lib/api/products'
import { useAuth } from '@/lib/auth/context'
import { todayIso } from '@/lib/dates'
import { daysSince, isStale, oldestVerified, STALE_AFTER_DAYS } from '@/lib/products/stale'
import { DOC_TYPES, LENDER_CHANNELS, LENDER_STATUSES, LIENS, PRODUCT_FAMILIES } from '@/lib/products/taxonomy'

const STATUS_CLASS: Record<Lender['status'], string> = {
  approved: 'bg-emerald-50 text-emerald-700',
  pending: 'bg-accent text-accent-foreground',
  not_signed_up: 'bg-amber-50 text-amber-800',
  inactive: 'bg-muted text-muted-foreground',
}
const DOC_LABEL: Record<LenderDocument['docType'], string> = { matrix: 'Matrix', guidelines: 'Guidelines', overlay_bulletin: 'Overlay bulletin', rate_sheet: 'Rate sheet' }
const toDraft = ({ programs: _p, documentCount: _d, ...l }: Lender): LenderDraft => l

/** Lenders: add and edit lenders with their status, and upload their matrices and guidelines. */
export function LendersPage() {
  const { state } = useAuth()
  const canEdit = state.status === 'signedIn' && (state.user.role === 'owner' || state.user.role === 'admin')
  const lenders = useLenders()
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState<LenderDraft | null>(null)
  const today = todayIso()
  const list = lenders.data ?? []
  const selected = list.find((l) => l.id === params.get('lender')) ?? list[0] ?? null
  const pick = (id: string) => setParams({ lender: id }, { replace: true })

  return (
    <>
      <PageHeader
        title="Lenders"
        description="Your lenders, their status, and the matrices and guidelines Product Search uses."
        action={
          canEdit && (
            <Button onClick={() => setEditing(blankLender())}>
              <PlusIcon />
              Add lender
            </Button>
          )
        }
      />
      {lenders.isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
      ) : lenders.error ? (
        <p className="py-12 text-center text-sm text-destructive">{lenders.error.message}</p>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState title="No lenders yet" description="Add a lender, then upload their matrix and guidelines." />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <ul className="space-y-2">
            {list.map((l) => {
              const verified = oldestVerified(l.programs)
              const stale = l.programs.some((p) => p.active) && isStale(verified, today)
              return (
                <li key={l.id}>
                  <button type="button" onClick={() => pick(l.id)} className={cn('flex w-full items-start gap-3 rounded-xl border bg-card p-3 text-left transition-colors', selected?.id === l.id ? 'border-primary ring-1 ring-primary' : 'hover:bg-muted/40')}>
                    <LenderMark name={l.shortName ?? l.name} className="size-9 text-xs" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{l.name}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                        <span className={cn('rounded-full px-2 py-0.5 font-medium', STATUS_CLASS[l.status])}>{LENDER_STATUSES.label[l.status]}</span>
                        {l.programs.length} program{l.programs.length === 1 ? '' : 's'} · {l.documentCount} document{l.documentCount === 1 ? '' : 's'}
                      </span>
                      {stale && <span className="mt-1 block text-xs text-amber-800">{verified ? `Matrix verified ${daysSince(verified, today)} days ago` : 'A matrix has never been verified'}</span>}
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          {selected && <LenderDetail key={selected.id} lender={selected} canEdit={canEdit} onEdit={() => setEditing(toDraft(selected))} />}
        </div>
      )}
      {editing && <LenderDialog initial={editing} onClose={() => setEditing(null)} onSaved={pick} />}
    </>
  )
}

function LenderDetail({ lender: l, canEdit, onEdit }: { lender: Lender; canEdit: boolean; onEdit: () => void }) {
  const programs = useLenderPrograms(l.id)
  const documents = useLenderDocuments(l.id)
  const [uploading, setUploading] = useState(false)
  const today = todayIso()
  const verified = oldestVerified(l.programs)
  const stale = l.programs.some((p) => p.active) && isStale(verified, today)

  return (
    <div className="space-y-4">
      <Card
        title={l.name}
        description={`${LENDER_STATUSES.label[l.status]} · ${LENDER_CHANNELS.label[l.channel]}${l.states?.length ? ` · ${l.states.join(', ')}` : ''}`}
        action={
          <div className="flex gap-2">
            {l.portalUrl && (
              <Button size="sm" variant="outline" asChild>
                <a href={l.portalUrl} target="_blank" rel="noopener noreferrer">
                  Lender portal
                  <ExternalLinkIcon />
                </a>
              </Button>
            )}
            {canEdit && (
              <Button size="sm" variant="outline" onClick={onEdit}>
                Edit
              </Button>
            )}
          </div>
        }
      >
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
          <Info label="Account executive" value={[l.aeName, l.aePhone, l.aeEmail].filter(Boolean).join(' · ') || '—'} />
          <Info label="Comp notes" value={l.compNotes ?? '—'} />
          <Info label="Notes" value={l.notes ?? '—'} />
        </dl>
        {l.status === 'not_signed_up' && <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">Not signed up: this lender's programs still show in Product Search, marked so you check with them first.</p>}
        {stale && <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">Stale matrix: {verified ? `last verified ${daysSince(verified, today)} days ago` : 'a program has never been verified'}. Upload the latest matrix to refresh it (over {STALE_AFTER_DAYS} days counts as stale).</p>}
      </Card>

      <PendingImports lenderId={l.id} />

      <Card
        title="Programs"
        description="A program's matrix becomes searchable once you approve it on the review screen. Type or paste it yourself, or have the assistant read a matrix PDF below."
        action={canEdit && <TypeMatrixButton lenderId={l.id} documentId={null} label="Type a matrix" />}
      >
        {programs.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : <ProgramList lenderId={l.id} programs={programs.data ?? []} canEdit={canEdit} />}
      </Card>

      <Card
        title="Documents"
        description="The lender's PDFs, stored privately. Their text is searchable by section, with page numbers."
        action={
          canEdit && (
            <Button size="sm" variant="outline" onClick={() => setUploading(true)}>
              <UploadIcon />
              Upload PDF
            </Button>
          )
        }
      >
        {documents.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : <DocumentList lenderId={l.id} documents={documents.data ?? []} programs={programs.data ?? []} canEdit={canEdit} />}
      </Card>

      {(documents.data ?? []).some((d) => d.current && d.passageCount > 0) && <LenderSearch documents={documents.data!.filter((d) => d.current)} />}
      {uploading && <UploadDocumentDialog lenderId={l.id} programs={programs.data ?? []} documents={documents.data ?? []} onClose={() => setUploading(false)} />}
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="whitespace-pre-line">{value}</dd>
    </div>
  )
}

function ProgramList({ lenderId, programs, canEdit }: { lenderId: string; programs: LenderProgram[]; canEdit: boolean }) {
  const setActive = useSetProgramActive(lenderId)
  if (programs.length === 0) return <p className="text-sm text-muted-foreground">No programs yet. Use Type a matrix to add one, or have the assistant read a matrix PDF; it appears here once you approve it.</p>
  return (
    <ul className="divide-y">
      {programs.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
          <div className={cn('min-w-0 flex-1', !p.active && 'text-muted-foreground')}>
            <p className="text-sm font-medium">{p.name}</p>
            <p className="text-xs text-muted-foreground">
              {PRODUCT_FAMILIES.label[p.family]} · {LIENS.label[p.lien]} · {p.docTypes.map((d) => DOC_TYPES.label[d]).join(', ')}
              {p.lastVerifiedOn && ` · verified ${new Date(`${p.lastVerifiedOn}T12:00:00`).toLocaleDateString('en-US')}`}
              {!p.hasApprovedMatrix && ' · no approved matrix yet'}
            </p>
          </div>
          <ToggleChip label={p.active ? 'In searches' : 'Retired'} pressed={p.active} disabled={!canEdit || setActive.isPending} onChange={(active) => setActive.mutate({ id: p.id, active }, { onError: (e) => toast.error(e.message) })} />
        </li>
      ))}
    </ul>
  )
}

function DocumentList({ lenderId, documents, programs, canEdit }: { lenderId: string; documents: LenderDocument[]; programs: LenderProgram[]; canEdit: boolean }) {
  const update = useUpdateLenderDocument(lenderId)
  const remove = useDeleteLenderDocument(lenderId)
  const [linking, setLinking] = useState<string | null>(null)
  const [reading, setReading] = useState<string | null>(null)
  const navigate = useNavigate()
  const ai = useAiStatus()
  const aiOff = ai.data?.ready === false
  const read = async (d: LenderDocument) => {
    setReading(d.id)
    try {
      const importId = await readMatrix(d.id)
      navigate(`/admin/lenders/imports/${importId}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setReading(null)
    }
  }
  if (documents.length === 0) return <p className="text-sm text-muted-foreground">No documents yet.</p>
  const fail = { onError: (e: Error) => toast.error(e.message) }
  return (
    <ul className="divide-y">
      {documents.map((d) => (
        <li key={d.id} className="py-2.5">
          <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
            <div className={cn('min-w-0 flex-1', !d.current && 'text-muted-foreground')}>
              <p className="text-sm font-medium">
                {d.title}
                {!d.current && <span className="ml-2 rounded-full border px-2 py-0.5 text-[10px] font-normal">Superseded</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {DOC_LABEL[d.docType]}
                {d.versionLabel && ` · ${d.versionLabel}`}
                {d.effectiveDate && ` · effective ${new Date(`${d.effectiveDate}T12:00:00`).toLocaleDateString('en-US')}`}
                {d.pageCount != null && ` · ${d.pageCount} page${d.pageCount === 1 ? '' : 's'}`} · {d.passageCount} searchable passage{d.passageCount === 1 ? '' : 's'}
                {d.pageCount != null && d.passageCount === 0 && ' (scanned? no text found)'}
              </p>
              <p className="mt-0.5 text-xs">{d.programIds.length ? `Covers: ${programs.filter((p) => d.programIds.includes(p.id)).map((p) => p.name).join(', ')}` : <span className="text-amber-700">Not linked to a program yet</span>}</p>
            </div>
            <div className="flex flex-wrap gap-1">
              {d.storagePath && (
                <Button size="sm" variant="ghost" onClick={() => openGuidelinePdf(d.storagePath!, null).catch((e: Error) => toast.error(e.message))}>
                  Open
                </Button>
              )}
              {canEdit && (
                <>
                  {d.docType === 'matrix' && <TypeMatrixButton lenderId={lenderId} documentId={d.id} label="Type it in" />}
                  {d.docType === 'matrix' && d.storagePath && (
                    <Button size="sm" variant="outline" disabled={reading !== null || aiOff} onClick={() => read(d)} title={aiOff ? 'Turns on once the AI assistant is set up (the Anthropic key in Supabase)' : 'The assistant reads every grid and rule; you review it against the PDF before anything is used'}>
                      {reading === d.id ? 'Reading… (a minute or two)' : 'Read matrix (AI)'}
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setLinking(linking === d.id ? null : d.id)}>
                    Programs
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => update.mutate({ id: d.id, current: !d.current }, fail)}>
                    {d.current ? 'Mark superseded' : 'Mark current'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={async () => (await confirmAction(`Delete "${d.title}" and its searchable text? This can't be undone.`, { confirmLabel: 'Delete', destructive: true })) && remove.mutate(d, { onSuccess: () => toast.success('Deleted'), ...fail })}>
                    Delete
                  </Button>
                </>
              )}
            </div>
          </div>
          {linking === d.id && (
            <ToggleChipGroup className="mt-2">
              {programs.map((p) => (
                <ToggleChip key={p.id} label={p.name} pressed={d.programIds.includes(p.id)} onChange={(on) => update.mutate({ id: d.id, programIds: on ? [...d.programIds, p.id] : d.programIds.filter((x) => x !== p.id) }, fail)} />
              ))}
            </ToggleChipGroup>
          )}
        </li>
      ))}
    </ul>
  )
}

/** Text search across this lender's current documents (no AI). */
function LenderSearch({ documents }: { documents: LenderDocument[] }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Passage[] | null>(null)
  const [busy, setBusy] = useState(false)
  const byId = new Map(documents.map((d) => [d.id, d]))
  const run = async () => {
    setBusy(true)
    try {
      setHits(await searchPassages(documents.map((d) => d.id), q))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card title="Search this lender's guidelines" description="Text search over the current documents. Abbreviations like LLC or PPP also match the spelled-out words. No AI is used.">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void run()
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder='e.g. "non-warrantable", ITIN, "first-time investor"' className="h-9 min-w-0 flex-1 rounded-md border bg-card px-3 text-sm" />
        <Button type="submit" disabled={busy || !q.trim()}>
          {busy ? 'Searching…' : 'Search'}
        </Button>
      </form>
      {hits && (
        <ul className="mt-4 space-y-3">
          {hits.length === 0 && <li className="text-sm text-muted-foreground">Nothing found. Try another word.</li>}
          {hits.map((p) => {
            const doc = byId.get(p.documentId)
            return (
              <li key={p.id} className="text-sm">
                {p.heading && <p className="font-medium">{p.heading}</p>}
                <p className="leading-relaxed">
                  {p.body}{' '}
                  <button type="button" disabled={!doc?.storagePath} onClick={() => doc?.storagePath && openGuidelinePdf(doc.storagePath, p.page).catch((e: Error) => toast.error(e.message))} className="rounded bg-accent px-1.5 py-0.5 text-xs font-medium text-accent-foreground hover:underline disabled:no-underline">
                    p.{p.page}
                    {p.sectionNumber ? ` §${p.sectionNumber}` : ''}
                  </button>
                </p>
                <p className="text-xs text-muted-foreground">{doc?.title}</p>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/** Starts a matrix typed by hand (beside this PDF, if one is given) and opens it. */
function TypeMatrixButton({ lenderId, documentId, label }: { lenderId: string; documentId: string | null; label: string }) {
  const { state } = useAuth()
  const start = useStartTypedMatrix(lenderId)
  const navigate = useNavigate()
  if (state.status !== 'signedIn' || !state.user.organizationId) return null
  const organizationId = state.user.organizationId
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={start.isPending}
      title="Type the grid or paste it from Excel; it goes through the same checks and approval as an AI reading"
      onClick={() => start.mutate({ organizationId, documentId }, { onSuccess: (id) => navigate(`/admin/lenders/imports/${id}`), onError: (e) => toast.error(e.message) })}
    >
      <KeyboardIcon />
      {start.isPending ? 'Starting…' : label}
    </Button>
  )
}

/** Matrices waiting for review: typed drafts and assistant readings. */
function PendingImports({ lenderId }: { lenderId: string }) {
  const imports = usePendingImports(lenderId)
  if (!imports.data?.length) return null
  return (
    <Card title="Waiting for your review" description="Matrices typed by hand or read by the assistant. Nothing in them is searchable until you approve it.">
      <ul className="divide-y">
        {imports.data.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
            <span>
              {i.source === 'manual' ? `Typed by hand: ${i.reading.programs.map((p) => p.name || 'Unnamed program').join(', ')}` : (i.documentTitle ?? 'Matrix')} · {i.reading.programs.length} program{i.reading.programs.length === 1 ? '' : 's'} · {i.source === 'manual' ? 'started' : 'read'} {new Date(i.createdAt).toLocaleDateString('en-US')}
            </span>
            <Button size="sm" asChild>
              <Link to={`/admin/lenders/imports/${i.id}`}>{i.source === 'manual' ? 'Continue' : 'Review'}</Link>
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
