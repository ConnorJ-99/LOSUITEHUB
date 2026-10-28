import { useState } from 'react'
import { AlertTriangleIcon, ChevronRightIcon, FileClockIcon } from 'lucide-react'
import { cn } from 'cn'
import { SearchInput, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { LenderMark } from '@/components/products/ProgramCard'
import { useLenderLoans, usePendingReviewCounts, type Lender } from '@/lib/api/lenders'
import { todayIso } from '@/lib/dates'
import { filterLenders, lenderTiles, loanCounts, matrixState, offerCounts, OFFER_TAGS, tabCounts, type LenderFilters, type LenderTab, type ListLender, type OfferTag } from '@/lib/products/lenderSummary'
import { daysSince } from '@/lib/products/stale'
import { LENDER_CHANNELS, LENDER_STATUSES } from '@/lib/products/taxonomy'

const STATUS_CLASS: Record<Lender['status'], string> = {
  approved: 'bg-emerald-50 text-emerald-700',
  pending: 'bg-accent text-accent-foreground',
  not_signed_up: 'bg-amber-50 text-amber-800',
  inactive: 'bg-muted text-muted-foreground',
}

const TABS: { id: LenderTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'attention', label: 'Needs attention' },
  { id: 'approved', label: 'Approved' },
  { id: 'pending', label: 'Pending' },
  { id: 'not_signed_up', label: 'Not signed up' },
  { id: 'inactive', label: 'Inactive' },
]

const shortDate = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })

/**
 * The Lenders list (mockup 08): summary tiles, status tabs, search, "offers"
 * filters by product type, and one card per lender with what it offers, your
 * loans with it, its matrix date and anything waiting on you.
 */
export function LenderList({ lenders, onOpen }: { lenders: Lender[]; onOpen: (id: string) => void }) {
  const pending = usePendingReviewCounts()
  const loans = useLenderLoans()
  const today = todayIso()
  const year = Number(today.slice(0, 4))
  const [f, setF] = useState<LenderFilters>({ tab: 'all', text: '', offers: [] })
  const rows: ListLender[] = lenders.map((l) => ({ ...l, pendingReviews: pending.data?.get(l.id) ?? 0 }))
  const tiles = lenderTiles(rows, today)
  const counts = tabCounts(rows, f, today)
  const shown = filterLenders(rows, f, today)
  const offered = OFFER_TAGS.filter((t) => rows.some((l) => offerCounts(l.programs).some((c) => c.tag === t)))

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="Lenders" value={tiles.lenders} />
        <Tile label="Approved" value={tiles.approved} tone="good" onClick={() => setF({ ...f, tab: 'approved' })} />
        <Tile label="Pending / not signed up" value={tiles.notYet} onClick={() => setF({ ...f, tab: 'not_signed_up' })} />
        <Tile label="Programs in searches" value={tiles.programs} />
        <Tile label="Needs attention" value={tiles.attention} tone={tiles.attention ? 'warn' : undefined} onClick={() => setF({ ...f, tab: 'attention' })} />
      </div>

      <div className="space-y-3 rounded-xl border bg-card p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
            {TABS.map((t) => (
              <button key={t.id} type="button" onClick={() => setF({ ...f, tab: t.id })} className={cn('rounded-md px-3 py-1.5 text-sm font-medium', f.tab === t.id ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                {t.label} <span className="text-xs tabular-nums opacity-70">{counts[t.id]}</span>
              </button>
            ))}
          </div>
          <SearchInput label="Search lenders" value={f.text} onChange={(text) => setF({ ...f, text })} placeholder="Name, AE, state or program" className="min-w-56 flex-1" />
        </div>
        {offered.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">Offers</span>
            <ToggleChipGroup>
              {offered.map((t) => (
                <ToggleChip key={t} label={t} pressed={f.offers.includes(t)} onChange={(on) => setF({ ...f, offers: on ? [...f.offers, t] : f.offers.filter((x: OfferTag) => x !== t) })} />
              ))}
            </ToggleChipGroup>
          </div>
        )}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-xl border bg-card py-10 text-center text-sm text-muted-foreground">No lenders match. Clear the search or filters.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((l) => (
            <LenderCard key={l.id} lender={l} channel={lenders.find((x) => x.id === l.id)!.channel} loans={loanCounts(loans.data?.get(l.id) ?? [], year)} today={today} onOpen={() => onOpen(l.id)} />
          ))}
        </div>
      )}
    </div>
  )
}

function Tile({ label, value, tone, onClick }: { label: string; value: number; tone?: 'good' | 'warn'; onClick?: () => void }) {
  const body = (
    <>
      <span className="block text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</span>
      <span className={cn('mt-1 block text-2xl font-semibold tabular-nums', tone === 'good' && 'text-emerald-700', tone === 'warn' && 'text-amber-700')}>{value}</span>
    </>
  )
  return onClick ? (
    <button type="button" onClick={onClick} className="rounded-xl border bg-card px-4 py-3 text-left shadow-soft transition-colors hover:border-primary/40">
      {body}
    </button>
  ) : (
    <div className="rounded-xl border bg-card px-4 py-3 shadow-soft">{body}</div>
  )
}

function LenderCard({ lender: l, channel, loans, today, onOpen }: { lender: ListLender; channel: Lender['channel']; loans: { closedThisYear: number; active: number }; today: string; onOpen: () => void }) {
  const offers = offerCounts(l.programs)
  const matrix = matrixState(l, today)
  const inSearches = l.programs.filter((p) => p.active).length
  return (
    <button type="button" onClick={onOpen} className="group flex flex-col rounded-xl border bg-card p-4 text-left shadow-soft transition-colors hover:border-primary/50">
      <div className="flex items-start gap-3">
        <LenderMark name={l.shortName ?? l.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">{l.name}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn('rounded-full px-2 py-0.5 font-medium', STATUS_CLASS[l.status])}>{LENDER_STATUSES.label[l.status]}</span>
            {LENDER_CHANNELS.label[channel]}
            {l.states?.length ? ` · ${l.states.length > 4 ? `${l.states.slice(0, 4).join(', ')} +${l.states.length - 4}` : l.states.join(', ')}` : ''}
          </p>
        </div>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
      </div>

      {offers.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {offers.map((o) => (
            <span key={o.tag} className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
              {o.tag} <span className="font-semibold text-foreground tabular-nums">{o.count}</span>
            </span>
          ))}
        </div>
      )}

      <dl className="mt-3 grid grid-cols-3 divide-x rounded-lg border text-sm">
        <div className="px-2 py-1.5">
          <dt className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Programs</dt>
          <dd className="font-semibold tabular-nums">{inSearches}</dd>
        </div>
        <div className="px-2 py-1.5">
          <dt className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Your loans</dt>
          <dd className="flex flex-col font-semibold tabular-nums leading-tight">
            <span>
              {loans.closedThisYear} <span className="text-xs font-normal text-muted-foreground">closed this yr</span>
            </span>
            <span>
              {loans.active} <span className="text-xs font-normal text-muted-foreground">active</span>
            </span>
          </dd>
        </div>
        <div className="px-2 py-1.5">
          <dt className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Matrix</dt>
          <dd className={cn('font-semibold tabular-nums', matrix.state === 'current' && 'text-emerald-700', matrix.state === 'stale' && 'text-amber-700', matrix.state === 'none' && 'text-xs font-normal text-muted-foreground')}>
            {matrix.state === 'none' ? 'None yet' : matrix.verifiedOn ? shortDate(matrix.verifiedOn) : 'Never verified'}
          </dd>
        </div>
      </dl>

      <p className="mt-2 text-xs text-muted-foreground">AE: {l.aeName ?? 'not set'}</p>

      {l.pendingReviews > 0 ? (
        <p className="mt-3 flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-xs font-medium text-accent-foreground">
          <FileClockIcon className="size-3.5" />
          {l.pendingReviews === 1 ? 'New matrix waiting for review' : `${l.pendingReviews} matrices waiting for review`}
        </p>
      ) : (
        matrix.state === 'stale' && (
          <p className="mt-3 flex items-center gap-1.5 rounded-md bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
            <AlertTriangleIcon className="size-3.5" />
            Stale matrix{matrix.verifiedOn ? `: verified ${daysSince(matrix.verifiedOn, today)} days ago` : ''}
          </p>
        )
      )}
    </button>
  )
}
