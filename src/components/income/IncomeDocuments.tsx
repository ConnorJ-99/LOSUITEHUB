// "Income documents" on the Income tab (Stage 4d): the borrower's pay stubs,
// W-2s, bank statements and tax returns, each read by the assistant with
// "Analyze" (now, not waiting for the timer). Add one by uploading it here or
// by pulling a document already on the file (which sets its type and whose it
// is). Clicking a document (or finishing Analyze) opens the review: the
// document beside what was read, Calculate, and the drafts made from it.
import { useRef, useState } from 'react'
import { AlertCircleIcon, CheckCircle2Icon, FileTextIcon, Loader2Icon, PlusIcon, ScanTextIcon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, Select } from '@/components/shared'
import { useAnalyses, useAnalyzeNow, type Analysis } from '@/lib/api/analyses'
import { useAiStatus } from '@/lib/api/assistant'
import { ACCEPTED_TYPES, DOCUMENT_KIND_LABEL, useLoanDocuments, useUpdateDocument, useUploadDocument, type DocumentKind, type LoanDocument } from '@/lib/api/documents'
import type { IncomeWorksheet } from '@/lib/api/income'
import type { LoanProfile, Property } from '@/lib/api/types'
import type { ApplicationBorrower } from '@/lib/api/urla'
import { DocumentReview } from './DocumentReview'
import type { IncomePdfRequest } from './WorksheetCard'

/** The document types income is calculated from. */
const INCOME_DOC_KINDS: DocumentKind[] = ['paystub', 'w2', 'bank_statement', 'tax_return', 'business_return']
const KIND_OPTIONS = INCOME_DOC_KINDS.map((k) => ({ value: k, label: DOCUMENT_KIND_LABEL[k] }))
// The app's own PDFs are never income documents.
const NOT_PULLABLE: string[] = ['preapproval_letter', 'fee_worksheet', 'loan_comparison', 'quick_quote', 'prequal_results', 'income_analysis', 'mismo_file']

function StatusLine({ a, busy }: { a: Analysis | undefined; busy: boolean }) {
  if (busy || a?.status === 'analyzing') return <span className="flex items-center gap-1 text-primary"><Loader2Icon className="size-3.5 animate-spin" /> Reading…</span>
  if (!a) return <span className="text-muted-foreground">Not read yet</span>
  if (a.status === 'queued') return <span className="text-muted-foreground">Waiting to be read</span>
  if (a.status === 'failed') return <span className="flex items-center gap-1 text-destructive"><AlertCircleIcon className="size-3.5" /> Couldn't read it{a.lastError ? `: ${a.lastError}` : ''}</span>
  const n = Object.keys(a.fields).filter((k) => k !== 'deposits').length
  return (
    <span className="flex items-center gap-1 text-nurture">
      <CheckCircle2Icon className="size-3.5" />
      Read · {n} figure{n === 1 ? '' : 's'}{a.status === 'needs_review' ? ' · check it' : ''}
    </span>
  )
}

export function IncomeDocuments({
  loan,
  borrower,
  onlyBorrower,
  worksheets,
  properties,
  calculating,
  onCalculate,
  onPdf,
}: {
  loan: LoanProfile
  borrower: ApplicationBorrower
  onlyBorrower: boolean
  /** This borrower's worksheets (the review shows the drafts made from the document). */
  worksheets: IncomeWorksheet[]
  properties: Property[]
  calculating: boolean
  onCalculate: (only: 'wages' | 'bank_statement' | 'returns') => void
  onPdf: (v: IncomePdfRequest) => void
}) {
  const contactId = borrower.contactId
  const [reviewId, setReviewId] = useState<string | null>(null)
  const docs = useLoanDocuments(loan.id)
  const analyses = useAnalyses(loan.id)
  const ai = useAiStatus()
  const analyze = useAnalyzeNow(loan.id)
  const upload = useUploadDocument(loan.id, loan.organizationId)
  const update = useUpdateDocument(loan.id)
  const fileInput = useRef<HTMLInputElement>(null)
  const [uploadKind, setUploadKind] = useState<DocumentKind>('paystub')
  const [pulling, setPulling] = useState(false)
  const [pullId, setPullId] = useState('')
  const [pullKind, setPullKind] = useState<DocumentKind>('paystub')
  const [reading, setReading] = useState<Set<string>>(new Set())
  const fail = (e: Error) => toast.error(e.message)

  const all = docs.data ?? []
  // This borrower's income documents (unassigned ones count when there's one borrower).
  const mine = all.filter((d) => INCOME_DOC_KINDS.includes(d.kind) && (d.contactId === contactId || (d.contactId === null && onlyBorrower)))
  const pullable = all.filter((d) => !mine.some((m) => m.id === d.id) && !NOT_PULLABLE.includes(d.kind))
  const aiReady = ai.data?.ready === true

  const read = (doc: LoanDocument) => {
    setReading((s) => new Set(s).add(doc.id))
    analyze.mutate(doc.id, {
      onSuccess: () => {
        toast.success(`${doc.fileName} was read`)
        setReviewId(doc.id)
      },
      onError: fail,
      onSettled: () =>
        setReading((s) => {
          const next = new Set(s)
          next.delete(doc.id)
          return next
        }),
    })
  }

  const onFiles = (files: FileList | null) => {
    for (const file of Array.from(files ?? [])) {
      upload.mutate(
        { file, kind: uploadKind, contactId },
        {
          onSuccess: (id) => {
            toast.success(`${file.name} added`)
            if (id && aiReady) read({ id, fileName: file.name } as LoanDocument)
          },
          onError: fail,
        },
      )
    }
    if (fileInput.current) fileInput.current.value = ''
  }

  const pull = () => {
    const doc = pullable.find((d) => d.id === pullId)
    if (!doc) return
    update.mutate(
      { id: doc.id, kind: pullKind, contactId },
      {
        onSuccess: () => {
          toast.success(`${doc.fileName} added as a ${DOCUMENT_KIND_LABEL[pullKind].toLowerCase()}`)
          setPulling(false)
          setPullId('')
          if (aiReady && analyses.data?.get(doc.id)?.status !== 'ready') read(doc)
        },
        onError: fail,
      },
    )
  }

  return (
    <Card
      title="Income documents"
      description="Pay stubs, W-2s, bank statements and tax returns. Analyze reads each one; Calculate income then fills draft worksheets from what was read."
    >
      {analyses.data === null && <p className="mb-2 text-xs text-muted-foreground">Reading documents turns on once the document analyses database script has run.</p>}
      {ai.data && !ai.data.ready && <p className="mb-2 text-xs text-muted-foreground">Reading documents turns on once the AI key is added in Supabase. Until then, type the figures into a worksheet.</p>}
      {mine.length === 0 ? (
        <p className="text-sm text-muted-foreground">No income documents for this borrower yet. Upload one, or pull one already on the file.</p>
      ) : (
        <ul className="divide-y">
          {mine.map((d) => {
            const a = analyses.data?.get(d.id)
            const busy = reading.has(d.id)
            return (
              <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm first:pt-0 last:pb-0">
                <FileTextIcon className="size-4 shrink-0 text-muted-foreground" />
                <button type="button" className="min-w-0 flex-1 text-left" onClick={() => setReviewId(d.id)} title="Open it beside what was read">
                  <p className="truncate font-medium text-primary hover:underline">{d.fileName}</p>
                  <p className="text-xs">
                    <span className="text-muted-foreground">{DOCUMENT_KIND_LABEL[d.kind]} · </span>
                    <StatusLine a={a} busy={busy} />
                  </p>
                </button>
                {analyses.data !== null && aiReady && (
                  <Button size="xs" variant="outline" disabled={busy || a?.status === 'analyzing'} onClick={() => read(d)}>
                    <ScanTextIcon />
                    {a && a.status !== 'queued' ? 'Analyze again' : 'Analyze'}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap items-end gap-2 border-t pt-3">
        <div className="w-44">
          <Select label="Upload as" value={uploadKind} options={KIND_OPTIONS} onChange={(v) => setUploadKind(v as DocumentKind)} />
        </div>
        <input ref={fileInput} type="file" accept={ACCEPTED_TYPES.join(',')} multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
        <Button size="sm" variant="outline" disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
          <UploadIcon />
          {upload.isPending ? 'Uploading…' : 'Upload'}
        </Button>
        <Button size="sm" variant="outline" disabled={pullable.length === 0} onClick={() => setPulling((p) => !p)} title={pullable.length ? undefined : 'No other documents on this file'}>
          <PlusIcon />
          From the file's documents
        </Button>
      </div>
      {pulling && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg bg-muted/40 p-2.5">
          <div className="min-w-0 flex-1 basis-56">
            <Select label="Document" value={pullId || null} placeholder="Pick a document…" options={[...pullable.map((d) => ({ value: d.id, label: `${d.fileName} (${DOCUMENT_KIND_LABEL[d.kind] ?? d.kind})` }))]} onChange={setPullId} />
          </div>
          <div className="w-44">
            <Select label="It's a" value={pullKind} options={KIND_OPTIONS} onChange={(v) => setPullKind(v as DocumentKind)} />
          </div>
          <Button size="sm" disabled={!pullId || update.isPending} onClick={pull}>
            Add
          </Button>
        </div>
      )}
      {(() => {
        const doc = reviewId ? all.find((d) => d.id === reviewId) : null
        if (!doc) return null
        return (
          <DocumentReview
            loanId={loan.id}
            doc={doc}
            analysis={analyses.data?.get(doc.id)}
            borrower={borrower}
            worksheets={worksheets}
            properties={properties}
            subjectPropertyId={loan.details.subjectPropertyId}
            organizationId={loan.organizationId}
            canAnalyze={analyses.data !== null && aiReady}
            analyzing={reading.has(doc.id)}
            onAnalyze={() => read(doc)}
            calculating={calculating}
            onCalculate={onCalculate}
            onPdf={onPdf}
            onClose={() => setReviewId(null)}
          />
        )
      })()}
    </Card>
  )
}
