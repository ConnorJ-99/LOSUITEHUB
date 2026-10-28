import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { FileTextIcon, UploadIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DateInput, FormGrid, Input, Select, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { useAiStatus } from '@/lib/api/assistant'
import { keys } from '@/lib/api/client'
import { prepareGuidelineFile, useUploadGuidelineDocument, type LenderDocument, type LenderProgram, type PreparedFile } from '@/lib/api/lenders'
import { readMatrix, useStartTypedMatrix } from '@/lib/api/matrixImports'
import type { GuidelineDocument } from '@/lib/api/products'
import { useAuth } from '@/lib/auth/context'
import { matchPrograms, productName } from '@/lib/products/docGuess'
import { LIENS, PRODUCT_FAMILIES, termsSummary } from '@/lib/products/taxonomy'
import { programFromGuess } from '@/lib/products/typedMatrix'
import { MAX_MATRIX_BYTES } from '../../../supabase/functions/assistant/matrix'

const DOC_TYPE_OPTIONS: { value: GuidelineDocument['docType']; label: string }[] = [
  { value: 'matrix', label: 'Matrix' },
  { value: 'guidelines', label: 'Guidelines' },
  { value: 'overlay_bulletin', label: 'Overlay bulletin' },
  { value: 'rate_sheet', label: 'Rate sheet' },
]

interface Row {
  key: string
  fileName: string
  prepared: PreparedFile | null
  error: string | null
  docType: GuidelineDocument['docType']
  title: string
  versionLabel: string
  effectiveDate: string | null
  programIds: string[]
  replacesId: string | null
  /** Set up a new program for it after upload (no matching program). */
  setUp: boolean
}

/** The current document this one most likely replaces: same kind, and the same programs or the same product name. */
function replaced(prepared: PreparedFile, programIds: string[], documents: LenderDocument[]): string | null {
  const name = productName(prepared.guess.title).toLowerCase()
  const same = documents.filter((d) => d.current && d.docType === prepared.guess.docType && ((programIds.length > 0 && programIds.every((id) => d.programIds.includes(id))) || productName(d.title).toLowerCase() === name))
  return same[0]?.id ?? null
}

/**
 * Upload one or more lender PDFs. Each is read in the browser first: its kind,
 * version, effective date and loan product are guessed (no AI) and it's linked
 * to the lender's matching programs, all editable before upload. Afterwards the
 * assistant reads each matrix or guideline when it's set up; otherwise a PDF with
 * no matching program gets a typed draft for a new program, beside the PDF.
 */
export function UploadDocumentDialog({ lenderId, programs, documents, onClose }: { lenderId: string; programs: LenderProgram[]; documents: LenderDocument[]; onClose: () => void }) {
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  const upload = useUploadGuidelineDocument(lenderId)
  const startTyped = useStartTypedMatrix(lenderId)
  const ai = useAiStatus()
  const aiReady = ai.data?.ready === true
  const queryClient = useQueryClient()
  const [rows, setRows] = useState<Row[]>([])
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const setRow = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const addFiles = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`
      setRows((rs) => [...rs, { key, fileName: file.name, prepared: null, error: null, docType: 'guidelines', title: '', versionLabel: '', effectiveDate: null, programIds: [], replacesId: null, setUp: false }])
      prepareGuidelineFile(lenderId, file).then(
        (prepared) => {
          const g = prepared.guess
          const programIds = matchPrograms(g.product, programs)
          setRow(key, { prepared, docType: g.docType, title: g.title, versionLabel: g.versionLabel ?? '', effectiveDate: g.effectiveDate, programIds, replacesId: replaced(prepared, programIds, documents), setUp: programIds.length === 0 && g.docType !== 'rate_sheet', error: prepared.duplicateOf ? `Already uploaded as "${prepared.duplicateOf}".` : null })
        },
        (e: Error) => setRow(key, { error: e.message }),
      )
    }
  }

  const ready = rows.filter((r) => r.prepared && !r.error)
  const reading = rows.some((r) => !r.prepared && !r.error)

  const submit = async () => {
    if (!orgId) return toast.error('Not signed in to a company.')
    setBusy(true)
    let uploaded = 0
    for (const r of ready) {
      try {
        const { documentId } = await upload.mutateAsync({ lenderId, prepared: r.prepared!, docType: r.docType, title: r.title, versionLabel: r.versionLabel.trim() || null, effectiveDate: r.effectiveDate, programIds: r.programIds, replacesId: r.replacesId })
        uploaded++
        const readable = (r.docType === 'matrix' || r.docType === 'guidelines') && r.prepared!.file.size <= MAX_MATRIX_BYTES
        if (aiReady && readable) {
          // The assistant reads it in the background; the result waits for review.
          toast.info(`The assistant is reading "${r.title}". It will show under "Waiting for your review" (a minute or two).`)
          readMatrix(documentId).then(
            () => {
              queryClient.invalidateQueries({ queryKey: keys.lenderImports(lenderId) })
              toast.success(`"${r.title}" is ready for your review.`)
            },
            (e: Error) => toast.error(`${r.title}: ${e.message}`),
          )
        } else if (r.setUp) {
          await startTyped.mutateAsync({ organizationId: orgId, documentId, program: programFromGuess(r.prepared!.guess.product) })
        }
      } catch (e) {
        setRow(r.key, { error: (e as Error).message })
      }
    }
    setBusy(false)
    if (uploaded) toast.success(`Uploaded ${uploaded} document${uploaded === 1 ? '' : 's'}`)
    if (uploaded === ready.length) onClose()
    else setRows((rs) => rs.filter((r) => r.error))
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Upload lender documents</DialogTitle>
          <DialogDescription>Drop one or more matrix or guideline PDFs. Each is read first: its kind, version, date and loan product are filled in and it's linked to the matching programs. Check them, then upload.</DialogDescription>
        </DialogHeader>

        <label
          onDragOver={(e) => (e.preventDefault(), setDragging(true))}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            addFiles(e.dataTransfer.files)
          }}
          className={cn('flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center text-sm text-muted-foreground', dragging && 'border-primary bg-accent')}
        >
          <UploadIcon className="size-5" />
          <span>
            <span className="font-medium text-foreground">Drop PDFs here</span> or click to pick them
          </span>
          <input type="file" accept="application/pdf,.pdf" multiple className="sr-only" onChange={(e) => (e.target.files && addFiles(e.target.files), (e.target.value = ''))} />
        </label>

        <ul className="space-y-3">
          {rows.map((r) => {
            const g = r.prepared?.guess
            const replaceable = documents.filter((d) => d.current && d.docType === r.docType)
            return (
              <li key={r.key} className={cn('rounded-lg border p-3', r.error && 'border-destructive/40')}>
                <div className="mb-2 flex items-center gap-2 text-sm">
                  <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate font-medium">{r.fileName}</span>
                  {r.prepared && <span className="text-xs text-muted-foreground">{r.prepared.pageCount} page{r.prepared.pageCount === 1 ? '' : 's'} · {r.prepared.passages.length} section{r.prepared.passages.length === 1 ? '' : 's'}</span>}
                  <button type="button" aria-label={`Remove ${r.fileName}`} className="rounded p-1 hover:bg-muted" disabled={busy} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                    <XIcon className="size-4" />
                  </button>
                </div>
                {r.error ? (
                  <p className="text-sm text-destructive">{r.error}</p>
                ) : !r.prepared || !g ? (
                  <p className="text-sm text-muted-foreground">Reading…</p>
                ) : (
                  <div className="space-y-2">
                    <FormGrid className="lg:grid-cols-4">
                      <Select label="Type" value={r.docType} options={DOC_TYPE_OPTIONS} onChange={(docType) => setRow(r.key, { docType })} />
                      <Input label="Title" value={r.title} onChange={(title) => setRow(r.key, { title })} span={3} />
                      <Input label="Version" value={r.versionLabel} onChange={(versionLabel) => setRow(r.key, { versionLabel })} placeholder="rev. 09/2026" span={2} />
                      <DateInput label="Effective date" value={r.effectiveDate} onChange={(effectiveDate) => setRow(r.key, { effectiveDate })} span={2} />
                      {replaceable.length > 0 && (
                        <Select label="Replaces" value={r.replacesId} options={replaceable.map((d) => ({ value: d.id, label: `${d.title}${d.versionLabel ? ` (${d.versionLabel})` : ''}` }))} onChange={(replacesId) => setRow(r.key, { replacesId })} onClear={() => setRow(r.key, { replacesId: null })} placeholder="Nothing (a new document)" span={4} />
                      )}
                    </FormGrid>
                    <p className="text-xs text-muted-foreground">
                      Looks like: {g.product.name} · {PRODUCT_FAMILIES.label[g.product.family]} · {LIENS.label[g.product.lien]}
                      {g.product.termOptions.length > 0 && ` · ${termsSummary(g.product.termOptions)}`}
                      {g.product.basis === 'none' && ' (a guess: the file name and first pages don’t say)'}
                    </p>
                    {programs.length > 0 && (
                      <div>
                        <p className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Programs this covers</p>
                        <ToggleChipGroup>
                          {programs.map((p) => (
                            <ToggleChip key={p.id} label={p.name} pressed={r.programIds.includes(p.id)} onChange={(on) => setRow(r.key, { programIds: on ? [...r.programIds, p.id] : r.programIds.filter((x) => x !== p.id), setUp: false })} />
                          ))}
                        </ToggleChipGroup>
                      </div>
                    )}
                    {r.programIds.length === 0 && (
                      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
                        <span>
                          No matching program.{' '}
                          {aiReady && (r.docType === 'matrix' || r.docType === 'guidelines')
                            ? 'After upload the assistant reads it and proposes the program for your review.'
                            : r.setUp
                              ? `After upload, a draft for a new program "${g.product.name}" (${LIENS.label[g.product.lien]}) opens under "Waiting for your review" for you to fill in beside the PDF.`
                              : 'It will be stored and searchable, but not linked to a program.'}
                        </span>
                        {!(aiReady && (r.docType === 'matrix' || r.docType === 'guidelines')) && <ToggleChip label="Set up a new program" pressed={r.setUp} onChange={(setUp) => setRow(r.key, { setUp })} />}
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || reading || ready.length === 0}>
            {busy ? 'Uploading…' : reading ? 'Reading files…' : `Upload ${ready.length || ''} ${ready.length === 1 ? 'document' : 'documents'}`.replace('  ', ' ')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
