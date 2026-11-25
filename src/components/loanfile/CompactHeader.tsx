import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeftIcon, CheckIcon, ChevronDownIcon, MoreHorizontalIcon, UsersIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { Milestone, TeamMember } from './HeaderParts'

// The compact loan file header (UI pass, Part 1; trimmed by Connor 2026-11-24).
//   row 1  back · name · star · loan type · actions (Quick quote, Change status, "…")
//   row 2  the property address (and, once under contract, lender and loan numbers)
//          with a "Loan details" fold for the numbers before that
//   row 3  key figures, small label over value; each opens where it's edited
//   row 4  chevron progress (click = change status), the next step, team avatars
// Scrolled past it, a slim bar sticks to the top. Presentational only.

export interface KeyFigure {
  label: string
  value: string
  /** Opens where the figure is edited (a tab), when there is one. */
  onClick?: () => void
  /** Hover text, e.g. the full address. */
  title?: string
  tone?: 'green' | 'amber' | 'red'
  /** Small text after the value, e.g. "Good". */
  note?: string
}

const DOT = { green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500' }
const isFigure = (v: string) => /^[$\d.,%\s/—-]+$/.test(v)

function Figure({ f, compact }: { f: KeyFigure; compact?: boolean }) {
  const body = (
    <>
      <span className="block text-[0.62rem] font-semibold tracking-wide whitespace-nowrap text-muted-foreground uppercase">{f.label}</span>
      <span className={cn('flex items-center gap-1 font-semibold whitespace-nowrap', compact ? 'text-[0.8rem]' : 'text-[0.82rem]', isFigure(f.value) && 'tabular-nums', f.value.startsWith('$') && 'text-money', f.label === 'Property' && 'max-w-56 truncate')}>
        {f.value}
        {f.note && <span className="text-[0.7rem] font-normal text-muted-foreground">{f.note}</span>}
        {f.tone && <span className={cn('size-1.5 rounded-full', DOT[f.tone])} aria-label={f.tone} />}
      </span>
    </>
  )
  return f.onClick ? (
    <button type="button" onClick={f.onClick} title={f.title ?? `Edit ${f.label.toLowerCase()}`} className="shrink-0 rounded px-1 py-0.5 text-left hover:bg-muted">
      {body}
    </button>
  ) : (
    <div className="shrink-0 px-1 py-0.5" title={f.title}>
      {body}
    </div>
  )
}

/** Key figures in one line; swipes sideways on a phone. */
export function KeyFigures({ figures, compact }: { figures: KeyFigure[]; compact?: boolean }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] md:mx-0 md:px-0 [&::-webkit-scrollbar]:hidden">
      <div className="flex min-w-max items-center gap-x-4">
        {figures.map((f) => (
          <Figure key={f.label} f={f} compact={compact} />
        ))}
      </div>
    </div>
  )
}

/**
 * Milestones as a segmented chevron bar ("Application › Disclosures › …").
 * The current milestone's name shows as text; every segment's full name is
 * on hover. The whole bar is a button (wrap it in the status menu).
 */
export function ChevronProgress({ milestones, current, ...props }: { milestones: Milestone[]; current: string } & React.ComponentProps<'button'>) {
  const at = milestones.findIndex((m) => m.state === 'current')
  return (
    <button type="button" {...props} className={cn('group flex min-w-0 items-center gap-2 rounded-md text-left', props.className)} title="Change status">
      <span className="flex shrink-0" aria-hidden>
        {milestones.map((m, i) => (
          <span
            key={m.label}
            title={`${m.label}${m.date ? ` · ${m.date}` : ''}`}
            className={cn(
              'h-4 w-5 sm:w-6',
              i === 0 ? '[clip-path:polygon(0_0,75%_0,100%_50%,75%_100%,0_100%)]' : '-ml-0.5 [clip-path:polygon(0_0,75%_0,100%_50%,75%_100%,0_100%,25%_50%)]',
              m.state === 'done' && 'bg-emerald-600',
              m.state === 'current' && 'bg-primary',
              m.state === 'future' && 'bg-border',
              m.state === 'failed' && 'bg-red-500',
            )}
          />
        ))}
      </span>
      <span className="truncate text-xs">
        <span className="font-semibold text-primary">{current}</span>
        {at >= 0 && milestones[at] && milestones[at].label !== current && <span className="text-muted-foreground"> › {milestones[at].label}</span>}
        <span className="text-muted-foreground"> · {milestones.filter((m) => m.state === 'done').length}/{milestones.length}</span>
      </span>
      <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
    </button>
  )
}

/** One "Team 3/6" chip with small avatars; opens the assignment menus (same choices as before). */
export function TeamChip({ members, onAssign, onCustom }: { members: TeamMember[]; onAssign?: (role: string, name: string | null) => void; onCustom?: (role: string) => void }) {
  const assigned = members.filter((m) => m.name)
  const initials = (n: string) =>
    n
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase())
      .join('')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="inline-flex shrink-0 items-center rounded-full p-0.5 hover:bg-muted" title={assigned.length ? `Team: ${assigned.map((m) => `${m.role} ${m.name}`).join(', ')}` : 'Assign the team'} aria-label="Team on this file">
          {assigned.length ? (
            <span className="flex -space-x-1.5">
              {assigned.slice(0, 5).map((m) => (
                <span key={m.role} className="flex size-6 items-center justify-center rounded-full border-2 border-card bg-primary/15 text-[0.6rem] font-semibold text-primary">
                  {initials(m.name!)}
                </span>
              ))}
              {assigned.length > 5 && <span className="flex size-6 items-center justify-center rounded-full border-2 border-card bg-muted text-[0.6rem] font-semibold">+{assigned.length - 5}</span>}
            </span>
          ) : (
            <span className="flex size-6 items-center justify-center rounded-full border border-dashed text-muted-foreground">
              <UsersIcon className="size-3.5" />
            </span>
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel>Team on this file</DropdownMenuLabel>
        {members.map((m, i) => (
          <div key={m.role}>
            {m.group && (i === 0 || members[i - 1].group !== m.group) && <p className="px-2 pt-1.5 text-[0.62rem] font-semibold tracking-wide text-muted-foreground uppercase">{m.group}</p>}
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="gap-2">
                <span className={cn('size-2 shrink-0 rounded-full border', m.name ? 'border-emerald-600 bg-emerald-600' : 'border-muted-foreground')} />
                <span className="font-medium">{m.role}</span>
                <span className={cn('ml-auto truncate pl-2', !m.name && 'text-muted-foreground italic')}>{m.name ?? 'Unassigned'}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {(m.options ?? []).map((o) => (
                  <DropdownMenuItem key={o} onSelect={() => onAssign?.(m.role, o)}>
                    {o === m.name && <CheckIcon />}
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
                {!m.options?.length && !(m.allowCustom && onCustom) && !m.name && <DropdownMenuItem disabled>No one to pick</DropdownMenuItem>}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The "…" menu for less-used actions (Delete). */
export function OverflowMenu({ children }: { children: React.ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon-sm" variant="outline" aria-label="More actions">
          <MoreHorizontalIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">{children}</DropdownMenuContent>
    </DropdownMenu>
  )
}

export interface CompactHeaderProps {
  borrowerName: string
  backTo: string
  backLabel: string
  /** Right after the name: the star, loan type and role chips. */
  chips: React.ReactNode
  /** Under the name: the property address (and lender details once under contract). */
  subline?: React.ReactNode
  /** Folded loan details (lender and loan numbers); no fold when absent. */
  details?: React.ReactNode
  /** Right side of row 1. */
  actions: React.ReactNode
  /** Whether the "Loan details" fold is open. */
  detailsOpen: boolean
  onToggleDetails: () => void
  figures: KeyFigure[]
  /** Row 3, left: the chevron progress (or a closed / lost note). */
  progress?: React.ReactNode
  /** Row 3, right: the team chip. */
  team?: React.ReactNode
  notice?: React.ReactNode
  /** The slim bar shown once the header scrolls away. */
  slim: { status: string | null; figures: KeyFigure[]; action: React.ReactNode }
}

/** The loan file header: ~120px with details, one row without; a ~44px bar sticks once it scrolls away. */
export function CompactHeader({ borrowerName, backTo, backLabel, chips, subline, details, actions, detailsOpen, onToggleDetails, figures, progress, team, notice, slim }: CompactHeaderProps) {
  const ref = useRef<HTMLElement>(null)
  const [scrolledPast, setScrolledPast] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([e]) => setScrolledPast(!e.isIntersecting && e.boundingClientRect.top < 0), { threshold: 0 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return (
    <>
      <header ref={ref} className="-mx-4 -mt-6 space-y-1.5 border-b bg-card px-4 pt-2.5 pb-2 md:-mx-6 md:px-6">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <Link to={backTo} title={`Back to ${backLabel}`} aria-label={`Back to ${backLabel}`} className="rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground">
            <ArrowLeftIcon className="size-4" />
          </Link>
          <h1 className="text-xl leading-tight font-bold tracking-tight">{borrowerName}</h1>
          {chips}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">{actions}</div>
        </div>
        {(subline || details) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-6 text-sm">
            {subline}
            {details && (
              <button type="button" onClick={onToggleDetails} aria-expanded={detailsOpen} className="inline-flex items-center gap-0.5 text-xs text-muted-foreground hover:text-foreground">
                Loan details
                <ChevronDownIcon className={cn('size-3.5 transition-transform', detailsOpen && 'rotate-180')} />
              </button>
            )}
          </div>
        )}
        {details && detailsOpen && <div className="flex flex-wrap items-center gap-2 pl-6">{details}</div>}
        <KeyFigures figures={figures} />
        {(progress || team) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <div className="min-w-0 flex-1">{progress}</div>
            {team}
          </div>
        )}
        {notice}
      </header>
      {/* Takes no space; sticks to the top once the header has scrolled away. */}
      <div className={cn('sticky top-0 z-30 -mx-4 -mb-11 hidden h-11 transition-opacity md:-mx-6 md:block', scrolledPast ? 'opacity-100' : 'pointer-events-none opacity-0')} aria-hidden={!scrolledPast}>
        <div className="flex h-11 items-center gap-3 border-b bg-card/95 px-4 shadow-sm backdrop-blur md:px-6">
          <span className="truncate text-sm font-bold">{borrowerName}</span>
          {slim.status && <span className="hidden shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[0.7rem] font-medium sm:inline">{slim.status}</span>}
          <div className="hidden min-w-0 flex-1 overflow-hidden md:block">
            <KeyFigures figures={slim.figures} compact />
          </div>
          <div className="ml-auto shrink-0">{slim.action}</div>
        </div>
      </div>
    </>
  )
}
