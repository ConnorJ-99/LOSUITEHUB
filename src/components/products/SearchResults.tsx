import { useState } from 'react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, ToggleChip } from '@/components/shared'
import { DOC_TYPES, LENDER_STATUSES, LIENS, PRODUCT_FAMILIES, type LenderStatus } from '@/lib/products/taxonomy'
import { scenarioChips, typeChips } from '@/lib/products/scenarioForm'
import type { ProgramResult, Scenario, SearchResult } from '@/lib/products/types'
import { LenderMark, ProgramCard } from './ProgramCard'
import { ProgramDrawer } from './ProgramDrawer'
import { SHOWN_STATUSES } from './SearchForm'

type Sort = 'best' | 'max_ltv' | 'lender'
const SORTS: [Sort, string][] = [
  ['best', 'Best fit'],
  ['max_ltv', 'Max LTV'],
  ['lender', 'Lender'],
]

interface Props {
  scenario: Scenario
  result: SearchResult
  verifiedOn: Map<string, string | null>
  borrowerName: string | null
  onEdit: () => void
  /** Search again with every product family (same lien and doc type). */
  onWiden: (() => void) | null
  /** Adds the selected programs to the borrower's file for pricing (when started from a borrower). */
  onAdd?: (programIds: string[]) => void
  adding?: boolean
}

/** Results (mockup 03): eligible cards, the same-type programs that don't fit (closest first, with how to fit), what wasn't searched, and the selection bar. */
export function SearchResults({ scenario, result, verifiedOn, borrowerName, onEdit, onWiden, onAdd, adding }: Props) {
  const [sort, setSort] = useState<Sort>('best')
  const [show, setShow] = useState<LenderStatus[]>(SHOWN_STATUSES)
  const [hideIneligible, setHideIneligible] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [viewing, setViewing] = useState<ProgramResult | null>(null)

  const visible = (r: ProgramResult) => show.includes(r.lender.status)
  const eligible = result.eligible.filter(visible)
  const sorted =
    sort === 'best' ? eligible : [...eligible].sort((a, b) => (sort === 'max_ltv' ? (b.limit?.max ?? 0) - (a.limit?.max ?? 0) : a.lender.name.localeCompare(b.lender.name)) || a.program.name.localeCompare(b.program.name))
  const ineligible = result.ineligible.filter(visible)
  const byStatus = (st: LenderStatus) => new Set(eligible.filter((r) => r.lender.status === st).map((r) => r.lender.id)).size
  const typeLabel = `${scenario.family === 'any' ? '' : `${PRODUCT_FAMILIES.label[scenario.family]} `}${LIENS.label[scenario.lien].toLowerCase()}`
  const chosen = result.eligible.filter((r) => selected.includes(r.program.id))
  const otherFamilies = Object.entries(result.notSearched.families)
    .map(([f, n]) => `${PRODUCT_FAMILIES.label[f as keyof typeof PRODUCT_FAMILIES.label]} ${n}`)
    .join(', ')

  return (
    <div className="space-y-4 pb-24">
      <Card contentClassName="py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Loan type</span>
          {typeChips(scenario).map((c) => (
            <span key={c} className="rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">
              {c}
            </span>
          ))}
          <span className="ml-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Scenario</span>
          {scenarioChips(scenario).map((c) => (
            <span key={c} className="rounded-full border px-3 py-1 text-xs">
              {c}
            </span>
          ))}
          <Button size="sm" variant="outline" className="ml-auto" onClick={onEdit}>
            Edit search
          </Button>
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p className="mr-auto">
          <span className="text-lg font-semibold">
            {eligible.length} program{eligible.length === 1 ? '' : 's'} fit
          </span>
          <span className="text-sm text-muted-foreground">
            {' · '}
            {SHOWN_STATUSES.filter((st) => byStatus(st) > 0)
              .map((st) => `${byStatus(st)} lender${byStatus(st) === 1 ? '' : 's'} ${LENDER_STATUSES.label[st].toLowerCase()}`)
              .join(', ') || 'none'}
          </span>
        </p>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Sort</span>
          {SORTS.map(([s, label]) => (
            <ToggleChip key={s} label={label} pressed={sort === s} onChange={() => setSort(s)} />
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Show</span>
          {SHOWN_STATUSES.map((st) => (
            <ToggleChip key={st} label={LENDER_STATUSES.label[st]} pressed={show.includes(st)} onChange={(on) => setShow(on ? [...show, st] : show.filter((x) => x !== st))} />
          ))}
        </div>
      </div>

      {sorted.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">No {typeLabel} program fits this scenario{ineligible.length ? '. The closest ones and what would make them fit are below.' : '.'}</p>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {sorted.map((r) => (
            <ProgramCard key={r.program.id} result={r} onView={() => setViewing(r)} verifiedOn={verifiedOn.get(r.program.id) ?? null} selected={selected.includes(r.program.id)} onSelect={(on) => setSelected(on ? [...selected, r.program.id] : selected.filter((x) => x !== r.program.id))} />
          ))}
        </div>
      )}

      {ineligible.length > 0 && (
        <div className="overflow-hidden rounded-xl border bg-card">
          <div className="flex items-center justify-between bg-primary px-4 py-3 text-primary-foreground">
            <div>
              <p className="font-semibold">Programs that don't fit ({typeLabel})</p>
              <p className="text-xs opacity-80">
                {ineligible.length} program{ineligible.length === 1 ? '' : 's'} · sorted by closest to fitting
              </p>
            </div>
            <Button size="sm" variant="secondary" onClick={() => setHideIneligible((h) => !h)}>
              {hideIneligible ? 'Show' : 'Hide'}
            </Button>
          </div>
          {!hideIneligible && (
            <div className="grid gap-3 p-4 lg:grid-cols-2">
              {ineligible.map((r, i) => (
                <IneligibleRow key={r.program.id} result={r} closest={i === 0} onView={() => setViewing(r)} />
              ))}
            </div>
          )}
        </div>
      )}

      {result.notSearched.count > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-accent px-4 py-3 text-sm text-accent-foreground">
          <span>
            {result.notSearched.count} program{result.notSearched.count === 1 ? '' : 's'} of other types {result.notSearched.count === 1 ? 'was' : 'were'} not searched ({otherFamilies}; other liens, doc types or down payment assistance).
          </span>
          {onWiden && (
            <button type="button" className="font-medium underline-offset-4 hover:underline" onClick={onWiden}>
              Widen to every product family
            </button>
          )}
        </div>
      )}

      {viewing && <ProgramDrawer result={viewing} scenario={scenario} onClose={() => setViewing(null)} />}

      {chosen.length > 0 && (
        <div className="fixed inset-x-4 bottom-4 z-20 mx-auto flex max-w-5xl flex-wrap items-center gap-3 rounded-xl bg-primary px-5 py-3 text-primary-foreground shadow-lg md:left-72">
          <p className="mr-auto text-sm">
            <span className="font-semibold">{chosen.length} selected:</span> {chosen.map((r) => r.lender.name).join(', ')}
          </p>
          <Button size="sm" variant="ghost" className="text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground" onClick={() => setSelected([])}>
            Clear
          </Button>
          {onAdd && borrowerName ? (
            <Button size="sm" variant="secondary" disabled={adding} onClick={() => onAdd(chosen.map((r) => r.program.id))}>
              {adding ? 'Adding…' : `Add to ${borrowerName} for pricing →`}
            </Button>
          ) : (
            <span className="text-xs opacity-80">Start from a borrower to add these for pricing.</span>
          )}
        </div>
      )}
    </div>
  )
}

/** One program that doesn't fit: why, and what would make it fit. */
function IneligibleRow({ result: r, closest, onView }: { result: ProgramResult; closest: boolean; onView: () => void }) {
  const fixes = r.reasons.filter((x) => x.fix)
  const unfixable = r.reasons.some((x) => x.unfixable)
  return (
    <div className="rounded-lg border p-3">
      <div className="flex items-start gap-3">
        <LenderMark name={r.lender.name} className="size-8 text-xs" />
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {PRODUCT_FAMILIES.label[r.program.family]} · {LIENS.label[r.program.lien]} · {r.program.docTypes.map((d) => DOC_TYPES.label[d]).join(', ')}
          </p>
          <p className="font-semibold">
            {r.lender.name} · {r.program.name}
            {r.lender.status !== 'approved' && <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-normal text-amber-800">{LENDER_STATUSES.label[r.lender.status]}</span>}
          </p>
        </div>
        <span className={cn('shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium', closest ? 'bg-accent text-accent-foreground' : 'border text-muted-foreground')}>
          {closest ? 'Closest fit · ' : ''}
          {r.reasons.length} reason{r.reasons.length === 1 ? '' : 's'}
        </span>
      </div>
      <ul className="mt-2 space-y-1 text-sm">
        {r.reasons.map((x, i) => (
          <li key={i} className="text-destructive">
            • {x.message}
            {x.trace?.page != null && <span className="ml-1 text-xs text-muted-foreground">(p.{x.trace.page})</span>}
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {fixes.map((x, i) => (
          <span key={i} className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
            {x.fix!.text}
          </span>
        ))}
        {unfixable && fixes.length === 0 && <span className="text-xs text-muted-foreground">No change in this scenario fixes it.</span>}
        <button type="button" onClick={onView} className="ml-auto text-sm font-medium text-primary hover:underline">
          View ›
        </button>
      </div>
    </div>
  )
}
