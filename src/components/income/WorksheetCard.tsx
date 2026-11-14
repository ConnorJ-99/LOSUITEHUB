import { useState } from 'react'
import { CheckCircle2Icon, ChevronDownIcon, FileTextIcon, SendIcon, SparklesIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { FormGrid, Input, Select } from '@/components/shared'
import { useDeleteWorksheet, usePushWorksheet, useSaveInputSources, useSaveWorksheet, type IncomeWorksheet, type WorksheetDraft } from '@/lib/api/income'
import { useAuth } from '@/lib/auth/context'
import type { InputSource } from '@/lib/income/fromDocuments'
import { checkProgress, figureLabel, figures, withChecked } from '@/lib/income/review'
import { reconcileJob } from '@/lib/income/reconcile'
import { useAnalyses } from '@/lib/api/analyses'
import { todayIso } from '@/lib/dates'
import { SourceChip } from './SourceChip'
import { SourceContext } from './sourceContext'
import type { Property } from '@/lib/api/types'
import type { ApplicationBorrower } from '@/lib/api/urla'
import { relativeTime } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'
import {
  computeWorksheet,
  currentTargetValue,
  differsFrom1003,
  kindLabel,
  normalizeInputs,
  pushError,
  pushTarget,
  pushValue,
  rentalNet,
  suggestedLabel,
  type WorksheetData,
} from '@/lib/income/worksheets'
import { ownedProperties } from '@/lib/urla/realEstate'
import { openDocument, useLoanDocuments } from '@/lib/api/documents'
import { CalcLines, Warnings } from './CalcLines'
import { WorksheetInputs } from './WorksheetForms'

const NEW_JOB = '__new'

export interface IncomePdfRequest {
  label: string
  typeLabel: string
  where: string | null
  result: ReturnType<typeof computeWorksheet>
  notes: string[]
  sources: string[]
  draft: boolean
  pushedOn: string | null
  /** v2 (Stage 4d-3): each figure's source, what was changed, and who checked it. */
  figureSources: { figure: string; document: string; page: number | null; quote: string }[]
  changes: { figure: string; aiValue: string; newValue: string }[]
  reviewedBy: { id: string; at: string } | null
}

const figureText = (v: unknown) => (typeof v === 'number' ? (Math.abs(v) >= 100 ? formatCurrency(v) : String(v)) : String(v ?? '—'))

interface Draft {
  label: string
  data: WorksheetData
  employmentId: string | null
  propertyId: string | null
  newEmployerName: string
}

const toDraft = (w: IncomeWorksheet): Draft => ({
  label: w.label ?? '',
  data: { kind: w.kind, inputs: normalizeInputs(w.kind, w.inputs) } as WorksheetData,
  employmentId: w.employmentId,
  propertyId: w.propertyId,
  newEmployerName: '',
})

/** One income worksheet: inputs, the math line by line, warnings, and "Push to 1003". */
export function WorksheetCard({
  worksheet,
  borrower,
  properties,
  subjectPropertyId,
  organizationId,
  open,
  onToggle,
  onPdf,
  onSource,
}: {
  worksheet: IncomeWorksheet
  borrower: ApplicationBorrower
  properties: Property[]
  subjectPropertyId: string | null
  organizationId: string
  open: boolean
  onToggle: () => void
  /** Saves the one-page Income Analysis PDF (Stage 4). */
  onPdf?: (v: IncomePdfRequest) => void
  /** Shows a figure on its document (the review screen); else the document opens in a new tab on that page. */
  onSource?: (s: InputSource) => void
}) {
  const save = useSaveWorksheet(worksheet.loanId)
  const saveSources = useSaveInputSources(worksheet.loanId)
  const analyses = useAnalyses(worksheet.loanId)
  const { state } = useAuth()
  const me = state.status === 'signedIn' ? state.user.id : 'me'
  const push = usePushWorksheet(worksheet.loanId, organizationId)
  const remove = useDeleteWorksheet(worksheet.loanId)
  const [draft, setDraft] = useState<Draft>(() => toDraft(worksheet))
  const [confirmDelete, setConfirmDelete] = useState(false)
  const isDraft = worksheet.status === 'draft'
  const docs = useLoanDocuments(worksheet.loanId)
  const sources = worksheet.sourceDocumentIds.map((id) => docs.data?.find((d) => d.id === id)).filter((d): d is NonNullable<typeof d> => !!d)

  const result = computeWorksheet(draft.data)
  // Stage 4d-2: the figures read from documents, each checked or changed before Accept.
  const figs = figures(worksheet.inputSources, draft.data.inputs)
  const progress = checkProgress(figs)
  const recentYear = (draft.data.inputs as { recentYear?: number | null }).recentYear ?? null
  // Stage 4d-3: the job's pay stubs and W-2s this worksheet used, compared (warnings never block Accept).
  const job = borrower.employments.find((e) => e.id === draft.employmentId) ?? null
  const usedDocs = worksheet.sourceDocumentIds.flatMap((id) => {
    const d = docs.data?.find((x) => x.id === id)
    const a = analyses.data?.get(id)
    return d && a ? [{ documentId: id, fileName: d.fileName, kind: d.kind !== 'other' ? d.kind : (a.suggestedKind ?? 'other'), fields: a.fields }] : []
  })
  const docWarnings = job && !job.isSelfEmployed && usedDocs.length ? reconcileJob({ docs: usedDocs, job: { employerName: job.employerName, startDate: job.startDate }, today: todayIso() }) : []
  const showSource = (s: InputSource) => {
    if (onSource) return onSource(s)
    const d = docs.data?.find((x) => x.id === s.documentId)
    if (d) void openDocument(d, s.page).catch((e: Error) => toast.error(e.message))
  }
  const tick = (path: string, checked: boolean) =>
    saveSources.mutate({ id: worksheet.id, inputSources: withChecked(worksheet.inputSources, path, checked, me, new Date().toISOString()) }, { onError: (e) => toast.error(e.message) })
  const target = pushTarget(draft.data)
  const value = pushValue(draft.data, result)
  const jobs = borrower.employments.filter((e) => e.status === 'current')
  const employment = jobs.find((e) => e.id === draft.employmentId) ?? null
  const rentals = ownedProperties(properties)
  const property = rentals.find((p) => p.id === draft.propertyId) ?? null
  const current = currentTargetValue(target, employment, property)
  const differs = differsFrom1003(current, value)
  const blocked = pushError(target, value)
  const isRental = draft.data.kind === 'rental'
  const net = isRental && property ? rentalNet(draft.data.inputs as Extract<WorksheetData, { kind: 'rental' }>['inputs'], result, property) : null

  const saved = toDraft(worksheet)
  const dirty = JSON.stringify({ ...draft, newEmployerName: '' }) !== JSON.stringify(saved) || draft.newEmployerName.trim() !== ''
  const savePayload = (): WorksheetDraft => ({
    label: draft.label,
    inputs: draft.data.inputs,
    resultMonthly: result.monthly,
    employmentId: draft.employmentId,
    propertyId: isRental ? draft.propertyId : null,
  })
  /** The automatic label for a draft's job or property. */
  const autoLabel = (d: Draft) =>
    suggestedLabel(
      d.data.kind,
      jobs.find((e) => e.id === d.employmentId) ?? (d.newEmployerName.trim() ? { employerName: d.newEmployerName.trim() } : null),
      rentals.find((p) => p.id === d.propertyId) ?? null,
    )
  /** Changes the job or property, and the label with it unless the LO typed their own. */
  const retarget = (changes: Partial<Pick<Draft, 'employmentId' | 'propertyId' | 'newEmployerName'>>) =>
    setDraft((d) => {
      const next = { ...d, ...changes }
      return !d.label || d.label === autoLabel(d) ? { ...next, label: autoLabel(next) } : next
    })
  const missingTarget = isRental ? !property : !employment && !draft.newEmployerName.trim()

  const onSave = () =>
    save.mutate(
      { id: worksheet.id, ...savePayload(), previous: worksheet },
      { onSuccess: () => toast.success('Worksheet saved'), onError: (e) => toast.error(e.message) },
    )
  const onPush = () =>
    push.mutate(
      { id: worksheet.id, contactId: borrower.contactId, draft: savePayload(), target, value, newEmployerName: employment ? undefined : draft.newEmployerName, previous: worksheet },
      {
        onSuccess: ({ employmentId }) => {
          toast.success(`${formatCurrency(value)}/mo pushed to the 1003`)
          // A push can create the job; point the worksheet at it.
          setDraft((d) => ({ ...d, employmentId, newEmployerName: '' }))
        },
        onError: (e) => toast.error(e.message),
      },
    )

  // Rentals show their net after the property's payment; everything else shows the monthly result.
  const shown = net?.net ?? result.monthly
  const where = isRental ? property?.addressLine : employment?.employerName ?? (draft.newEmployerName.trim() || null)

  return (
    <li className={cn('rounded-xl border bg-card', dirty && 'ring-2 ring-primary/30')}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <span className="truncate">{draft.label || kindLabel(draft.data.kind)}</span>
            {isDraft && (
              <span className="inline-flex shrink-0 items-center gap-0.5 rounded-full bg-money/10 px-1.5 py-0.5 text-[0.7rem] font-medium text-money">
                <SparklesIcon className="size-3" />
                AI draft
              </span>
            )}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {kindLabel(draft.data.kind)}
            {worksheet.pushedAt && ` · pushed ${relativeTime(worksheet.pushedAt)}`}
          </p>
        </div>
        <div className="text-right">
          <p className={cn('text-sm font-semibold tabular-nums', shown < 0 && 'text-destructive')}>{formatCurrency(shown)}/mo</p>
          <p className={cn('text-xs', differs ? 'text-amber-700' : 'text-muted-foreground')}>{differs ? 'Not on 1003 yet' : 'Matches 1003'}</p>
        </div>
        <ChevronDownIcon className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="space-y-4 border-t px-4 py-4">
          <FormGrid>
            <Input label="Label" value={draft.label} onChange={(label) => setDraft((d) => ({ ...d, label }))} span={3} placeholder={kindLabel(draft.data.kind)} />
            {isRental ? (
              <Select
                label="Property"
                required
                value={draft.propertyId}
                options={rentals.map((p) => ({ value: p.id, label: `${p.addressLine}${p.id === subjectPropertyId ? ' (subject)' : ''}` }))}
                onChange={(propertyId) => retarget({ propertyId })}
                placeholder={rentals.length ? 'Choose a property…' : 'No owned properties yet'}
                hint={rentals.length ? undefined : 'Add it under 1003 section 3 (real estate owned) first.'}
                span={3}
              />
            ) : (
              <Select
                label="Job on the 1003"
                required
                value={draft.employmentId ?? (draft.newEmployerName || jobs.length === 0 ? NEW_JOB : null)}
                options={[...jobs.map((e) => ({ value: e.id, label: e.employerName })), { value: NEW_JOB, label: 'New job…' }]}
                onChange={(id) => retarget({ employmentId: id === NEW_JOB ? null : id })}
                span={3}
              />
            )}
            {!isRental && !employment && (
              <Input
                label="Employer or business name"
                required
                value={draft.newEmployerName}
                onChange={(newEmployerName) => retarget({ newEmployerName })}
                hint="Pushing adds this job to the 1003"
                span={3}
              />
            )}
          </FormGrid>

          {isDraft && (
            <div className="rounded-lg border border-money/30 bg-money/5 p-3 text-sm">
              <p className="font-medium">Calculated from the uploads. Check it, edit anything, then Accept to push it to the 1003.</p>
              {worksheet.sourceNotes.length > 0 && (
                <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
                  {worksheet.sourceNotes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {sources.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-muted-foreground">Sources:</span>
              {sources.map((d) => (
                <button key={d.id} type="button" className="inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-primary hover:underline" onClick={() => void openDocument(d).catch((e: Error) => toast.error(e.message))}>
                  <FileTextIcon className="size-3" />
                  {d.fileName}
                </button>
              ))}
            </div>
          )}

          <SourceContext.Provider value={{ sources: worksheet.inputSources, inputs: draft.data.inputs, onOpen: showSource }}>
            <WorksheetInputs data={draft.data} onChange={(inputs) => setDraft((d) => ({ ...d, data: { ...d.data, inputs } as WorksheetData }))} />

            {isDraft && figs.length > 0 && (
              <div className="rounded-lg border p-3">
                <div className="mb-1.5 flex items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold">Figures from documents</p>
                  <p className={cn('text-xs', progress.ready ? 'text-nurture' : 'text-amber-700')}>
                    {progress.done} of {progress.total} checked
                  </p>
                </div>
                <ul className="divide-y text-sm">
                  {figs.map((f) => (
                    <li key={f.path} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
                      <label className="flex min-w-0 flex-1 items-center gap-2">
                        <input type="checkbox" className="size-4 accent-primary" checked={f.checked} disabled={f.changed || saveSources.isPending} onChange={(e) => tick(f.path, e.target.checked)} />
                        <span className="min-w-0 truncate">{figureLabel(f.path, recentYear)}</span>
                      </label>
                      <span className="font-medium tabular-nums">{typeof f.current === 'number' ? (Math.abs(f.current) >= 100 ? formatCurrency(f.current) : f.current) : String(f.current ?? '—')}</span>
                      <SourceChip path={f.path} className="mt-0" />
                    </li>
                  ))}
                </ul>
                <p className="mt-1 text-[11px] text-muted-foreground">Tick each figure once you've compared it with the document. Changing a figure counts as checking it.</p>
              </div>
            )}
          </SourceContext.Provider>

          <div className="grid gap-3 lg:grid-cols-2">
            <CalcLines lines={result.lines} />
            {net && <CalcLines lines={net.lines} />}
          </div>
          {isRental && property?.id === subjectPropertyId && (
            <Warnings warnings={["This is the subject property: its rent isn't counted in DTI here (only other retained properties are)."]} />
          )}
          <Warnings warnings={[...result.warnings, ...docWarnings]} />

          {/* Where the result goes, and whether the 1003 already has it. */}
          <div className={cn('rounded-lg border p-3 text-sm', differs ? 'border-primary/30 bg-primary/5' : 'bg-muted/40')}>
            {differs && target.to === 'property' && property && property.rentalIncomeMethod !== target.method ? (
              <p>
                {property.addressLine} uses {property.rentalIncomeMethod === 'schedule_e' ? 'its Schedule E figure' : '75% of the lease'} on the 1003 now. Pushing switches it to{' '}
                {target.method === 'schedule_e' ? 'Schedule E' : '75% of the lease'}, with <span className="font-medium tabular-nums">{formatCurrency(value)}</span>
                {target.method === 'lease' && ' rent'}.
              </p>
            ) : differs ? (
              <p>
                <span className="font-medium">{target.label}</span>
                {where && ` for ${where}`}: the 1003 shows <span className="font-medium tabular-nums">{formatCurrency(current)}</span>, this worksheet gives{' '}
                <span className="font-medium tabular-nums">{formatCurrency(value)}</span>.
              </p>
            ) : (
              <p className="flex items-center gap-2">
                <CheckCircle2Icon className="size-4 text-primary" />
                The 1003 matches: {target.label}
                {where && ` for ${where}`} is {formatCurrency(value)}.
              </p>
            )}
            {blocked && <p className="mt-1 text-xs text-destructive">{blocked}</p>}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            {confirmDelete ? (
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => remove.mutate(worksheet.id, { onSuccess: () => toast.success('Worksheet deleted'), onError: (e) => toast.error(e.message) })}
                >
                  {isDraft ? 'Discard this draft' : 'Delete worksheet (the 1003 keeps its figure)'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setConfirmDelete(true)}>
                <Trash2Icon />
                {isDraft ? 'Discard' : 'Delete'}
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              {onPdf && (
                <Button
                  size="sm"
                  variant="outline"
                  title="Save a one-page Income Analysis PDF of this worksheet to Documents"
                  onClick={() => {
                    const lastCheck = figs.map((f) => f.source).filter((s) => s.checkedBy && s.checkedAt).sort((a, b) => b.checkedAt!.localeCompare(a.checkedAt!))[0]
                    onPdf({
                      label: draft.label || kindLabel(draft.data.kind),
                      typeLabel: kindLabel(draft.data.kind),
                      where: where ?? null,
                      result: { ...result, warnings: [...result.warnings, ...docWarnings] },
                      notes: worksheet.sourceNotes,
                      sources: sources.map((d) => d.fileName),
                      draft: isDraft,
                      pushedOn: worksheet.pushedAt?.slice(0, 10) ?? null,
                      figureSources: figs.map((f) => ({ figure: figureLabel(f.path, recentYear), document: docs.data?.find((d) => d.id === f.source.documentId)?.fileName ?? 'Document', page: f.source.page ?? null, quote: f.source.quote })),
                      changes: figs.filter((f) => f.changed).map((f) => ({ figure: figureLabel(f.path, recentYear), aiValue: figureText(f.source.value), newValue: figureText(f.current) })),
                      reviewedBy: lastCheck ? { id: lastCheck.checkedBy!, at: lastCheck.checkedAt!.slice(0, 10) } : null,
                    })
                  }}
                >
                  <FileTextIcon />
                  PDF
                </Button>
              )}
              {dirty && (
                <Button size="sm" variant="outline" onClick={onSave} disabled={save.isPending}>
                  {save.isPending ? 'Saving…' : 'Save'}
                </Button>
              )}
              {isDraft && !progress.ready && <span className="self-center text-xs text-amber-700">{progress.done} of {progress.total} figures checked</span>}
              <Button size="sm" onClick={onPush} disabled={push.isPending || missingTarget || !!blocked || (!isDraft && !differs && !dirty) || (isDraft && !progress.ready)} title={isDraft && !progress.ready ? 'Check every figure from the documents first' : undefined}>
                <SendIcon />
                {push.isPending ? 'Pushing…' : isDraft ? 'Accept and push to 1003' : 'Push to 1003'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </li>
  )
}
