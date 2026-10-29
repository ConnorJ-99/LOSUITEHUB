import { Link } from 'react-router'
import { cn } from 'cn'
import { CalculatorIcon, CalendarClockIcon, CalendarDaysIcon, CheckIcon, FilePlus2Icon, InboxIcon, KanbanIcon, ListTodoIcon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, HeroBand, PageHeader, QuickAction, SectionTitle } from '@/components/shared'
import { useNewLead } from '@/components/leads/new-lead-context'
import { ActionEntry } from '@/components/queue/ActionEntry'
import { usePipeline } from '@/lib/api/loans'
import { useTodayData, type FileInfo } from '@/lib/api/queue'
import { useMyOpenTasks, useToggleTask } from '@/lib/api/tasks'
import type { PipelineLoan } from '@/lib/api/types'
import { useAuth } from '@/lib/auth/context'
import { formatIsoDate, todayIso } from '@/lib/dates'
import { formatCompactCurrency } from '@/lib/format'
import { CLOSING_STYLE, closingsGlance, monthLabel, type ClosingStatus } from '@/lib/pipeline/closings'
import { fullName } from '@/lib/pipeline/helpers'
import { pipelineTiles } from '@/lib/pipeline/leadsHome'
import { cardAmount, pipelineInfo, stageLabelFor } from '@/lib/pipeline/pipelines'
import { priorityTone, toneBorder } from '@/lib/pipeline/priority'
import { purposeLabel, stageLabel } from '@/lib/pipeline/stages'
import { WebLeadsCard } from '@/components/queue/WebLeadsCard'
import { buildToday, groupToday, type TodayEntry } from '@/lib/queue/today'

function TaskRow({ entry }: { entry: Extract<TodayEntry, { type: 'task' }> }) {
  const toggle = useToggleTask(entry.loanId)
  return (
    <div className={cn('flex items-center gap-3 rounded-lg bg-card px-3 py-2 shadow-soft', toneBorder(priorityTone([entry.task.dueOn], null, todayIso())))}>
      <ListTodoIcon className="size-4 shrink-0 text-muted-foreground" />
      <Link to={`/loans/${entry.loanId}`} className="min-w-0 flex-1 hover:underline">
        <p className="truncate text-sm">{entry.task.title}</p>
        <p className="text-xs text-muted-foreground">
          {entry.borrowerName}
          {entry.task.dueOn ? ` · due ${formatIsoDate(entry.task.dueOn)}` : ' · no due date'}
        </p>
      </Link>
      <Button
        size="xs"
        variant="outline"
        disabled={toggle.isPending}
        onClick={() => toggle.mutate({ id: entry.task.id, done: true }, { onSuccess: () => toast.success('Task done'), onError: (e) => toast.error(e.message) })}
      >
        <CheckIcon />
        Done
      </Button>
    </div>
  )
}

function DateRow({ entry }: { entry: Extract<TodayEntry, { type: 'date' }> }) {
  return (
    <Link to={`/loans/${entry.loanId}`} className={cn('flex items-center gap-3 rounded-lg bg-card px-3 py-2 shadow-soft hover:underline', toneBorder(priorityTone([entry.date], null, todayIso())))}>
      <CalendarClockIcon className="size-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">
          {entry.label}: {formatIsoDate(entry.date)}
        </p>
        <p className="text-xs text-muted-foreground">{entry.borrowerName}</p>
      </div>
    </Link>
  )
}

function Entries({ entries, files }: { entries: TodayEntry[]; files: Map<string, FileInfo> }) {
  return (
    <div className="space-y-2">
      {entries.map((e) =>
        e.type === 'action' ? (
          <ActionEntry key={`a-${e.item.id}`} item={e.item} file={files.get(e.item.id)!} showFile />
        ) : e.type === 'task' ? (
          <TaskRow key={`t-${e.task.id}`} entry={e} />
        ) : (
          <DateRow key={`d-${e.loanId}-${e.label}`} entry={e} />
        ),
      )}
    </div>
  )
}

/** Each pipeline with files in it, its count and dollar total; one click opens that board. */
function PipelineSnapshot() {
  const pipeline = usePipeline()
  if (pipeline.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  const tiles = pipelineTiles(pipeline.data ?? []).filter((t) => t.count > 0)
  if (tiles.length === 0) return <p className="text-sm text-muted-foreground">No active files.</p>
  return (
    <ul className="space-y-1 text-sm">
      {tiles.map((t) => (
        <li key={t.id}>
          <Link to={`/pipeline/${t.id}`} className="-mx-2 flex items-baseline gap-2 rounded-md px-2 py-1 hover:bg-muted">
            <span className="mr-auto text-muted-foreground">{pipelineInfo(t.id).label}</span>
            <span className="text-xs font-medium text-money tabular-nums">{formatCompactCurrency(t.total)}</span>
            <span className="w-6 text-right font-medium tabular-nums">{t.count}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

type Closing = PipelineLoan & { closingDate: string }

/** One closing in the home page box; a date that went by opens the tab where the date is fixed. */
function ClosingLine({ closing: c, status }: { closing: Closing; status: ClosingStatus }) {
  const to = status === 'date_passed' ? `/loans/${c.id}?tab=${c.purpose === 'purchase' ? 'contract' : 'overview'}` : `/loans/${c.id}`
  return (
    <li>
      <Link to={to} className="-mx-2 flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted">
        <span className={cn('w-14 shrink-0 rounded-md px-1.5 py-1 text-center text-xs font-semibold tabular-nums', CLOSING_STYLE[status])}>{formatIsoDate(c.closingDate).replace(/, \d{4}$/, '')}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{fullName(c.borrower)}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {purposeLabel(c.purpose)} · {stageLabelFor(c.stage, c.purpose, stageLabel(c.stage))}
          </span>
        </span>
        {cardAmount(c) !== null && <span className="shrink-0 text-xs font-medium text-money tabular-nums">{formatCompactCurrency(cardAmount(c))}</span>}
      </Link>
    </li>
  )
}

/** This month's closings, dates that went by without closing (red), and the next five; the full calendar is one click away. */
function ClosingsGlance() {
  const pipeline = usePipeline()
  if (pipeline.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (pipeline.isError) return <p className="text-sm text-destructive">{pipeline.error.message}</p>
  const today = todayIso()
  const { thisMonth, datePassed, upcoming, noDate } = closingsGlance(pipeline.data ?? [], today)
  const total = thisMonth.reduce((sum, c) => sum + (cardAmount(c) ?? 0), 0)
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
        <span className="mr-auto font-medium">{monthLabel(today.slice(0, 7))}</span>
        <span className="text-muted-foreground tabular-nums">
          {thisMonth.length} {thisMonth.length === 1 ? 'closing' : 'closings'}
        </span>
        <span className="font-medium text-money tabular-nums">{formatCompactCurrency(total)}</span>
      </div>
      {datePassed.length > 0 && (
        <section className="space-y-1">
          <h3 className="text-xs font-semibold tracking-wide text-urgent uppercase">Date passed ({datePassed.length})</h3>
          <ul>
            {datePassed.map((c) => (
              <ClosingLine key={c.id} closing={c} status="date_passed" />
            ))}
          </ul>
        </section>
      )}
      <section className="space-y-1">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Coming up</h3>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted-foreground">No closings scheduled.</p>
        ) : (
          <ul>
            {upcoming.map((c) => (
              <ClosingLine key={c.id} closing={c} status="upcoming" />
            ))}
          </ul>
        )}
      </section>
      {noDate.length > 0 && (
        <Link to="/pipeline/closings" className="block rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground hover:text-foreground">
          {noDate.length} {noDate.length === 1 ? 'file needs' : 'files need'} a closing date
        </Link>
      )}
    </div>
  )
}

/** Today: every file's queue items, tasks and deadlines in one list, so the day runs from here. */
export function TodayPage() {
  const { state } = useAuth()
  const { openNewLead } = useNewLead()
  const data = useTodayData()
  const tasks = useMyOpenTasks()
  const name = state.status === 'signedIn' || state.status === 'preview' ? state.user.fullName.split(' ')[0] : ''

  if (state.status === 'preview') {
    return (
      <>
        <PageHeader title="Today" />
        <EmptyState icon={InboxIcon} title="Preview mode" description="Connect Supabase to see your day." />
      </>
    )
  }

  const today = todayIso()
  const loading = data.isLoading || tasks.isLoading
  const error = data.error ?? tasks.error
  const files = new Map((data.data?.actions ?? []).map((a) => [a.id, a]))
  const entries = buildToday(
    data.data?.actions ?? [],
    (tasks.data ?? []).map((t) => ({ id: t.id, loanId: t.loanId, borrowerName: t.borrowerName, title: t.title, dueOn: t.dueOn })),
    data.data?.loans ?? [],
    today,
  )
  const groups = groupToday(entries, today)
  const waiting = entries.filter((e) => e.type === 'action').length

  return (
    <>
      <HeroBand
        eyebrow="Your workspace"
        title={name ? 'Welcome back,' : 'Welcome back'}
        highlight={name || undefined}
        subtitle={
          <>
            {formatIsoDate(today)} · <span className="rounded-md bg-white/10 px-1.5 py-0.5 font-medium text-sky-300">{waiting} waiting for your approval</span>
          </>
        }
        action={
          <Button onClick={() => openNewLead()}>
            <PlusIcon />
            New Lead
          </Button>
        }
      />
      <div className="mb-7 grid gap-3 md:grid-cols-3">
        <QuickAction icon={CalculatorIcon} title="Price a loan" description="Search your lenders' matrices for a scenario." to="/product-search" />
        <QuickAction icon={FilePlus2Icon} title="Start a new lead" description="Add a borrower and take the prequal call." onClick={() => openNewLead()} />
        <QuickAction icon={KanbanIcon} title="Open the pipeline" description="Every file by stage, with tasks under each card." to="/pipeline" tone="green" />
      </div>
      {/* On a phone closings come first, then the day, then the pipeline; on a computer both boxes sit in the right column. */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem] lg:grid-rows-[auto_1fr]">
        <div className="min-w-0 lg:col-start-2 lg:row-start-1">
          <SectionTitle eyebrow="Closings" title="Closing" highlight="calendar" />
          <Card className="border-t-2 border-t-primary" action={<Button variant="ghost" size="sm" asChild><Link to="/pipeline/closings"><CalendarDaysIcon />Open</Link></Button>} title="Closings">
            <ClosingsGlance />
          </Card>
        </div>
        <div className="min-w-0 space-y-5 lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <SectionTitle eyebrow="Today" title="Your day," highlight="at a glance" />
          <WebLeadsCard />
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : error ? (
            <p className="text-sm text-destructive">{error.message}</p>
          ) : entries.length === 0 ? (
            <Card>
              <EmptyState icon={InboxIcon} title="All clear" description="No approvals, tasks or deadlines right now." />
            </Card>
          ) : (
            (
              [
                ['Overdue', groups.overdue],
                ['Today', groups.today],
                ['Coming up', groups.upcoming],
              ] as const
            ).map(([label, list]) =>
              list.length ? (
                <section key={label} className="space-y-2">
                  <h2 className={label === 'Overdue' ? 'text-xs font-semibold tracking-wide text-destructive uppercase' : 'text-xs font-semibold tracking-wide text-muted-foreground uppercase'}>
                    {label} ({list.length})
                  </h2>
                  <Entries entries={list} files={files} />
                </section>
              ) : null,
            )
          )}
        </div>
        <div className="lg:col-start-2 lg:row-start-2">
          <SectionTitle eyebrow="Pipeline" title="Pipeline" highlight="snapshot" />
          <Card className="border-t-2 border-t-primary" action={<Button variant="ghost" size="sm" asChild><Link to="/pipeline"><KanbanIcon />Open</Link></Button>} title="By pipeline">
            <PipelineSnapshot />
          </Card>
        </div>
      </div>
    </>
  )
}
