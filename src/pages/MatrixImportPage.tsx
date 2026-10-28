import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, DateInput, FormGrid, Input, PageHeader, Select, SummaryBar, ToggleChip, ToggleChipGroup, confirmAction } from '@/components/shared'
import { useAuth } from '@/lib/auth/context'
import { useApproveImport, useDiscardImport, useExistingPrograms, useMatrixImport, useSignedPdf, type ExistingProgram, type MatrixImport } from '@/lib/api/matrixImports'
import { formatPercent } from '@/lib/format'
import { cellsFromProgram, changeText, checkProgram, diffCells, matchProgram, parseSquare, type ReviewProgram } from '@/lib/products/matrixImport'
import { DOC_TYPES, FEATURES, LIENS, MATRIX_PROPERTY_TYPES, MATRIX_PURPOSES, OCCUPANCIES, PRODUCT_FAMILIES } from '@/lib/products/taxonomy'
import type { ReadGrid } from '../../supabase/functions/assistant/matrix'

const options = <T extends string>(l: { values: T[]; label: Record<T, string> }) => l.values.map((v) => ({ value: v, label: l.label[v] }))

/** Review a matrix the assistant read: the PDF beside each grid, automatic checks, what changes, then approve. Nothing is searchable before approval. */
export function MatrixImportPage() {
  const { importId } = useParams<{ importId: string }>()
  const imp = useMatrixImport(importId!)
  const existing = useExistingPrograms(imp.data?.lenderId ?? '')
  if (imp.isLoading || (imp.data && existing.isLoading)) return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
  if (imp.error || !imp.data) return <p className="py-12 text-center text-sm text-destructive">{imp.error?.message ?? 'Import not found.'}</p>
  return <Review key={imp.data.id} imp={imp.data} existing={existing.data ?? []} />
}

function Review({ imp, existing }: { imp: MatrixImport; existing: ExistingProgram[] }) {
  const { state } = useAuth()
  const canEdit = state.status === 'signedIn' && (state.user.role === 'owner' || state.user.role === 'admin')
  const navigate = useNavigate()
  const approve = useApproveImport(imp.id, imp.lenderId)
  const discard = useDiscardImport(imp.id, imp.lenderId)
  const pdf = useSignedPdf(imp.storagePath)
  const [programs, setPrograms] = useState<ReviewProgram[]>(() => imp.reading.programs.map((p) => ({ ...p, include: true, programId: matchProgram(p.name, existing) })))
  const [effectiveDate, setEffectiveDate] = useState<string | null>(imp.reading.effectiveDate)
  const pending = imp.status === 'pending_review'
  const editable = pending && canEdit
  const setProgram = (i: number, next: ReviewProgram) => setPrograms((ps) => ps.map((p, j) => (j === i ? next : p)))

  const included = programs.filter((p) => p.include)
  const errors = included.reduce((n, p) => n + checkProgram(p).filter((w) => w.level === 'error').length, 0)
  const cells = included.reduce((n, p) => n + cellsFromProgram(p).length, 0)

  const onApprove = async () => {
    if (!(await confirmAction(`Approve ${included.length} program${included.length === 1 ? '' : 's'} (${cells} matrix cells)? They go live in Product Search right away; any earlier matrix for the same program is kept as superseded.`, { confirmLabel: 'Approve' }))) return
    approve.mutate(
      { programs, effectiveDate },
      {
        onSuccess: (r) => {
          toast.success(`Approved: ${r.programs} program${r.programs === 1 ? '' : 's'}, ${r.cells} cells, ${r.rules} rules`)
          navigate(`/admin/lenders?lender=${imp.lenderId}`)
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  return (
    <div className="pb-24">
      <PageHeader
        title={`Review matrix: ${imp.documentTitle ?? 'document'}`}
        description={`${imp.lenderName} · read ${new Date(imp.createdAt).toLocaleString('en-US')} · Nothing here is searchable until you approve it.`}
        action={
          <Button variant="outline" asChild>
            <Link to={`/admin/lenders?lender=${imp.lenderId}`}>Back to {imp.lenderName}</Link>
          </Button>
        }
      />
      {!pending && <p className="mb-4 rounded-lg bg-muted px-4 py-3 text-sm">This reading was {imp.status === 'approved' ? 'approved' : 'discarded'}. It's kept as the record of what was read.</p>}
      {(imp.reading.notes || imp.reading.dropped.length > 0) && (
        <Card title="From the assistant" className="mb-4">
          {imp.reading.notes && <p className="text-sm whitespace-pre-line">{imp.reading.notes}</p>}
          {imp.reading.dropped.length > 0 && (
            <div className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <p className="font-medium">Left out because they didn't fit the lists (check the PDF):</p>
              <ul className="mt-1 list-disc pl-5">
                {imp.reading.dropped.map((d) => (
                  <li key={d}>{d}</li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
      <Card className="mb-4">
        <FormGrid>
          <DateInput label="Matrix effective date" value={effectiveDate} onChange={setEffectiveDate} readOnly={!editable} span={2} />
        </FormGrid>
      </Card>

      <div className="space-y-6">
        {programs.map((p, i) => (
          <ProgramReview key={i} program={p} existing={existing} pdfUrl={pdf.data ?? null} editable={editable} onChange={(next) => setProgram(i, next)} />
        ))}
      </div>

      {editable && (
        <SummaryBar
          items={[
            { label: 'Programs', value: `${included.length} of ${programs.length}` },
            { label: 'Cells', value: String(cells) },
            { label: 'Errors to fix', value: String(errors), warning: errors > 0 },
          ]}
          action={
            <div className="flex gap-2">
              <Button variant="outline" disabled={discard.isPending} onClick={async () => (await confirmAction('Discard this reading? Nothing from it will be used.', { confirmLabel: 'Discard', destructive: true })) && discard.mutate(undefined, { onSuccess: () => navigate(`/admin/lenders?lender=${imp.lenderId}`), onError: (e) => toast.error(e.message) })}>
                Discard
              </Button>
              <Button disabled={approve.isPending || errors > 0 || included.length === 0} title={errors > 0 ? 'Fix the errors first' : undefined} onClick={onApprove}>
                {approve.isPending ? 'Approving…' : `Approve ${included.length} program${included.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          }
        />
      )}
    </div>
  )
}

function ProgramReview({ program: p, existing, pdfUrl, editable, onChange }: { program: ReviewProgram; existing: ExistingProgram[]; pdfUrl: string | null; editable: boolean; onChange: (p: ReviewProgram) => void }) {
  const set = <K extends keyof ReviewProgram>(key: K) => (value: ReviewProgram[K]) => onChange({ ...p, [key]: value })
  const toggle = <K extends 'docTypes' | 'features' | 'purposes'>(key: K, v: ReviewProgram[K][number], on: boolean) => onChange({ ...p, [key]: on ? [...p[key], v] : (p[key] as string[]).filter((x) => x !== v) })
  const warnings = checkProgram(p)
  const current = existing.find((e) => e.id === p.programId)
  const changes = current ? diffCells(current.cells, cellsFromProgram(p)) : []
  const [showAll, setShowAll] = useState(false)

  return (
    <Card
      title={p.name || 'Unnamed program'}
      description={current ? `Updates "${current.name}" (now on version ${current.version ?? 'none'}): a new version replaces it.` : 'A new program for this lender.'}
      action={<ToggleChip label={p.include ? 'Approve this program' : 'Skipped'} pressed={p.include} disabled={!editable} onChange={set('include')} />}
      className={cn(!p.include && 'opacity-60')}
    >
      <FormGrid>
        <Input label="Program name" value={p.name} onChange={set('name')} readOnly={!editable} span={2} />
        <Select label="Updates" value={p.programId} options={existing.map((e) => ({ value: e.id, label: e.name }))} onChange={set('programId')} onClear={() => set('programId')(null)} placeholder="A new program" readOnly={!editable} span={2} />
        <Select label="Product family" value={p.family} options={options(PRODUCT_FAMILIES)} onChange={set('family')} readOnly={!editable} />
        <Select label="Lien" value={p.lien} options={options(LIENS)} onChange={set('lien')} readOnly={!editable} />
      </FormGrid>
      <div className="mt-3 space-y-2">
        <ChipLine label="Doc types" values={DOC_TYPES.values} labels={DOC_TYPES.label} picked={p.docTypes} disabled={!editable} onToggle={(v, on) => toggle('docTypes', v, on)} />
        <ChipLine label="Purposes" values={MATRIX_PURPOSES.values} labels={MATRIX_PURPOSES.label} picked={p.purposes} disabled={!editable} onToggle={(v, on) => toggle('purposes', v, on)} />
        <ChipLine label="Features" values={FEATURES.values} labels={FEATURES.label} picked={p.features} disabled={!editable} onToggle={(v, on) => toggle('features', v, on)} />
      </div>
      {p.description && <p className="mt-3 text-sm text-muted-foreground">{p.description}</p>}

      <div className="mt-4 space-y-2">
        {warnings.length === 0 ? (
          <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Automatic checks passed: limits only go down as credit scores go down and loan amounts go up, every value is possible, and the cell count matches each grid.</p>
        ) : (
          <ul className="space-y-1">
            {warnings.map((w, i) => (
              <li key={i} className={cn('rounded-md px-3 py-2 text-sm', w.level === 'error' ? 'bg-destructive/10 text-destructive' : 'bg-amber-50 text-amber-900')}>
                <span className="font-medium">{w.level === 'error' ? 'Fix: ' : 'Check: '}</span>
                {w.message}
                {w.page != null && <span className="ml-1 text-xs">(p.{w.page})</span>}
              </li>
            ))}
          </ul>
        )}
        {current && (
          <div className="rounded-md border px-3 py-2 text-sm">
            <p className="font-medium">{changes.length === 0 ? 'No changes from the matrix in use.' : `${changes.length} change${changes.length === 1 ? '' : 's'} from the matrix in use`}</p>
            {changes.length > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs">
                {(showAll ? changes : changes.slice(0, 12)).map((c, i) => (
                  <li key={i}>{changeText(c)}</li>
                ))}
              </ul>
            )}
            {changes.length > 12 && (
              <button type="button" className="mt-1 text-xs font-medium text-primary hover:underline" onClick={() => setShowAll((s) => !s)}>
                {showAll ? 'Show fewer' : `Show all ${changes.length}`}
              </button>
            )}
          </div>
        )}
      </div>

      <div className="mt-5 space-y-6">
        {p.grids.map((g, gi) => (
          <GridReview key={gi} grid={g} pdfUrl={pdfUrl} editable={editable} onChange={(next) => set('grids')(p.grids.map((x, j) => (j === gi ? next : x)))} />
        ))}
      </div>

      <div className="mt-5">
        <h3 className="mb-2 font-semibold">Program rules</h3>
        {p.rules.length === 0 ? (
          <p className="text-sm text-muted-foreground">None read.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {p.rules.map((r, ri) => (
              <li key={ri} className="flex flex-wrap items-start gap-3 px-3 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {r.message}
                    {r.severity === 'verify' && <span className="ml-2 text-xs font-normal text-amber-700">Verify</span>}
                  </p>
                  {r.quote && <p className="text-xs text-muted-foreground">"{r.quote}"{r.page != null && ` · p.${r.page}`}</p>}
                </div>
                {editable && (
                  <Button size="sm" variant="ghost" onClick={() => set('rules')(p.rules.filter((_, j) => j !== ri))}>
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

function ChipLine<T extends string>({ label, values, labels, picked, disabled, onToggle }: { label: string; values: T[]; labels: Record<T, string>; picked: T[]; disabled: boolean; onToggle: (v: T, on: boolean) => void }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <ToggleChipGroup>
        {values.map((v) => (
          <ToggleChip key={v} label={labels[v]} pressed={picked.includes(v)} disabled={disabled} onChange={(on) => onToggle(v, on)} />
        ))}
      </ToggleChipGroup>
    </div>
  )
}

/** One grid: the PDF page on the left, the grid as read on the right, every square editable. */
function GridReview({ grid: g, pdfUrl, editable, onChange }: { grid: ReadGrid; pdfUrl: string | null; editable: boolean; onChange: (g: ReadGrid) => void }) {
  const setSquare = (ri: number, ci: number, text: string) => {
    const v = parseSquare(text)
    if (v === 'invalid') return toast.error(`"${text}" isn't a percent. Use a number like 85, or leave it blank for not offered.`)
    onChange({ ...g, values: g.values.map((row, r) => (r === ri ? row.map((x, c) => (c === ci ? v : x)) : row)) })
  }
  const describe = [OCCUPANCIES.label[g.occupancy], g.propertyTypes.map((t) => MATRIX_PROPERTY_TYPES.label[t]).join(', '), g.purposes.map((x) => MATRIX_PURPOSES.label[x]).join(', '), DOC_TYPES.label[g.docType], g.unitsMin === g.unitsMax ? `${g.unitsMin} unit${g.unitsMin === 1 ? '' : 's'}` : `${g.unitsMin}–${g.unitsMax} units`].join(' · ')

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">
          {g.title || 'Grid'} <span className="font-normal text-muted-foreground">· max {g.ratio.toUpperCase()} · p.{g.page}</span>
        </h3>
        <p className="text-xs text-muted-foreground">{describe}</p>
      </div>
      <div className="grid gap-3 xl:grid-cols-2">
        <div className="overflow-hidden rounded-lg border bg-muted/30">
          {pdfUrl ? <iframe title={`PDF page ${g.page}`} src={`${pdfUrl}#page=${g.page}&view=FitH`} className="h-[520px] w-full" loading="lazy" /> : <p className="p-4 text-sm text-muted-foreground">The PDF isn't available to show here.</p>}
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-2 py-2 text-left font-medium">Credit score</th>
                {g.columns.map((c, ci) => (
                  <th key={ci} className="px-2 py-2 text-center font-medium">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {g.rows.map((r, ri) => (
                <tr key={ri}>
                  <th className="px-2 py-1 text-left font-semibold tabular-nums">{r.label || `${r.ficoMin}–${r.ficoMax}`}</th>
                  {g.columns.map((_, ci) => {
                    const v = g.values[ri]?.[ci] ?? null
                    return (
                      <td key={ci} className="px-1 py-1 text-center">
                        <input
                          aria-label={`${r.label} ${g.columns[ci].label}`}
                          defaultValue={v == null ? '' : String(v)}
                          placeholder="—"
                          readOnly={!editable}
                          onBlur={(e) => e.target.value !== (v == null ? '' : String(v)) && setSquare(ri, ci, e.target.value)}
                          className="h-8 w-16 rounded border border-transparent bg-transparent text-center tabular-nums hover:border-border focus:border-ring focus:outline-none"
                        />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="border-t px-2 py-1.5 text-xs text-muted-foreground">
            {g.rows.length} × {g.columns.length} read{g.printedRows !== g.rows.length || g.printedColumns !== g.columns.length ? ` · the page shows ${g.printedRows} × ${g.printedColumns}` : ''} · blank = not offered
            {g.values.flat().some((x) => x != null) && ` · top limit ${formatPercent(Math.max(...g.values.flat().filter((x): x is number => x != null)), 3)}`}
          </p>
          {g.notes && <p className="border-t px-2 py-1.5 text-xs text-muted-foreground">Notes: {g.notes}</p>}
        </div>
      </div>
    </section>
  )
}
