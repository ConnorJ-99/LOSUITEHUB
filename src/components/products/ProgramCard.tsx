import { CheckIcon } from 'lucide-react'
import { cn } from 'cn'
import { formatCompactCurrency, formatCurrency, formatPercent } from '@/lib/format'
import { DOC_TYPES, LENDER_STATUSES, PRODUCT_FAMILIES } from '@/lib/products/taxonomy'
import type { Badge, ProgramResult } from '@/lib/products/types'

const BADGE_LABEL: Record<Badge, string> = { best_fit: 'Best fit', highest_max_loan: 'Highest max loan', lowest_fico_floor: 'Lowest FICO floor' }

export const initials = (name: string) =>
  name
    .replace(/\(.*?\)/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

export function LenderMark({ name, className }: { name: string; className?: string }) {
  return <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary text-sm font-semibold text-primary-foreground', className)}>{initials(name)}</span>
}

/** The program's max DTI (a rule or the cell), or its min DSCR for DSCR loans. */
function thirdTile(r: ProgramResult): [string, string] {
  if (r.program.docTypes.includes('dscr')) {
    const rule = r.program.rules.find((x) => x.field === 'dscr' && x.op === '>=')
    const min = (typeof rule?.value === 'number' ? rule.value : null) ?? r.cell?.dscrMin ?? null
    return ['Min DSCR', min != null ? min.toFixed(2) : '—']
  }
  const rule = r.program.rules.find((x) => x.field === 'dti' && x.op === '<=')
  const max = (typeof rule?.value === 'number' ? rule.value : null) ?? r.cell?.maxDti ?? null
  return ['Max DTI', max != null ? formatPercent(max, 2) : '—']
}

interface Props {
  result: ProgramResult
  selected: boolean
  onSelect: (on: boolean) => void
  verifiedOn: string | null
}

/** An eligible program (mockup 03): lender, fit badge, stat tiles for this scenario, and room left. */
export function ProgramCard({ result: r, selected, onSelect, verifiedOn }: Props) {
  const ratio = r.limit?.ratio === 'cltv' ? 'CLTV' : 'LTV'
  const room = r.limit?.roomPts ?? 0
  const atLimit = room < 0.005
  const tight = !atLimit && room < 1
  const notSignedUp = r.lender.status !== 'approved'
  const [dLabel, dValue] = thirdTile(r)
  const pctUsed = r.limit ? Math.min(100, (r.limit.actual / r.limit.max) * 100) : 0

  return (
    <div className={cn('flex flex-col rounded-xl border bg-card p-4 transition-colors', selected ? 'border-primary ring-1 ring-primary' : 'border-border')}>
      <div className="flex items-start gap-3">
        <LenderMark name={r.lender.name} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-muted-foreground">
            {r.lender.name} · <span className={notSignedUp ? 'text-amber-700' : 'text-emerald-700'}>{LENDER_STATUSES.label[r.lender.status]}</span>
          </p>
          <p className="leading-tight font-semibold">{r.program.name}</p>
        </div>
        <input type="checkbox" aria-label={`Select ${r.program.name}`} checked={selected} onChange={(e) => onSelect(e.target.checked)} className="mt-1 size-4 accent-primary" />
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
          <CheckIcon className="size-3" />
          Fits matrix
        </span>
        <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
          {PRODUCT_FAMILIES.label[r.program.family]} · {r.program.docTypes.map((d) => DOC_TYPES.label[d]).join(', ')}
        </span>
        {r.badges.map((b) => (
          <span key={b} className="rounded-full bg-accent px-2 py-0.5 text-xs font-medium text-accent-foreground">
            {BADGE_LABEL[b]}
          </span>
        ))}
      </div>

      <dl className="mt-3 grid grid-cols-4 divide-x rounded-lg border">
        <Tile label={`Max ${ratio}`} value={r.limit ? formatPercent(r.limit.max, 3) : '—'} />
        <Tile label="Min FICO" value={r.ficoFloor != null ? String(r.ficoFloor) : '—'} />
        <Tile label={dLabel} value={dValue} />
        <Tile label={r.program.lien === 'first' ? 'Max loan' : 'Max 2nd'} value={formatCompactCurrency(r.maxLoan)} title={r.maxLoan != null ? formatCurrency(r.maxLoan) : undefined} />
      </dl>

      <div className="mt-3">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div className={cn('h-full rounded-full', atLimit ? 'bg-amber-500' : tight ? 'bg-amber-400' : 'bg-emerald-600')} style={{ width: `${pctUsed}%` }} />
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {ratio} {r.limit ? formatPercent(r.limit.actual, 2) : '—'} of {r.limit ? formatPercent(r.limit.max, 3) : '—'} max
          {atLimit ? ' · at limit' : ` · ${formatPercent(room, 2)} (${formatCurrency(r.limit?.roomDollars ?? 0)}) room`}
          {r.limit?.limitedBy === 'texas' && ' · Texas 80% cap'}
        </p>
      </div>

      {notSignedUp && <p className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">You're not signed up with this lender. Check with them before quoting.</p>}
      {r.checklist.some((c) => c.status === 'verify') && <p className="mt-2 text-xs text-muted-foreground">Verify: {r.checklist.filter((c) => c.status === 'verify').map((c) => c.message).join('; ')}</p>}
      <p className="mt-auto pt-3 text-[11px] text-muted-foreground">
        Matrix p.{r.cell?.sourcePage ?? '—'}
        {verifiedOn && ` · verified ${new Date(`${verifiedOn}T12:00:00`).toLocaleDateString('en-US')}`}
      </p>
    </div>
  )
}

function Tile({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="px-2 py-1.5" title={title}>
      <dt className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums">{value}</dd>
    </div>
  )
}
