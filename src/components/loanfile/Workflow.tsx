import type * as React from 'react'
import { ArrowRightIcon, CalendarClockIcon, ChevronRightIcon, UsersIcon, type LucideIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { daysAtStep, groupCountLabel, groupCounts, type StepStatus } from '@/lib/loanfile/display'
import { StatusPill } from './HeaderParts'

// The Workflow on a loan file's Overview: the next-step card, the progress
// overview, and the step groups. Presentational only.

export interface ReadyItem {
  icon: LucideIcon
  label: string
  actionLabel: string
  onAction?: () => void
}

/** The single most important thing to do now, with one primary button, plus "also ready for you". */
export function NextStepCard({ icon: Icon, eyebrow, title, description, actionLabel, onAction, alsoReady = [] }: { icon: LucideIcon; eyebrow: string; title: string; description?: string; actionLabel: string; onAction?: () => void; alsoReady?: ReadyItem[] }) {
  return (
    <section className="rounded-xl border border-primary/25 bg-primary/5 p-4">
      <div className="flex flex-wrap items-start gap-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <Icon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[0.68rem] font-semibold tracking-wide text-primary uppercase">{eyebrow}</p>
          <h2 className="text-lg font-semibold">{title}</h2>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        <Button onClick={onAction} className="w-full sm:w-auto">
          {actionLabel}
          <ArrowRightIcon />
        </Button>
      </div>
      {alsoReady.length > 0 && (
        <div className="mt-4 border-t border-primary/15 pt-3">
          <p className="mb-2 text-[0.68rem] font-semibold tracking-wide text-muted-foreground uppercase">Also ready for you</p>
          <ul className="space-y-2">
            {alsoReady.map((r) => (
              <li key={r.label} className="flex items-center gap-3">
                <span className="flex size-7 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <r.icon className="size-3.5" />
                </span>
                <span className="flex-1 text-sm font-medium">{r.label}</span>
                <Button size="sm" variant="outline" onClick={r.onAction}>
                  {r.actionLabel}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

export interface ProgressGroup {
  name: string
  steps: StepStatus[]
  current?: boolean
}

const SEGMENT: Record<StepStatus, string> = {
  done: 'bg-emerald-600',
  ready: 'bg-primary',
  in_progress: 'bg-sky-400',
  blocked: 'bg-red-500',
  not_started: 'bg-muted',
  na: 'bg-muted/50',
}

/** One segmented bar per group (a segment per step): done green, ready accent, blocked red. */
export function GroupProgress({ groups, summary }: { groups: ProgressGroup[]; summary?: string }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {groups.map((g) => {
          const counts = groupCounts(g.steps)
          return (
            <div key={g.name} className="space-y-1.5">
              <p className={cn('flex items-center gap-1.5 text-[0.7rem] font-semibold tracking-wide uppercase', g.current ? 'text-primary' : 'text-muted-foreground')}>
                {g.name}
                {g.current && <span className="size-1.5 rounded-full bg-primary" aria-label="Current group" />}
              </p>
              <div className="flex gap-1">
                {g.steps.filter((s) => s !== 'na').map((s, i) => (
                  <span key={i} className={cn('h-1.5 flex-1 rounded-full', SEGMENT[s])} />
                ))}
              </div>
              <p className="text-xs text-muted-foreground tabular-nums">{groupCountLabel(counts)}</p>
            </div>
          )
        })}
      </div>
      {summary && <p className="mt-3 border-t pt-3 text-sm text-muted-foreground">{summary}</p>}
    </section>
  )
}

export interface StepRowProps {
  icon: LucideIcon
  name: string
  owner: string
  status: StepStatus
  /** Shown in red under the name when the step is blocked. */
  reason?: string
  actionLabel?: string
  onAction?: () => void
  /** A quieter second button, e.g. "N/A" or "Undo". */
  secondaryLabel?: string
  onSecondary?: () => void
  /** Extra text under the owner, e.g. "Done Oct 21" or "2 required fields missing". */
  detail?: string
  busy?: boolean
}

/** One workflow step: icon, name and owner, status pill, and an outlined action button. */
export function StepRow({ icon: Icon, name, owner, status, reason, actionLabel, onAction, secondaryLabel, onSecondary, detail, busy }: StepRowProps) {
  return (
    <li className="flex items-start gap-3 px-3 py-3">
      <span className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md', status === 'blocked' ? 'bg-red-50 text-red-600' : status === 'done' ? 'bg-emerald-50 text-emerald-700' : 'bg-muted text-muted-foreground')}>
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('text-sm font-medium', status === 'na' && 'text-muted-foreground')}>{name}</span>
          <StatusPill status={status} />
        </div>
        <p className="text-xs text-muted-foreground">
          {owner}
          {detail && ` · ${detail}`}
        </p>
        {status === 'blocked' && reason && <p className="mt-0.5 text-xs text-red-600">{reason}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {secondaryLabel && (
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={onSecondary} disabled={busy}>
            {secondaryLabel}
          </Button>
        )}
        {actionLabel && (
          <Button size="sm" variant="outline" onClick={onAction} disabled={status === 'blocked' || busy}>
            {actionLabel}
          </Button>
        )}
      </div>
    </li>
  )
}

export interface StepGroupProps {
  name: string
  statuses: StepStatus[]
  open: boolean
  onToggle: () => void
  /** The group the file is in now: accent border and "You are here". */
  current?: boolean
  waitingOn?: string
  days?: number
  children?: React.ReactNode
}

/** An accordion of steps with "x/y" and a "2 ready" chip; the current group shows who it's waiting on and for how long. */
export function StepGroup({ name, statuses, open, onToggle, current, waitingOn, days, children }: StepGroupProps) {
  const c = groupCounts(statuses)
  return (
    <section className={cn('rounded-xl border bg-card', current && 'border-primary/40 ring-1 ring-primary/20')}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <ChevronRightIcon className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-90')} />
        <span className="font-medium">{name}</span>
        {current && <span className="rounded-md bg-primary px-1.5 py-0.5 text-[0.7rem] font-medium text-primary-foreground">You are here</span>}
        <span className="ml-auto text-sm text-muted-foreground tabular-nums">
          {c.done}/{c.total}
        </span>
        {c.ready > 0 && <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[0.7rem] font-medium text-primary">{c.ready} ready</span>}
      </button>
      {open && (
        <div className="space-y-2 px-3 pb-3">
          {current && (waitingOn || days !== undefined) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 rounded-md bg-primary/5 px-3 py-1.5 text-xs">
              {waitingOn && (
                <span className="inline-flex items-center gap-1.5">
                  <UsersIcon className="size-3.5 text-muted-foreground" />
                  Waiting on <span className="font-medium">{waitingOn}</span>
                </span>
              )}
              {days !== undefined && (
                <span className="inline-flex items-center gap-1.5">
                  <CalendarClockIcon className="size-3.5 text-muted-foreground" />
                  <span className="font-medium">{daysAtStep(days)}</span>
                </span>
              )}
            </div>
          )}
          <ul className="divide-y rounded-lg border">{children}</ul>
        </div>
      )}
    </section>
  )
}
