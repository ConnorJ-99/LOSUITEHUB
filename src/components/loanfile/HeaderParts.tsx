import { CheckIcon, ChevronDownIcon, LockIcon, XIcon } from 'lucide-react'
import { cn } from 'cn'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import type { StepStatus } from '@/lib/loanfile/display'

// The loan file header pieces: status pills, the metrics strip, the
// milestone stepper and the assigned team row. Presentational only.

const PILL: Record<StepStatus, { label: string; className: string }> = {
  ready: { label: 'Ready', className: 'border-primary/20 bg-primary/10 text-primary' },
  not_started: { label: 'Not started', className: 'border-border bg-card text-muted-foreground' },
  in_progress: { label: 'In progress', className: 'border-sky-200 bg-sky-50 text-sky-800' },
  done: { label: 'Done', className: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  blocked: { label: 'Blocked', className: 'border-red-200 bg-red-50 text-red-700' },
  na: { label: 'Not applicable', className: 'border-transparent bg-muted text-muted-foreground' },
}

/** A step's status: Ready (accent), Not started (grey outline), Done (green), Blocked (red with a lock), Not applicable (grey). */
export function StatusPill({ status, className }: { status: StepStatus; className?: string }) {
  const p = PILL[status]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[0.7rem] font-medium whitespace-nowrap', p.className, className)}>
      {status === 'done' && <CheckIcon className="size-3" />}
      {status === 'blocked' && <LockIcon className="size-3" />}
      {p.label}
    </span>
  )
}

export interface Metric {
  label: string
  value: string
  /** Colored dot after the value, e.g. the credit tier. */
  tone?: 'green' | 'amber' | 'red'
  /** Smaller text after the value, e.g. "Good". */
  note?: string
}

const DOT = { green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500' }

/** Figures ("$196,210", "78.48%", "700") use the number font, dollars in gold; words ("Conventional", an address) stay in the body font. */
const figureClass = (value: string) => (/^[$\d.,%\s—-]+$/.test(value) ? cn('tabular-nums', value.startsWith('$') && 'text-money') : '')

/** Label-over-value cells with thin dividers; scrolls sideways on narrow screens. */
export function MetricStrip({ metrics }: { metrics: Metric[] }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <dl className="flex min-w-max divide-x">
        {metrics.map((m) => (
          <div key={m.label} className="px-4 py-1 first:pl-0">
            <dt className="text-[0.68rem] font-semibold tracking-wide whitespace-nowrap text-muted-foreground uppercase">{m.label}</dt>
            <dd className={cn('flex items-center gap-1.5 text-lg font-semibold whitespace-nowrap', figureClass(m.value))}>
              {m.value}
              {m.note && <span className="text-sm font-normal text-muted-foreground">{m.note}</span>}
              {m.tone && <span className={cn('size-2 rounded-full', DOT[m.tone])} aria-label={m.tone} />}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export interface Milestone {
  label: string
  state: 'done' | 'current' | 'future' | 'failed'
  /** Shown under a reached milestone. */
  date?: string | null
}

/** Numbered circles joined by a line. Done = filled with a check and date; current = accent outline; failed = red. */
export function MilestoneStepper({ milestones, band }: { milestones: Milestone[]; band?: string }) {
  return (
    <div className="space-y-2">
      <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ol className="flex min-w-max">
          {milestones.map((m, i) => (
            <li key={m.label} className="relative flex w-24 flex-col items-center text-center">
              {i > 0 && <span className={cn('absolute top-3.5 right-1/2 h-px w-full -translate-y-1/2', m.state === 'future' ? 'bg-border' : 'bg-primary/40')} aria-hidden />}
              <span
                className={cn(
                  'relative z-10 flex size-7 items-center justify-center rounded-full border text-xs font-medium',
                  m.state === 'done' && 'border-emerald-600 bg-emerald-600 text-white',
                  m.state === 'current' && 'border-2 border-primary bg-card text-primary',
                  m.state === 'future' && 'border-border bg-card text-muted-foreground',
                  m.state === 'failed' && 'border-red-500 bg-red-50 text-red-600',
                )}
              >
                {m.state === 'done' ? <CheckIcon className="size-3.5" /> : m.state === 'failed' ? <XIcon className="size-3.5" /> : i + 1}
              </span>
              <span className={cn('mt-1 px-1 text-[0.7rem] leading-tight', m.state === 'future' ? 'text-muted-foreground' : 'font-medium', m.state === 'failed' && 'text-red-600', m.state === 'current' && 'text-primary')}>
                {m.label}
              </span>
              {m.date && <span className="text-[0.65rem] text-muted-foreground">{m.date}</span>}
            </li>
          ))}
        </ol>
      </div>
      {band && <div className="rounded-sm bg-primary/10 px-2 py-1 text-xs font-medium text-primary">{band}</div>}
    </div>
  )
}

export interface TeamMember {
  /** Section label before the chip, e.g. "Broker" or "Lender". */
  group?: string
  role: string
  name: string | null
  /** People who can be picked for this role. */
  options?: string[]
  /** Offer "Enter name…" for outside contacts (title, agents). */
  allowCustom?: boolean
}

/** "Assigned team 2/4" with a dropdown chip per role. Filled dot = assigned; hollow dot and italic "Unassigned" = open. */
export function TeamRow({ members, onAssign, onCustom }: { members: TeamMember[]; onAssign?: (role: string, name: string | null) => void; onCustom?: (role: string) => void }) {
  const assigned = members.filter((m) => m.name).length
  return (
    <div className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
      <div className="flex min-w-max items-center gap-2 rounded-full border bg-card px-4 py-1.5">
        <span className="mr-1 text-sm font-medium whitespace-nowrap">
          Assigned team <span className="text-muted-foreground tabular-nums">{assigned}/{members.length}</span>
        </span>
        {members.map((m, i) => (
          <div key={m.role} className="flex items-center gap-2">
            {m.group && (i === 0 || members[i - 1].group !== m.group) && (
              <span className="text-[0.68rem] font-semibold tracking-wide text-muted-foreground uppercase">{m.group}</span>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs whitespace-nowrap hover:bg-muted">
                  <span className={cn('size-2 rounded-full border', m.name ? 'border-emerald-600 bg-emerald-600' : 'border-muted-foreground')} />
                  <span className="font-medium">{m.role}</span>
                  {m.name ? <span>{m.name}</span> : <span className="text-muted-foreground italic">Unassigned</span>}
                  <ChevronDownIcon className="size-3 text-muted-foreground" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuLabel>{m.role}</DropdownMenuLabel>
                {(m.options ?? []).map((o) => (
                  <DropdownMenuItem key={o} onSelect={() => onAssign?.(m.role, o)}>
                    {o}
                  </DropdownMenuItem>
                ))}
                {m.allowCustom && onCustom && <DropdownMenuItem onSelect={() => onCustom(m.role)}>{m.name ? 'Change name…' : 'Enter name…'}</DropdownMenuItem>}
                {m.name && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => onAssign?.(m.role, null)}>Unassign</DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>
    </div>
  )
}
