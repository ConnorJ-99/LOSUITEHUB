import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { ArrowLeftIcon, KeyboardIcon, PlusIcon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, PageHeader, ToggleChip, ToggleChipGroup, confirmAction } from '@/components/shared'
import { LenderDialog } from '@/components/lenders/LenderDialog'
import { ContactsTab, LenderHeader, LenderTabs, LoansTab, OverlaysTab, ProductsTab, SidePanel, useSaveLenderNotes } from '@/components/lenders/LenderDetailParts'
import { LenderList } from '@/components/lenders/LenderList'
import { UploadDocumentDialog } from '@/components/lenders/UploadDocumentDialog'
import { blankLender, guessStoredDocument, useDeleteLenderDocument, useLenderDocuments, useLenderPrograms, useLenders, useUpdateLenderDocument, type Lender, type LenderDocument, type LenderDraft, type LenderProgram } from '@/lib/api/lenders'
import { readMatrix, usePendingImports, useStartTypedMatrix } from '@/lib/api/matrixImports'
import { useAiStatus } from '@/lib/api/assistant'
import { useLenderContacts, useLenderFiles, useLenderMatrixVersions, useLenderOverlays } from '@/lib/api/lenderPage'
import { openGuidelinePdf, searchPassages, useCatalog, type Passage } from '@/lib/api/products'
import { useAuth } from '@/lib/auth/context'
import { todayIso } from '@/lib/dates'
import { daysSince, isStale, oldestVerified, STALE_AFTER_DAYS } from '@/lib/products/stale'
import { averageDaysToClose, lastMatrixUpdate, productRow } from '@/lib/products/lenderDetail'
import { loanCounts } from '@/lib/products/lenderSummary'
import { programFromGuess } from '@/lib/products/typedMatrix'

const DOC_LABEL: Record<LenderDocument['docType'], string> = { matrix: 'Matrix', guidelines: 'Guidelines', overlay_bulletin: 'Overlay bulletin', rate_sheet: 'Rate sheet' }
const toDraft = ({ programs: _p, documentCount: _d, ...l }: Lender): LenderDraft => l

/** Lenders: the list of lenders (mockup 08), and one lender with its programs and documents. */
export function LendersPage() {
  const { state } = useAuth()
  const canEdit = state.status === 'signedIn' && (state.user.role === 'owner' || state.user.role === 'admin')
  const lenders = useLenders()
  const [params, setParams] = useSearchParams()
  const [editing, setEditing] = useState<LenderDraft | null>(null)
  const list = lenders.data ?? []
  const selected = list.find((l) => l.id === params.get('lender')) ?? null
  const pick = (id: string) => setParams({ lender: id })

  return (
    <>
      {selected && (
        <button type="button" onClick={() => setParams({})} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeftIcon className="size-4" />
          Lenders
        </button>
      )}
      {!selected && (
        <PageHeader
          eyebrow="Admin"
          title="Lenders"
          description="Your lenders, what they offer, and the matrices and guidelines Product Search uses."
          action={
            canEdit && (
              <Button onClick={() => setEditing(blankLender())}>
                <PlusIcon />
                Add lender
              </Button>
            )
          }
        />
      )}
      {lenders.isLoading ? (
        <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
      ) : lenders.error ? (
        <p className="py-12 text-center text-sm text-destructive">{lenders.error.message}</p>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState title="No lenders yet" description="Add a lender, then upload their matrix and guidelines." />
        </Card>
      ) : (
        selected ? <LenderDetail key={selected.id} lender={selected} canEdit={canEdit} onEdit={() => setEditing(toDraft(selected))} /> : <LenderList lenders={list} onOpen={pick} />
      )}
      {editing && <LenderDialog initial={editing} onClose={() => setEditing(null)} onSaved={pick} />}
    </>
  )
}

type DetailTab = 'products' | 'documents' | 'overlays' | 'contacts' | 'loans'

/** One lender (mockup 09): header and metrics, tabs for products, documents, overlays and notes, contacts and loans, and a side panel. */
function LenderDetail({ lender: l, canEdit, onEdit }: { lender: Lender; canEdit: boolean; onEdit: () => void }) {
  const programs = useLenderPrograms(l.id)
  const documents = useLenderDocuments(l.id)
  const catalog = useCatalog()
  const files = useLenderFiles(l.id)
  const versions = useLenderMatrixVersions(l.id)
  const contacts = useLenderContacts(l.id)
  const overlays = useLenderOverlays(l.id, l.programs.map((p) => p.id))
  const saveNotes = useSaveLenderNotes(l)
  const [tab, setTab] = useState<DetailTab>('products')
  const [uploading, setUploading] = useState(false)
  const today = todayIso()
  const year = Number(today.slice(0, 4))

  const catalogPrograms = (catalog.data?.programs ?? []).filter((p) => p.lenderId === l.id)
  const rows = catalogPrograms.map(productRow)
  const verifiedOn = catalog.data?.verifiedOn ?? new Map<string, string | null>()
  const counts = loanCounts(files.data ?? [], year)
  const update = lastMatrixUpdate(versions.data ?? [])
  const newestEffective = (versions.data ?? []).map((v) => v.current.approvedAt).filter((d): d is string => !!d).sort().at(-1) ?? null
  const verified = oldestVerified(l.programs.filter((p) => p.active))
  const stale = l.programs.some((p) => p.active) && isStale(verified, today)
  const docs = documents.data ?? []

  return (
    <>
      <LenderHeader
        lender={l}
        programs={l.programs.filter((p) => p.active).length}
        matrixDate={newestEffective ? { date: newestEffective, verified } : null}
        loans={{ closed: counts.closedThisYear, active: counts.active }}
        avgDays={averageDaysToClose((files.data ?? []).filter((f) => f.stage === 'closed'))}
        canEdit={canEdit}
        onEdit={onEdit}
        onUpload={() => setUploading(true)}
      />
      {l.status === 'not_signed_up' && <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">Not signed up: this lender's programs still show in Product Search, marked so you check with them first.</p>}
      {stale && <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">Stale matrix: {verified ? `last verified ${daysSince(verified, today)} days ago` : 'a program has never been verified'}. Upload the latest matrix to refresh it (over {STALE_AFTER_DAYS} days counts as stale).</p>}

      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <LenderTabs<DetailTab>
            value={tab}
            onChange={setTab}
            tabs={[
              { id: 'products', label: 'Products', count: rows.filter((r) => r.program.active).length },
              { id: 'documents', label: 'Documents', count: docs.length },
              { id: 'overlays', label: 'Overlays & notes' },
              { id: 'contacts', label: 'Contacts', count: 1 + (contacts.data?.length ?? 0) },
              { id: 'loans', label: 'Loans', count: files.data?.length ?? 0 },
            ]}
          />
          {tab === 'products' && (
            <>
              {catalog.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : (
                <ProductsTab rows={rows.filter((r) => r.program.active)} retired={rows.filter((r) => !r.program.active)} catalogLender={catalog.data?.lenders.find((x) => x.id === l.id) ?? null} lenderPrograms={programs.data ?? []} verifiedOn={verifiedOn} canEdit={canEdit} lenderId={l.id} />
              )}
              {docs.some((d) => d.current && d.passageCount > 0) && <LenderSearch documents={docs.filter((d) => d.current)} />}
            </>
          )}
          {tab === 'documents' && (
            <>
              <PendingImports lenderId={l.id} />
              <Card
                title="Documents"
                description="The lender's PDFs, stored privately. Their text is searchable by section, with page numbers."
                action={
                  canEdit && (
                    <div className="flex gap-2">
                      <TypeMatrixButton lenderId={l.id} documentId={null} label="Type a matrix" />
                      <Button size="sm" variant="outline" onClick={() => setUploading(true)}>
                        <UploadIcon />
                        Upload PDFs
                      </Button>
                    </div>
                  )
                }
              >
                {documents.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : <DocumentList lenderId={l.id} documents={docs} programs={programs.data ?? []} canEdit={canEdit} />}
              </Card>
            </>
          )}
          {tab === 'overlays' && <OverlaysTab lender={l} overlays={overlays.data ?? []} programs={l.programs} canEdit={canEdit} onSaveNotes={saveNotes} />}
          {tab === 'contacts' && <ContactsTab lender={l} canEdit={canEdit} onEditLender={onEdit} />}
          {tab === 'loans' && <LoansTab files={files.data ?? []} />}
        </div>
        <SidePanel lender={l} documents={docs} update={update} onAllDocuments={() => setTab('documents')} onNotes={() => setTab('overlays')} onContacts={() => setTab('contacts')} />
      </div>
      {uploading && <UploadDocumentDialog lenderId={l.id} programs={programs.data ?? []} documents={docs} onClose={() => setUploading(false)} />}
    </>
  )
}

function DocumentList({ lenderId, documents, programs, canEdit }: { lenderId: string; documents: LenderDocument[]; programs: LenderProgram[]; canEdit: boolean }) {
  const update = useUpdateLenderDocument(lenderId)
  const remove = useDeleteLenderDocument(lenderId)
  const [linking, setLinking] = useState<string | null>(null)
  const [reading, setReading] = useState<string | null>(null)
  const navigate = useNavigate()
  const ai = useAiStatus()
  const pending = usePendingImports(lenderId)
  /** A draft already started for a document (typed or read), so it is continued instead of started twice. */
  const draftFor = (id: string) => pending.data?.find((i) => i.documentId === id)?.id ?? null
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
                  {d.programIds.length === 0 &&
                    (draftFor(d.id) ? (
                      <Button size="sm" variant="outline" asChild>
                        <Link to={`/admin/lenders/imports/${draftFor(d.id)}`}>Continue setup</Link>
                      </Button>
                    ) : (
                      <SetUpProgramButton lenderId={lenderId} document={d} />
                    ))}
                  {d.docType === 'matrix' && d.programIds.length > 0 && <TypeMatrixButton lenderId={lenderId} documentId={d.id} label="Type it in" />}
                  {(d.docType === 'matrix' || d.docType === 'guidelines') && d.storagePath && (
                    <Button size="sm" variant="outline" disabled={reading !== null || aiOff} onClick={() => read(d)} title={aiOff ? 'Turns on once the AI assistant is set up (the Anthropic key in Supabase)' : 'The assistant reads every grid and rule; you review it against the PDF before anything is used'}>
                      {reading === d.id ? 'Reading… (a minute or two)' : 'Read with AI'}
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

/** For a document no program covers: guesses its product from the title and first pages (no AI) and opens a matrix draft for a new program beside it. */
function SetUpProgramButton({ lenderId, document: d }: { lenderId: string; document: LenderDocument }) {
  const { state } = useAuth()
  const start = useStartTypedMatrix(lenderId)
  const navigate = useNavigate()
  const [guessing, setGuessing] = useState(false)
  if (state.status !== 'signedIn' || !state.user.organizationId) return null
  const organizationId = state.user.organizationId
  const setUp = async () => {
    setGuessing(true)
    try {
      const guess = await guessStoredDocument(d)
      const id = await start.mutateAsync({ organizationId, documentId: d.id, program: programFromGuess(guess.product) })
      navigate(`/admin/lenders/imports/${id}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setGuessing(false)
    }
  }
  return (
    <Button size="sm" variant="outline" disabled={guessing} onClick={setUp} title="Starts a new program from this document (loan type, lien and terms filled in from it) for you to finish beside the PDF">
      <PlusIcon />
      {guessing ? 'Starting…' : 'Set up program'}
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
