// The Income tab's document review (Stage 4d-2): full screen, the document on
// the left and on the right what the assistant read (click a figure to jump
// to it on the page, highlighted), "Calculate income" for this kind of
// document, and the draft worksheets made from it, to check and Accept right
// there. Phone: two tabs, Document and What it read.
import { useState } from 'react'
import { Loader2Icon, ScanTextIcon, SparklesIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { DocumentViewer, type ViewerTarget } from '@/components/documents/DocumentViewer'
import { toast } from 'sonner'
import { useAddEmployerFromUpload, type Analysis } from '@/lib/api/analyses'
import { DOCUMENT_KIND_LABEL, type LoanDocument } from '@/lib/api/documents'
import type { IncomeWorksheet } from '@/lib/api/income'
import type { Property } from '@/lib/api/types'
import type { ApplicationBorrower } from '@/lib/api/urla'
import { formatIsoDate } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'
import { incomeKindOf, unmatchedEmployers } from '@/lib/income/fromDocuments'
import { fullName } from '@/lib/pipeline/helpers'
import { READ_FIELDS, type ReadField } from '../../../supabase/functions/assistant/documentRead'
import { WorksheetCard, type IncomePdfRequest } from './WorksheetCard'

const FREQUENCY: Record<string, string> = { weekly: 'Weekly', biweekly: 'Biweekly', semi_monthly: 'Semi-monthly', monthly: 'Monthly', annual: 'Annual' }

/** A read value as it reads on the page. */
function shown(type: string, f: ReadField): string {
  if (type === 'money' && typeof f.value === 'number') return formatCurrency(f.value)
  if (type === 'date' && typeof f.value === 'string') return formatIsoDate(f.value)
  if (type === 'frequency') return FREQUENCY[String(f.value)] ?? String(f.value)
  if (type === 'pct') return `${f.value}%`
  return String(f.value)
}

export function DocumentReview({
  loanId,
  doc,
  analysis,
  borrower,
  worksheets,
  properties,
  subjectPropertyId,
  organizationId,
  canAnalyze,
  analyzing,
  onAnalyze,
  calculating,
  onCalculate,
  onPdf,
  onClose,
}: {
  loanId: string
  doc: LoanDocument
  analysis: Analysis | undefined
  borrower: ApplicationBorrower
  worksheets: IncomeWorksheet[]
  properties: Property[]
  subjectPropertyId: string | null
  organizationId: string
  canAnalyze: boolean
  analyzing: boolean
  onAnalyze: () => void
  calculating: boolean
  onCalculate: (only: 'wages' | 'bank_statement' | 'returns') => void
  onPdf: (v: IncomePdfRequest) => void
  onClose: () => void
}) {
  const [target, setTarget] = useState<ViewerTarget | null>(null)
  const [tab, setTab] = useState<'document' | 'read'>('read')
  const [openId, setOpenId] = useState<string | null>(null)
  const read = analysis && (analysis.status === 'ready' || analysis.status === 'needs_review') ? READ_FIELDS.filter((d) => analysis.fields[d.key]) : []
  const kind = doc.kind !== 'other' ? doc.kind : (analysis?.suggestedKind ?? 'other')
  const only = incomeKindOf(kind)
  // The drafts made from this document.
  const fromThis = worksheets.filter((w) => w.sourceDocumentIds.includes(doc.id))
  const busy = analyzing || analysis?.status === 'analyzing'
  const addJob = useAddEmployerFromUpload(loanId)
  // A pay stub or W-2 from an employer that isn't a current job on the 1003 is left out of the calculation: offer to add it.
  const jobs = borrower.employments.map((e) => ({ id: e.id, employerName: e.employerName, current: e.status === 'current', selfEmployed: e.isSelfEmployed, startDate: e.startDate, endDate: e.endDate }))
  const missingEmployer = analysis && read.length ? (unmatchedEmployers([{ documentId: doc.id, fileName: doc.fileName, kind, fields: analysis.fields }], jobs)[0] ?? null) : null
  const addEmployer = () =>
    analysis &&
    missingEmployer &&
    addJob.mutate(
      { analysis, organizationId, contactId: borrower.contactId, employer: missingEmployer, current: true },
      { onSuccess: () => toast.success(`${missingEmployer} added to ${borrower.person.firstName}'s 1003 as a current job`), onError: (e) => toast.error(e.message) },
    )

  const jumpTo = (s: { page?: number; quote: string; value: string | number | null }) => {
    setTarget((t) => ({ page: s.page ?? null, quote: s.quote, value: s.value, nonce: (t?.nonce ?? 0) + 1 }))
    setTab('document')
  }
  const jump = (f: ReadField) => {
    setTarget((t) => ({ page: f.page ?? null, quote: f.quote, value: f.value, nonce: (t?.nonce ?? 0) + 1 }))
    setTab('document')
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[94svh] max-h-[94svh] w-[98vw] max-w-[98vw] flex-col gap-3 p-3 sm:max-w-[min(1500px,98vw)] sm:p-4">
        <div className="pr-8">
          <DialogDescription className="text-xs">{fullName(borrower.person)}</DialogDescription>
          <DialogTitle className="text-lg font-bold">
            {DOCUMENT_KIND_LABEL[kind as LoanDocument['kind']] ?? 'Document'} <span className="text-sm font-normal text-muted-foreground">· {doc.fileName}</span>
          </DialogTitle>
        </div>

        {/* Phone: one side at a time. */}
        <div className="flex rounded-lg bg-muted p-0.5 text-sm lg:hidden">
          {(['document', 'read'] as const).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)} className={cn('flex-1 rounded-md py-1.5', tab === t ? 'bg-white font-semibold shadow-sm' : 'text-muted-foreground')}>
              {t === 'document' ? 'Document' : 'What it read'}
            </button>
          ))}
        </div>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,30rem)]">
          <div className={cn('min-h-0', tab === 'document' ? 'flex' : 'hidden', 'lg:flex')}>
            <div className="h-full w-full">
              <DocumentViewer doc={doc} target={target} />
            </div>
          </div>

          <div className={cn('min-h-0 flex-col gap-3 overflow-y-auto pr-1', tab === 'read' ? 'flex' : 'hidden', 'lg:flex')}>
            <div className="rounded-lg border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">What it read</p>
                {canAnalyze && (
                  <Button size="xs" variant="outline" disabled={busy} onClick={onAnalyze}>
                    {busy ? <Loader2Icon className="animate-spin" /> : <ScanTextIcon />}
                    {busy ? 'Reading…' : read.length ? 'Analyze again' : 'Analyze'}
                  </Button>
                )}
              </div>
              {busy && read.length === 0 && <p className="text-sm text-muted-foreground">Reading the document… this takes about 20 seconds.</p>}
              {!busy && !analysis && <p className="text-sm text-muted-foreground">Not read yet. Press Analyze.</p>}
              {analysis?.status === 'failed' && <p className="text-sm text-destructive">Couldn't read it{analysis.lastError ? `: ${analysis.lastError}` : ''}</p>}
              {read.length > 0 && (
                <ul className="divide-y text-sm">
                  {read.map((d) => {
                    const f = analysis!.fields[d.key]!
                    return (
                      <li key={d.key}>
                        <button type="button" onClick={() => jump(f)} className="flex w-full items-baseline gap-3 py-1.5 text-left hover:bg-muted/50" title={`"${f.quote}"`}>
                          <span className="w-40 shrink-0 text-xs text-muted-foreground">{d.label}</span>
                          <span className="min-w-0 flex-1 font-medium tabular-nums">{shown(d.type, f)}</span>
                          <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] text-muted-foreground">{f.page ? `p.${f.page}` : 'show'}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              {read.length > 0 && <p className="mt-2 text-[11px] text-muted-foreground">Click a figure to see it on the document.</p>}
            </div>

            {missingEmployer && (
              <div className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
                <p>
                  <b>{missingEmployer}</b> isn't a current job on {borrower.person.firstName}'s 1003, so this document is left out of the calculation.
                </p>
                <Button size="xs" className="mt-2" disabled={addJob.isPending} onClick={addEmployer}>
                  Add it as a current job
                </Button>
              </div>
            )}
            {only && read.length > 0 && (
              <Button className="bg-money text-white hover:bg-money/90" disabled={calculating} onClick={() => onCalculate(only)}>
                <SparklesIcon />
                {calculating ? 'Calculating…' : fromThis.length ? 'Calculate again' : 'Calculate income from this'}
              </Button>
            )}

            {fromThis.length > 0 && (
              <ul className="space-y-3">
                {fromThis.map((w) => (
                  <WorksheetCard
                    key={w.id}
                    worksheet={w}
                    borrower={borrower}
                    properties={properties}
                    subjectPropertyId={subjectPropertyId}
                    organizationId={organizationId}
                    open={openId === w.id || (openId === null && fromThis[0].id === w.id)}
                    onToggle={() => setOpenId((id) => (id === w.id ? '' : w.id))}
                    onPdf={onPdf}
                    onSource={(s) => (s.documentId === doc.id ? jumpTo(s) : undefined)}
                  />
                ))}
              </ul>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
