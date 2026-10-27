import { useMemo, useState } from 'react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { CheckIcon, ExternalLinkIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { ToggleChip, ToggleChipGroup } from '@/components/shared'
import { openGuidelinePdf, searchPassages, useLenderDetail, useProgramGuidelines, type GuidelineDocument, type Passage } from '@/lib/api/products'
import { formatPercent } from '@/lib/format'
import { defaultFilters, firstFilters, fitLine, gridOptions, matrixGrid, type GridFilters } from '@/lib/products/matrixGrid'
import { DOC_TYPES, LENDER_STATUSES, MATRIX_PROPERTY_TYPES, MATRIX_PURPOSES } from '@/lib/products/taxonomy'
import type { CheckItem, ProgramResult, Scenario } from '@/lib/products/types'
import { LenderMark } from './ProgramCard'

type Tab = 'matrix' | 'requirements' | 'guidelines' | 'documents'
const DOC_TYPE_LABEL: Record<GuidelineDocument['docType'], string> = { matrix: 'Matrix', guidelines: 'Guidelines', overlay_bulletin: 'Overlay bulletin', rate_sheet: 'Rate sheet' }

interface Props {
  result: ProgramResult
  /** Null when browsing: nothing is judged, the matrix and rules are shown as printed. */
  scenario: Scenario | null
  onClose: () => void
}

/** Program detail (mockup 04): the matrix with the borrower's cell, requirements, and the lender's own guideline text with page citations. */
export function ProgramDrawer({ result: r, scenario, onClose }: Props) {
  const [tab, setTab] = useState<Tab>('matrix')
  const lender = useLenderDetail(r.lender.id)
  const guidelines = useProgramGuidelines(r.program.id)
  const docs = guidelines.data?.documents ?? []
  const matrixDoc = docs.find((d) => d.docType === 'matrix' && d.storagePath)
  const open = (doc: GuidelineDocument | undefined, page: number | null) =>
    doc?.storagePath ? openGuidelinePdf(doc.storagePath, page).catch((e: Error) => toast.error(e.message)) : toast.info('The PDF itself is stored when the lender is uploaded on the Lenders page (step 5).')

  return (
    <DialogPrimitive.Root open onOpenChange={(o) => !o && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/20 data-open:animate-in data-open:fade-in-0" />
        <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-4xl flex-col bg-background shadow-xl outline-none data-open:animate-in data-open:slide-in-from-right">
          <div className="flex flex-wrap items-start gap-3 border-b bg-card px-5 py-4">
            <LenderMark name={r.lender.name} className="size-12" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">
                {r.lender.name} · <span className={r.lender.status === 'approved' ? 'text-emerald-700' : 'text-amber-700'}>{LENDER_STATUSES.label[r.lender.status]}</span>
                {lender.data?.aeName && ` · AE: ${lender.data.aeName}${lender.data.aePhone ? ` · ${lender.data.aePhone}` : ''}`}
              </p>
              <DialogPrimitive.Title className="text-lg font-semibold">{r.program.name}</DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">Matrix, requirements and guidelines for this program</DialogPrimitive.Description>
            </div>
            {scenario && (
              <span className={cn('inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium', r.eligible ? 'bg-emerald-50 text-emerald-700' : 'bg-destructive/10 text-destructive')}>
                {r.eligible && <CheckIcon className="size-3" />}
                {r.eligible ? 'Fits matrix' : "Doesn't fit"}
              </span>
            )}
            <Button size="sm" variant="outline" onClick={() => open(matrixDoc, r.cell?.sourcePage ?? null)}>
              Matrix PDF
            </Button>
            {lender.data?.portalUrl && (
              <Button size="sm" variant="outline" asChild>
                <a href={lender.data.portalUrl} target="_blank" rel="noopener noreferrer">
                  Lender portal
                  <ExternalLinkIcon />
                </a>
              </Button>
            )}
            <DialogPrimitive.Close asChild>
              <Button size="icon-sm" variant="ghost" aria-label="Close">
                <XIcon />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div className="flex flex-wrap gap-1.5 border-b px-5 py-3">
            {(['matrix', 'requirements', 'guidelines', 'documents'] as const).map((t) => (
              <ToggleChip key={t} label={t === 'documents' ? `Documents (${docs.length})` : t[0].toUpperCase() + t.slice(1)} pressed={tab === t} onChange={() => setTab(t)} />
            ))}
          </div>

          <div className="flex-1 overflow-y-auto px-5 py-4">
            {tab === 'matrix' && <MatrixTab result={r} scenario={scenario} passages={guidelines.data?.passages ?? []} docs={docs} onOpen={open} onSearch={() => setTab('guidelines')} />}
            {tab === 'requirements' && <RequirementsTab result={r} scenario={scenario} />}
            {tab === 'guidelines' && <GuidelinesTab passages={guidelines.data?.passages ?? []} docs={docs} loading={guidelines.isLoading} onOpen={open} />}
            {tab === 'documents' && <DocumentsTab docs={docs} onOpen={open} />}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function MatrixTab({ result: r, scenario, passages, docs, onOpen, onSearch }: { result: ProgramResult; scenario: Scenario | null; passages: Passage[]; docs: GuidelineDocument[]; onOpen: (d: GuidelineDocument | undefined, page: number | null) => void; onSearch: () => void }) {
  const options = useMemo(() => gridOptions(r.program), [r.program])
  const [f, setF] = useState<GridFilters>(() => (scenario ? defaultFilters(r.program, scenario) : firstFilters(r.program)))
  const g = matrixGrid(r.program, f, scenario)
  const tier = options.tiers[f.tier]
  // Passages on the pages the program's rules cite.
  const cited = new Set(r.program.rules.map((x) => x.sourcePage).filter((p): p is number => p != null))
  const related = passages.filter((p) => cited.has(p.page)).slice(0, 3)

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-x-6 gap-y-3">
        <Filter label="Purpose" values={options.purposes} label_={(v) => MATRIX_PURPOSES.label[v]} value={f.purpose} onChange={(purpose) => setF({ ...f, purpose })} />
        <Filter label="Property" values={options.propertyTypes} label_={(v) => MATRIX_PROPERTY_TYPES.label[v]} value={f.propertyType} onChange={(propertyType) => setF({ ...f, propertyType })} />
        {options.docTypes.length > 1 && <Filter label="Doc type" values={options.docTypes} label_={(v) => DOC_TYPES.label[v]} value={f.docType} onChange={(docType) => setF({ ...f, docType })} />}
        {options.tiers.length > 1 && <Filter label="Loan amount" values={options.tiers.map((_, i) => i)} label_={(i) => options.tiers[i].label} value={f.tier} onChange={(tier) => setF({ ...f, tier })} />}
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold">Max {g.ratio} by credit score and occupancy</h3>
          <p className="text-xs text-muted-foreground">
            {MATRIX_PURPOSES.label[f.purpose]} · {MATRIX_PROPERTY_TYPES.label[f.propertyType]} · {DOC_TYPES.label[f.docType]}
            {tier ? ` · ${tier.label}` : ''}
            {g.pages.length > 0 && ` · Matrix p.${g.pages.join(', ')}`}
          </p>
        </div>
        {g.rows.length === 0 ? (
          <p className="rounded-lg border p-4 text-sm text-muted-foreground">Not offered for this combination.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Credit score</th>
                  {g.columns.map((c, ci) => (
                    <th key={c.label} className={cn('px-3 py-2 text-center font-medium', g.highlight?.col === ci && 'bg-accent text-accent-foreground')}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {g.rows.map((row, ri) => (
                  <tr key={row.label} className={g.highlight?.row === ri ? 'bg-accent/40' : undefined}>
                    <th className={cn('px-3 py-2 text-left font-semibold tabular-nums', g.highlight?.row === ri && 'text-primary')}>
                      {row.label}
                      {g.highlight?.row === ri && scenario?.fico != null && <span className="ml-1 font-normal">← {scenario.fico}</span>}
                    </th>
                    {g.squares[ri].map((sq, ci) => {
                      const mine = g.highlight?.row === ri && g.highlight?.col === ci
                      return (
                        <td
                          key={ci}
                          className={cn(
                            'px-3 py-2 text-center tabular-nums',
                            mine && (r.eligible ? 'outline-2 -outline-offset-2 outline-emerald-600 font-semibold text-emerald-700' : 'outline-2 -outline-offset-2 outline-destructive font-semibold text-destructive'),
                          )}
                          title={sq.cell?.sourcePage ? `Matrix p.${sq.cell.sourcePage}` : undefined}
                        >
                          {sq.limit == null ? '—' : formatPercent(sq.limit, 3)}
                          {sq.cell?.notes && sq.cell.notes !== 'Not offered' && ' *'}
                          {mine && (r.eligible ? ' ✓' : '')}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {g.notes.map((n) => (
          <p key={n} className="mt-2 text-xs text-muted-foreground">
            * {n}
          </p>
        ))}
        {scenario?.state === 'TX' && scenario.homestead && scenario.purpose === 'cash_out' && <p className="mt-2 text-xs text-muted-foreground">Texas §50(a)(6): homestead cash-out is capped at 80% CLTV, whatever the matrix says.</p>}
      </div>

      {scenario && <FitBox result={r} scenario={scenario} />}

      <div>
        <h3 className="mb-2 font-semibold">Requirements</h3>
        <Checklist items={r.checklist} judged={!!scenario} />
      </div>

      <div>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-semibold">From the guidelines</h3>
          <p className="text-xs text-muted-foreground">Quoted from the lender's own text, with pages · searched by text, no AI</p>
        </div>
        {related.length === 0 ? <p className="text-sm text-muted-foreground">No guideline text linked to this program's rules yet.</p> : <PassageList passages={related} docs={docs} onOpen={onOpen} />}
        <Button size="sm" variant="outline" className="mt-3" onClick={onSearch}>
          Search this guideline…
        </Button>
      </div>
    </div>
  )
}

function Filter<T extends string | number>({ label, values, label_, value, onChange }: { label: string; values: T[]; label_: (v: T) => string; value: T; onChange: (v: T) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <ToggleChipGroup>
        {values.map((v) => (
          <ToggleChip key={String(v)} label={label_(v)} pressed={v === value} onChange={() => onChange(v)} />
        ))}
      </ToggleChipGroup>
    </div>
  )
}

function FitBox({ result: r, scenario }: { result: ProgramResult; scenario: Scenario }) {
  return <p className={cn('rounded-lg px-4 py-3 text-sm', r.eligible ? 'bg-emerald-50 text-emerald-800' : 'bg-destructive/10 text-destructive')}>{fitLine(r, scenario)}</p>
}

/** The rules with how the scenario measures up; when browsing (not judged), just the rules and their pages. */
function Checklist({ items, judged = true }: { items: CheckItem[]; judged?: boolean }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No program-wide rules recorded beyond the matrix.</p>
  return (
    <ul className="divide-y rounded-lg border">
      {items.map((c, i) => (
        <li key={i} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            {c.message}
            {c.overlay && <span className="ml-2 rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">Company overlay</span>}
            {c.trace.page != null && <span className="ml-2 text-xs text-muted-foreground">p.{c.trace.page}</span>}
          </span>
          {judged && (
            <>
              <span className="w-24 text-muted-foreground tabular-nums">{c.value ?? '—'}</span>
              <span className={cn('w-14 text-right text-xs font-semibold', c.status === 'pass' ? 'text-emerald-700' : c.status === 'fail' ? 'text-destructive' : c.status === 'na' ? 'font-normal text-muted-foreground' : 'text-amber-700')}>{c.status === 'pass' ? '✓' : c.status === 'fail' ? '✗' : c.status === 'na' ? 'N/A' : 'Verify'}</span>
            </>
          )}
        </li>
      ))}
    </ul>
  )
}

function RequirementsTab({ result: r, scenario }: { result: ProgramResult; scenario: Scenario | null }) {
  if (!scenario)
    return (
      <div>
        <h3 className="mb-2 font-semibold">Program rules</h3>
        <Checklist items={r.checklist} judged={false} />
        <p className="mt-2 text-xs text-muted-foreground">Run a search to see how a borrower measures up to each rule.</p>
      </div>
    )
  return (
    <div className="space-y-5">
      <FitBox result={r} scenario={scenario} />
      {r.reasons.length > 0 && (
        <div>
          <h3 className="mb-2 font-semibold">Why it doesn't fit</h3>
          <ul className="space-y-2">
            {r.reasons.map((x, i) => (
              <li key={i} className="rounded-lg border p-3 text-sm">
                <p className="text-destructive">
                  {x.message}
                  {x.trace?.page != null && <span className="ml-2 text-xs text-muted-foreground">p.{x.trace.page}</span>}
                </p>
                <p className="mt-1 text-xs">{x.fix ? <span className="font-medium text-emerald-700">{x.fix.text}</span> : x.unfixable ? <span className="text-muted-foreground">No change in this scenario fixes it.</span> : null}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <h3 className="mb-2 font-semibold">Requirements checklist</h3>
        <Checklist items={r.checklist} />
        <p className="mt-2 text-xs text-muted-foreground">"Verify" means the value isn't on the scenario yet, and "N/A" means the rule doesn't apply to it. Neither rules a program out.</p>
      </div>
    </div>
  )
}

function GuidelinesTab({ passages, docs, loading, onOpen }: { passages: Passage[]; docs: GuidelineDocument[]; loading: boolean; onOpen: (d: GuidelineDocument | undefined, page: number | null) => void }) {
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Passage[] | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (!q.trim()) return setHits(null)
    setBusy(true)
    try {
      setHits(await searchPassages(docs.map((d) => d.id), q))
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  if (loading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (docs.length === 0) return <p className="text-sm text-muted-foreground">No guideline documents for this program yet. They're added when the lender is uploaded on the Lenders page (step 5).</p>
  return (
    <div className="space-y-4">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          void run()
        }}
      >
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder='Search this guideline (e.g. "LLC", "prepayment", "non-warrantable")' className="h-9 min-w-0 flex-1 rounded-md border bg-card px-3 text-sm" />
        <Button type="submit" disabled={busy}>
          {busy ? 'Searching…' : 'Search'}
        </Button>
      </form>
      <p className="text-xs text-muted-foreground">Text search over the lender's own guidelines. No AI is used.</p>
      {hits && <p className="text-sm font-medium">{hits.length ? `${hits.length} passage${hits.length === 1 ? '' : 's'} found` : 'Nothing found. Try another word.'}</p>}
      <PassageList passages={hits ?? passages} docs={docs} onOpen={onOpen} />
    </div>
  )
}

function PassageList({ passages, docs, onOpen }: { passages: Passage[]; docs: GuidelineDocument[]; onOpen: (d: GuidelineDocument | undefined, page: number | null) => void }) {
  const docById = new Map(docs.map((d) => [d.id, d]))
  return (
    <ul className="space-y-3">
      {passages.map((p) => {
        const doc = docById.get(p.documentId)
        return (
          <li key={p.id} className="text-sm">
            {p.heading && <p className="font-medium">{p.heading}</p>}
            <p className="leading-relaxed">
              {p.body}{' '}
              <button type="button" onClick={() => onOpen(doc, p.page)} className="rounded bg-accent px-1.5 py-0.5 text-xs font-medium text-accent-foreground hover:underline">
                p.{p.page}
                {p.sectionNumber ? ` §${p.sectionNumber}` : ''}
              </button>
            </p>
            {doc && <p className="text-xs text-muted-foreground">{doc.title}{doc.versionLabel ? ` · ${doc.versionLabel}` : ''}</p>}
          </li>
        )
      })}
    </ul>
  )
}

function DocumentsTab({ docs, onOpen }: { docs: GuidelineDocument[]; onOpen: (d: GuidelineDocument | undefined, page: number | null) => void }) {
  if (docs.length === 0) return <p className="text-sm text-muted-foreground">No documents for this program yet.</p>
  return (
    <ul className="divide-y rounded-lg border">
      {docs.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
          <div className="min-w-0 flex-1">
            <p className="font-medium">{d.title}</p>
            <p className="text-xs text-muted-foreground">
              {DOC_TYPE_LABEL[d.docType]}
              {d.versionLabel && ` · ${d.versionLabel}`}
              {d.effectiveDate && ` · effective ${new Date(`${d.effectiveDate}T12:00:00`).toLocaleDateString('en-US')}`}
              {d.pageCount && ` · ${d.pageCount} pages`}
              {!d.current && ' · superseded'}
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => onOpen(d, null)}>
            Open PDF
          </Button>
        </li>
      ))}
    </ul>
  )
}
