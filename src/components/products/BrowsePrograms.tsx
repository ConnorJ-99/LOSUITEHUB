import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Card, NumberInput, PercentInput, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { programsMatchingGuidelines } from '@/lib/api/products'
import { todayIso } from '@/lib/dates'
import { formatCompactCurrency, formatPercent } from '@/lib/format'
import { allBrowseFilters, BROWSE_GROUP_LABEL, BROWSE_GROUPS, browseCounts, browseResult, browseRows, filterBrowse, groupBrowse, type BrowseFilters, type BrowseRow, type BrowseSort } from '@/lib/products/browse'
import { daysSince, isStale } from '@/lib/products/stale'
import { FEATURES, LENDER_STATUSES, LIENS, termsSummary, type Lien } from '@/lib/products/taxonomy'
import type { Catalog, ProgramResult } from '@/lib/products/types'
import { LenderMark } from './ProgramCard'
import { ProgramDrawer } from './ProgramDrawer'
import { SHOWN_STATUSES } from './SearchForm'

const SORTS: [BrowseSort, string][] = [
  ['type', 'Product type'],
  ['lender', 'Lender'],
  ['updated', 'Recently verified'],
]
const PER_GROUP = 6
const LIEN_CHIP: Record<Lien, string> = { first: '1st', ces: 'CES', heloc: 'HELOC' }

/** Browse all programs (mockup 05): every lender's programs, no scenario needed. */
export function BrowsePrograms({ catalog, verifiedOn }: { catalog: Catalog; verifiedOn: Map<string, string | null> }) {
  const [f, setF] = useState<BrowseFilters>(allBrowseFilters)
  const [sort, setSort] = useState<BrowseSort>('type')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [viewing, setViewing] = useState<ProgramResult | null>(null)
  /** Guideline search results, with the words they were for. */
  const [hits, setHits] = useState<{ q: string; programs: Set<string> } | null>(null)
  const today = todayIso()
  const rows = useMemo(() => browseRows(catalog), [catalog])
  const q = f.text.trim()
  const filters: BrowseFilters = { ...f, guidelineHits: q.length >= 3 && hits?.q === q ? hits.programs : null }
  const shown = filterBrowse(rows, filters, FEATURES.label)
  const counts = browseCounts(rows, filters, FEATURES.label)
  const groups = groupBrowse(shown, sort, verifiedOn)
  const stale = shown.filter((r) => isStale(verifiedOn.get(r.program.id) ?? null, today))
  const set = <K extends keyof BrowseFilters>(key: K) => (value: BrowseFilters[K]) => setF((x) => ({ ...x, [key]: value }))

  // Guideline text search (Postgres, no AI), a moment after typing stops.
  useEffect(() => {
    if (q.length < 3) return
    const t = setTimeout(() => {
      programsMatchingGuidelines(q)
        .then((programs) => setHits({ q, programs }))
        .catch((e: Error) => toast.error(e.message))
    }, 400)
    return () => clearTimeout(t)
  }, [q])

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <Card contentClassName="space-y-5">
        <FilterGroup label="Product type">
          {BROWSE_GROUPS.map(([g, label]) => (
            <label key={g} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={f.groups.includes(g)} onChange={(e) => set('groups')(e.target.checked ? [...f.groups, g] : f.groups.filter((x) => x !== g))} />
              <span className="flex-1">{label}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{counts.groups[g]}</span>
            </label>
          ))}
          {f.groups.length > 0 && (
            <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => set('groups')([])}>
              Show every type
            </button>
          )}
        </FilterGroup>
        <FilterGroup label="Lien">
          <ToggleChipGroup>
            {LIENS.values.map((l) => (
              <ToggleChip key={l} label={LIEN_CHIP[l]} pressed={f.liens.includes(l)} onChange={(on) => set('liens')(on ? [...f.liens, l] : f.liens.filter((x) => x !== l))} />
            ))}
          </ToggleChipGroup>
        </FilterGroup>
        <FilterGroup label="Lender status">
          {SHOWN_STATUSES.map((st) => (
            <label key={st} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={f.statuses.includes(st)} onChange={(e) => set('statuses')(e.target.checked ? [...f.statuses, st] : f.statuses.filter((x) => x !== st))} />
              <span className="flex-1">{LENDER_STATUSES.label[st]}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{counts.statuses[st]}</span>
            </label>
          ))}
        </FilterGroup>
        <FilterGroup label="Quick limits">
          <NumberInput label="Min FICO at or below" value={f.ficoAtOrBelow} onChange={set('ficoAtOrBelow')} maxDecimals={0} />
          <PercentInput label="Max LTV at least" value={f.ltvAtLeast} onChange={set('ltvAtLeast')} maxDecimals={2} />
        </FilterGroup>
      </Card>

      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={f.text}
            onChange={(e) => set('text')(e.target.value)}
            placeholder='Search programs, lenders or guideline text (e.g. "non-warrantable condo", ITIN, "first-time investor")'
            className="h-10 min-w-0 flex-1 rounded-lg border bg-card px-3 text-sm"
          />
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Sort</span>
            {SORTS.map(([s, label]) => (
              <ToggleChip key={s} label={label} pressed={sort === s} onChange={() => setSort(s)} />
            ))}
          </div>
        </div>
        {filters.guidelineHits && <p className="text-xs text-muted-foreground">Matching names, plus {filters.guidelineHits.size} program{filters.guidelineHits.size === 1 ? '' : 's'} whose guidelines mention it (text search, no AI).</p>}

        {shown.length === 0 ? (
          <Card>
            <p className="text-sm text-muted-foreground">No programs match these filters.</p>
          </Card>
        ) : (
          groups.map((grp) => {
            const key = grp.group ?? 'all'
            const all = open.has(key) || grp.group === null
            return (
              <section key={key}>
                {grp.group && (
                  <div className="mb-2 flex items-baseline justify-between">
                    <h2 className="text-lg font-semibold">
                      {BROWSE_GROUP_LABEL[grp.group]} <span className="text-muted-foreground">· {grp.rows.length} program{grp.rows.length === 1 ? '' : 's'}</span>
                    </h2>
                    {grp.rows.length > PER_GROUP && (
                      <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setOpen((s) => new Set(s.has(key) ? [...s].filter((x) => x !== key) : [...s, key]))}>
                        {all ? 'Show fewer' : `Show all ${grp.rows.length} ›`}
                      </button>
                    )}
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {(all ? grp.rows : grp.rows.slice(0, PER_GROUP)).map((r) => (
                    <BrowseCard key={r.program.id} row={r} verifiedOn={verifiedOn.get(r.program.id) ?? null} onView={() => setViewing(browseResult(r))} />
                  ))}
                </div>
              </section>
            )
          })
        )}

        {stale.length > 0 && (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <span className="font-semibold">Stale matrix: </span>
            {stale
              .slice(0, 3)
              .map((r) => {
                const days = daysSince(verifiedOn.get(r.program.id) ?? null, today)
                return `${r.lender.name} · ${r.program.name} ${days == null ? 'has never been verified' : `was last verified ${days} days ago`}`
              })
              .join('; ')}
            {stale.length > 3 && ` and ${stale.length - 3} more`}. Upload the latest matrix on the Lenders page to refresh it.
          </p>
        )}
      </div>
      {viewing && <ProgramDrawer result={viewing} scenario={null} onClose={() => setViewing(null)} />}
    </div>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      {children}
    </div>
  )
}

/** One program, no scenario: lender, status, chips and its headline limits. */
function BrowseCard({ row: r, verifiedOn, onView }: { row: BrowseRow; verifiedOn: string | null; onView: () => void }) {
  const s = r.summary
  const dscr = r.program.docTypes.includes('dscr')
  const chips = [r.program.lien !== 'first' ? (r.program.lien === 'heloc' ? 'HELOC' : '2nd lien') : null, ...r.program.features.map((f) => FEATURES.label[f])].filter((x): x is string => !!x)
  return (
    <div className="flex flex-col rounded-xl border bg-card p-4">
      <div className="flex items-start gap-3">
        <LenderMark name={r.lender.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground">
            {r.lender.name} · <span className={r.lender.status === 'approved' ? 'text-emerald-700' : 'text-amber-700'}>{LENDER_STATUSES.label[r.lender.status]}</span>
          </p>
          <p className="leading-tight font-semibold">{r.program.name}</p>
          {r.program.termOptions.length > 0 && <p className="text-xs text-muted-foreground">{termsSummary(r.program.termOptions)}</p>}
        </div>
      </div>
      {chips.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span key={c} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              {c}
            </span>
          ))}
        </div>
      )}
      {r.matchedBy === 'guidelines' && <p className="mt-2 text-xs text-primary">Found in the guidelines</p>}
      <dl className="mt-3 grid grid-cols-3 divide-x rounded-lg border">
        <Tile label="Min FICO" value={s.minFico != null ? String(s.minFico) : '—'} />
        <Tile label={`Max ${s.ratio}`} value={s.maxRatio != null ? formatPercent(s.maxRatio, 3) : '—'} />
        {dscr ? <Tile label="Min DSCR" value={s.minDscr != null ? s.minDscr.toFixed(2) : '—'} /> : <Tile label="Max loan" value={s.maxLoan != null ? formatCompactCurrency(s.maxLoan) : s.minFico != null ? 'No limit' : '—'} />}
      </dl>
      <div className="mt-auto flex items-baseline justify-between gap-2 pt-3">
        <p className={cn('text-xs', s.minFico == null ? 'text-amber-700' : 'text-muted-foreground')}>{s.minFico == null ? 'No approved matrix yet' : verifiedOn ? `Matrix verified ${new Date(`${verifiedOn}T12:00:00`).toLocaleDateString('en-US')}` : 'Matrix never verified'}</p>
        <button type="button" onClick={onView} className="text-sm font-medium text-primary hover:underline">
          View ›
        </button>
      </div>
    </div>
  )
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-2 py-1.5">
      <dt className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
