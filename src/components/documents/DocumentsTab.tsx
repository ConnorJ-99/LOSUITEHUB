import { useRef, useState } from 'react'
import { FileTextIcon, FolderIcon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, Select, ToggleChip, ToggleChipGroup } from '@/components/shared'
import {
  ACCEPTED_TYPES,
  DOCUMENT_KIND_GROUPS,
  openDocument,
  useDeleteDocument,
  useLoanDocuments,
  useUpdateDocument,
  useUploadDocument,
  type DocumentKind,
  type LoanDocument,
} from '@/lib/api/documents'
import { useProperties } from '@/lib/api/properties'
import type { LoanProfile } from '@/lib/api/types'
import { useApplication } from '@/lib/api/urla'
import { formatIsoDate } from '@/lib/dates'
import { RequestChecklist } from './RequestChecklist'

const KIND_OPTIONS = DOCUMENT_KIND_GROUPS.flatMap((g) => g.kinds.map(([value, label]) => ({ value: value as DocumentKind, label })))
const sizeLabel = (bytes: number | null) => (bytes === null ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`)
const NOBODY = '__nobody__'

type Person = { contactId: string; name: string }

function DocRow({ doc, people, loanId, home }: { doc: LoanDocument; people: Person[]; loanId: string; home: string | null }) {
  const update = useUpdateDocument(loanId)
  const remove = useDeleteDocument(loanId)
  const fail = (e: Error) => toast.error(e.message)
  return (
    <li className="grid gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_12rem_10rem_auto] sm:items-end">
      <div className="min-w-0">
        <button type="button" className="flex max-w-full items-center gap-2 text-left text-sm font-medium text-primary hover:underline" onClick={() => openDocument(doc).catch(fail)}>
          <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className="truncate">{doc.fileName}</span>
        </button>
        <p className="pl-6 text-xs text-muted-foreground">
          {sizeLabel(doc.sizeBytes)} · {formatIsoDate(doc.createdAt.slice(0, 10))}
          {home && ` · ${home}`}
        </p>
      </div>
      <Select label="What it is" value={doc.kind} options={KIND_OPTIONS} onChange={(kind) => update.mutate({ id: doc.id, kind }, { onError: fail })} />
      {people.length > 0 ? (
        <Select
          label="Whose"
          value={doc.contactId}
          placeholder="Not one person"
          options={people.map((p) => ({ value: p.contactId, label: p.name }))}
          onChange={(contactId) => update.mutate({ id: doc.id, contactId }, { onError: fail })}
          onClear={() => update.mutate({ id: doc.id, contactId: null }, { onError: fail })}
        />
      ) : (
        <span />
      )}
      <Button
        size="sm"
        variant="ghost"
        disabled={remove.isPending}
        onClick={() => window.confirm(`Delete ${doc.fileName}? The file is removed from LOSuite.`) && remove.mutate(doc, { onSuccess: () => toast.success('Deleted'), onError: fail })}
      >
        Delete
      </Button>
    </li>
  )
}

/**
 * Every document on the file: upload (pick what it is and whose first),
 * open, relabel and delete. Files are private to people who can see the loan.
 */
export function DocumentsTab({ loan }: { loan: LoanProfile }) {
  const docs = useLoanDocuments(loan.id)
  const app = useApplication(loan.id)
  const properties = useProperties(loan.id)
  const homeOf = (id: string | null) => (properties.data ?? []).find((p) => p.id === id)?.addressLine ?? null
  const upload = useUploadDocument(loan.id, loan.organizationId)
  const input = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState<DocumentKind>('other')
  const [whose, setWhose] = useState<string>(loan.borrower?.id ?? NOBODY)
  const [filter, setFilter] = useState<string>('all')
  const [dragging, setDragging] = useState(false)

  const people: Person[] = (app.data?.borrowers ?? []).map((b) => ({ contactId: b.contactId, name: `${b.person.firstName} ${b.person.lastName}`.trim() }))
  const list = docs.data ?? []
  const shown = list.filter((d) => filter === 'all' || (filter === NOBODY ? !d.contactId : d.contactId === filter))
  const groups = DOCUMENT_KIND_GROUPS.map((g) => ({ label: g.label, docs: shown.filter((d) => g.kinds.some(([k]) => k === d.kind)) })).filter((g) => g.docs.length)

  const add = async (files: FileList | File[] | null) => {
    if (!files || files.length === 0) return
    for (const file of Array.from(files)) {
      try {
        await upload.mutateAsync({ file, kind, contactId: whose === NOBODY ? null : whose })
        toast.success(`Uploaded ${file.name}`)
      } catch (e) {
        toast.error((e as Error).message)
      }
    }
    if (input.current) input.current.value = ''
  }

  return (
    <div className="space-y-4">
      <RequestChecklist loan={loan} docs={list} people={people} />

      <Card
        title="Upload"
        description="Pick what the files are and whose they are, then choose or drop them here. PDFs or photos, up to 25 MB each."
      >
        <div
          className={cn('space-y-3 rounded-lg border-2 border-dashed p-3 transition-colors', dragging && 'border-primary bg-primary/5')}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            add(e.dataTransfer.files)
          }}
        >
          <div className="grid gap-3 sm:grid-cols-[14rem_12rem_auto] sm:items-end">
            <Select label="What they are" value={kind} options={KIND_OPTIONS} onChange={setKind} />
            {people.length > 0 && (
              <Select label="Whose" value={whose} options={[...people.map((p) => ({ value: p.contactId, label: p.name })), { value: NOBODY, label: 'Not one person' }]} onChange={setWhose} />
            )}
            <Button onClick={() => input.current?.click()} disabled={upload.isPending}>
              <UploadIcon />
              {upload.isPending ? 'Uploading…' : 'Choose files'}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Or drag files onto this box.</p>
        </div>
        <input ref={input} type="file" className="hidden" accept={ACCEPTED_TYPES.join(',')} multiple onChange={(e) => add(e.target.files)} />
      </Card>

      <Card title={`Documents${list.length ? ` (${list.length})` : ''}`} description="Everything on this file, by type. Click a name to open it.">
        {people.length > 1 && list.length > 0 && (
          <ToggleChipGroup className="mb-3">
            <ToggleChip label="Everyone" pressed={filter === 'all'} onChange={() => setFilter('all')} />
            {people.map((p) => (
              <ToggleChip key={p.contactId} label={p.name} pressed={filter === p.contactId} onChange={() => setFilter(p.contactId)} />
            ))}
            <ToggleChip label="Not one person" pressed={filter === NOBODY} onChange={() => setFilter(NOBODY)} />
          </ToggleChipGroup>
        )}
        {docs.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : docs.isError ? (
          <p className="text-sm text-destructive">{docs.error.message}</p>
        ) : list.length === 0 ? (
          <EmptyState icon={FolderIcon} title="No documents yet" description="Upload pay stubs, statements, IDs and anything else for this file." />
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No documents for this person yet.</p>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <section key={g.label}>
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                  {g.label} ({g.docs.length})
                </h3>
                <ul className="divide-y">
                  {g.docs.map((d) => (
                    <DocRow key={d.id} doc={d} people={people} loanId={loan.id} home={homeOf(d.propertyId)} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
