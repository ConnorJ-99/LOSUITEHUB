// "Final Closing Disclosure" (Connor, 2026-11-19): at Approved / CTC (and on a
// closed file, for a corrected CD), upload the final CD; the assistant reads
// its figures with the words and page for each; the app checks those words
// against the PDF; Connor ticks fills and picks Replace or Keep for
// differences; Apply saves them in one step and plays them onto the file like
// AI Fill does; Undo puts the file back. Nothing changes without his click.
import { useRef, useState } from 'react'
import { CircleCheckIcon, FileUpIcon, ScanIcon, SparklesIcon, TriangleAlertIcon, UndoIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { AiOffNote, AssistantLabel, Card, ToggleChip, confirmAction } from '@/components/shared'
import { useAiStatus } from '@/lib/api/assistant'
import {
  useApplyCd,
  useCdFileValues,
  useCdPdfText,
  useCdReading,
  useDiscardCd,
  useUndoCd,
  useUploadAndReadCd,
  type CdReadingRecord,
} from '@/lib/api/closingDisclosure'
import { useLoanDocuments } from '@/lib/api/documents'
import { useLenders } from '@/lib/api/lenders'
import type { LoanProfile } from '@/lib/api/types'
import { loanRevenue } from '@/lib/calc'
import { CD_GROUPS, changesFor, checkQuotes, formatCdSaved, isUsed, reviewRows, undecided, type CdRow, type Decision } from '@/lib/closing/cdReview'
import { formatIsoDate, relativeTime } from '@/lib/dates'
import { resolveLender } from '@/lib/loans/numbers'
import { CD_FIELDS, type CdFieldKey } from '../../../supabase/functions/assistant/closingDisclosure'
import { cdDot } from '@/lib/closing/cdColors'
import { CdPlayback, type CdAnimItem } from './CdPlayback'

const TITLE = 'Final Closing Disclosure'
const LABEL = new Map<string, string>(CD_FIELDS.map((f) => [f.key, f.label]))

export function ClosingDisclosureCard({ loan }: { loan: LoanProfile }) {
  const reading = useCdReading(loan.id)
  // Kept here so the playback outlives the review it came from.
  const [playback, setPlayback] = useState<CdAnimItem[] | null>(null)
  const r = reading.data

  if (playback)
    return (
      <Card title={TITLE} action={<AssistantLabel />}>
        <CdPlayback items={playback} onDone={() => setPlayback(null)} />
      </Card>
    )
  if (reading.isLoading) return null
  if (r?.status === 'pending_review') return <Review key={r.id} loan={loan} reading={r} onApplied={setPlayback} />
  if (r?.status === 'applied' && !r.undoneAt) return <Applied loan={loan} reading={r} />
  return <Upload loan={loan} last={r ?? null} />
}

function Upload({ loan, last }: { loan: LoanProfile; last: CdReadingRecord | null }) {
  const ai = useAiStatus()
  const read = useUploadAndReadCd(loan.id, loan.organizationId)
  const docs = useLoanDocuments(loan.id, ['closing_disclosure'])
  const input = useRef<HTMLInputElement>(null)
  const newest = docs.data?.[0] ?? null

  if (ai.data?.ready === false)
    return (
      <Card title={TITLE} action={<AssistantLabel />}>
        <AiOffNote what="Reading the Closing Disclosure" reason={ai.data.reason} instead="Until then, type the final figures on this page and use Mark as Closed for the dates." />
      </Card>
    )

  const start = (args: { file?: File; documentId?: string }) =>
    read.mutate(args, {
      onSuccess: () => toast.success('Closing Disclosure read. Check each figure below.'),
      onError: (e) => toast.error(e.message),
    })

  return (
    <Card title={TITLE} description="Upload the final CD. The assistant reads its figures with the words and page for each, and you check them before anything on the file changes." action={<AssistantLabel />}>
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) start({ file })
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {read.isPending
            ? 'Reading the Closing Disclosure… about a minute.'
            : last?.undoneAt
              ? `The last CD was undone ${formatIsoDate(last.undoneAt.slice(0, 10))}.`
              : last?.status === 'discarded'
                ? 'The last reading was set aside.'
                : 'Takes about a minute. The PDF is sent to Claude (Anthropic) to read.'}
        </p>
        <div className="flex flex-wrap gap-2">
          {newest && (
            <Button variant="outline" onClick={() => start({ documentId: newest.id })} disabled={read.isPending}>
              <SparklesIcon />
              Read {newest.fileName.length > 28 ? `${newest.fileName.slice(0, 25)}…` : newest.fileName}
            </Button>
          )}
          <Button onClick={() => input.current?.click()} disabled={read.isPending}>
            <FileUpIcon />
            {read.isPending ? 'Reading…' : 'Upload final CD'}
          </Button>
        </div>
      </div>
    </Card>
  )
}

/** A corrected CD after one was applied: read it as a new reading (the applied one stays, with its Undo). */
function CorrectedCdButton({ loan }: { loan: LoanProfile }) {
  const read = useUploadAndReadCd(loan.id, loan.organizationId)
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input
        ref={input}
        type="file"
        accept="application/pdf,image/jpeg,image/png"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file)
            read.mutate(
              { file },
              {
                onSuccess: () => toast.success('Corrected CD read. Check each figure.'),
                onError: (err) => toast.error(err.message),
              },
            )
        }}
      />
      <Button variant="ghost" onClick={() => input.current?.click()} disabled={read.isPending}>
        <FileUpIcon />
        {read.isPending ? 'Reading… about a minute' : 'Upload a corrected CD'}
      </Button>
    </>
  )
}

function QuoteLine({ row }: { row: CdRow }) {
  if (!row.quote) return null
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {row.quoteStatus === 'found' && <CircleCheckIcon className="size-3.5 text-emerald-600" aria-label="Found in the PDF" />}
      {row.quoteStatus === 'missing' && <TriangleAlertIcon className="size-3.5 text-amber-600" aria-label="Not found in the PDF" />}
      {row.quoteStatus === 'unchecked' && <ScanIcon className="size-3.5" aria-label="Scanned: check by eye" />}
      <span className="italic">"{row.quote}"</span>
      {row.page && <span>· page {row.page}</span>}
      {row.quoteStatus === 'unchecked' && <span>· scanned, check by eye</span>}
    </p>
  )
}

function RowView({ row, decision, onDecide }: { row: CdRow; decision: Decision | undefined; onDecide: (d: Decision) => void }) {
  const used = isUsed(row, decision ? { [row.key]: decision } : {})
  return (
    <div className={cn('space-y-1 rounded-lg border px-3 py-2', used && 'border-primary/40 bg-primary/5')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">
          {row.label}
          {row.confidence !== 'high' && <span className="ml-2 align-middle"><AssistantLabel confidence={row.confidence} /></span>}
        </p>
        {row.state === 'fill' && <ToggleChip label={used ? 'Use' : 'Not used'} pressed={used} onChange={(p) => onDecide(p ? 'use' : 'keep')} />}
        {row.state === 'replace' && (
          <div className="flex gap-1.5">
            <Button size="sm" variant={decision === 'use' ? 'default' : 'outline'} onClick={() => onDecide('use')}>
              Replace
            </Button>
            <Button size="sm" variant={decision === 'keep' ? 'default' : 'outline'} onClick={() => onDecide('keep')}>
              Keep
            </Button>
          </div>
        )}
        {row.state === 'same' && <span className="text-xs font-medium text-emerald-700">Matches the file</span>}
        {row.state === 'check' && <span className="text-xs font-medium text-muted-foreground">To check only</span>}
        {row.state === 'cannot' && <span className="text-xs font-medium text-amber-700">Can't update here</span>}
      </div>
      <p className="text-sm tabular-nums">
        <span className="text-muted-foreground">CD:</span> <span className="font-medium">{row.cdText}</span>
        {row.state !== 'check' && (
          <>
            <span className="mx-2 text-muted-foreground">·</span>
            <span className="text-muted-foreground">File now:</span> {row.fileText}
          </>
        )}
      </p>
      <QuoteLine row={row} />
      {row.note && <p className={cn('text-xs', row.quoteStatus === 'missing' || row.state === 'cannot' ? 'text-amber-700' : 'text-muted-foreground')}>{row.note}</p>}
    </div>
  )
}

function Review({ loan, reading, onApplied }: { loan: LoanProfile; reading: CdReadingRecord; onApplied: (items: CdAnimItem[]) => void }) {
  const file = useCdFileValues(loan.id)
  const lenders = useLenders()
  const docs = useLoanDocuments(loan.id, ['closing_disclosure'])
  const doc = docs.data?.find((d) => d.id === reading.documentId) ?? null
  const text = useCdPdfText(doc)
  const apply = useApplyCd(loan.id)
  const discard = useDiscardCd(loan.id)
  const [decisions, setDecisions] = useState<Partial<Record<CdFieldKey, Decision>>>({})

  const waiting = file.isLoading || lenders.isLoading || docs.isLoading || (!!doc && text.isLoading)
  if (file.isError) return <Card title={TITLE}><p className="text-sm text-destructive">{file.error.message}</p></Card>
  if (waiting || !file.data)
    return (
      <Card title={TITLE} action={<AssistantLabel />}>
        <p className="text-sm text-muted-foreground">Checking the figures against the PDF…</p>
      </Card>
    )

  const quotes = checkQuotes(text.isError ? null : (text.data ?? null), reading.fields)
  const lender = resolveLender({ programLenderId: file.data.programLenderId, lenderId: file.data.lenderId, lenderNameTyped: file.data.lenderNameTyped }, lenders.data ?? [])
  const revenue = loan.compHidden ? null : loanRevenue(loan.details.loanAmount, loan.details.revenueType, loan.details.revenueValue).amount
  const rows = reviewRows(reading.fields, { values: file.data.values, hasHome: file.data.hasHome, lenderName: lender.name, lenderFromProgram: lender.from === 'program', lenders: lenders.data ?? [], revenue }, quotes)
  const changes = changesFor(rows, decisions)
  const open = undecided(rows, decisions)
  const busy = apply.isPending || discard.isPending

  const onApply = () =>
    apply.mutate(
      { readingId: reading.id, changes },
      {
        onSuccess: () => {
          toast.success(`Updated ${changes.length} figure${changes.length === 1 ? '' : 's'} from the final CD`)
          const byKey = new Map(rows.map((r) => [r.key, r]))
          onApplied(
            changes.map((c) => {
              const row = byKey.get(c.key)!
              return { key: c.key, group: row.group, raw: row.quote || row.cdText, label: `${row.label} · ${row.cdText}` }
            }),
          )
        },
        onError: (e) => toast.error(e.message),
      },
    )
  const onDiscard = async () => {
    if (!(await confirmAction('Set this reading aside? Nothing on the file changes.', { confirmLabel: 'Set aside' }))) return
    discard.mutate(reading.id, { onError: (e) => toast.error(e.message) })
  }

  return (
    <Card
      title={TITLE}
      description={`Read ${relativeTime(reading.createdAt)}${doc ? ` from ${doc.fileName}` : ''}. Nothing changes on the file until you apply. Check each figure's words against the CD.`}
      action={<AssistantLabel />}
    >
      <div className="space-y-4">
        {reading.notes && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <TriangleAlertIcon className="mr-1.5 inline size-4" />
            {reading.notes}
          </p>
        )}
        {CD_GROUPS.map((g) => {
          const inGroup = rows.filter((r) => r.group === g.id)
          if (!inGroup.length) return null
          return (
            <section key={g.id} className="space-y-2">
              <h4 className="flex items-center gap-1.5 text-xs font-bold tracking-widest text-muted-foreground uppercase">
                <span className={cn('size-2 rounded-full', cdDot(g.id))} />
                {g.label}
              </h4>
              {inGroup.map((row) => (
                <RowView key={row.key} row={row} decision={decisions[row.key]} onDecide={(d) => setDecisions((prev) => ({ ...prev, [row.key]: d }))} />
              ))}
            </section>
          )
        })}
        {reading.unreadable.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Couldn't read cleanly: {reading.unreadable.map((u) => `${LABEL.get(u.key) ?? u.key} ("${u.text}")`).join('; ')}.
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <p className="text-xs text-muted-foreground">{open.length > 0 ? `${open.length} difference${open.length === 1 ? '' : 's'} stay as the file has them unless you pick Replace.` : ' '}</p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onDiscard} disabled={busy}>
              Set aside
            </Button>
            <Button onClick={onApply} disabled={busy || changes.length === 0}>
              {apply.isPending ? 'Saving…' : changes.length ? `Apply ${changes.length} change${changes.length === 1 ? '' : 's'}` : 'Nothing to apply'}
            </Button>
          </div>
        </div>
      </div>
    </Card>
  )
}

function Applied({ loan, reading }: { loan: LoanProfile; reading: CdReadingRecord }) {
  const undo = useUndoCd(loan.id)
  const lenders = useLenders()
  const lenderName = (v: unknown) => (typeof v === 'string' ? (lenders.data?.find((l) => l.id === v)?.name ?? 'another lender') : '—')
  const shown = (key: string, target: string, v: unknown) => (target === 'loans.lender_id' ? lenderName(v) : formatCdSaved(key, v))

  const onUndo = async () => {
    if (!(await confirmAction('Put the file back as it was before this Closing Disclosure? A figure changed again since then is left as it is.', { confirmLabel: 'Undo' }))) return
    undo.mutate(reading.id, {
      onSuccess: (res) => {
        toast.success(`Put back ${res.restored} figure${res.restored === 1 ? '' : 's'}`)
        if (res.skipped.length) toast.warning(`Left as they are (changed since): ${res.skipped.join(', ')}`)
      },
      onError: (e) => toast.error(e.message),
    })
  }

  return (
    <Card title={TITLE} description={`Applied ${reading.decidedAt ? formatIsoDate(reading.decidedAt.slice(0, 10)) : ''}: ${reading.applied.length} figure${reading.applied.length === 1 ? '' : 's'} from the final CD.`} action={<AssistantLabel />}>
      <ul className="space-y-1 text-sm tabular-nums">
        {reading.applied.map((a) => (
          <li key={a.target} className="flex flex-wrap gap-x-2">
            <span className="font-medium">{a.label}</span>
            <span className="text-muted-foreground">
              {shown(a.key, a.target, a.before)} → <span className="text-foreground">{shown(a.key, a.target, a.after)}</span>
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <CorrectedCdButton loan={loan} />
        <Button variant="outline" onClick={onUndo} disabled={undo.isPending}>
          <UndoIcon />
          {undo.isPending ? 'Undoing…' : 'Undo'}
        </Button>
      </div>
    </Card>
  )
}
