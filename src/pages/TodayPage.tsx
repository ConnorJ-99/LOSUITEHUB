import { Link } from 'react-router'
import { cn } from 'cn'
import { CalendarClockIcon, CheckIcon, InboxIcon, KanbanIcon, ListTodoIcon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, PageHeader } from '@/components/shared'
import { useNewLead } from '@/components/leads/new-lead-context'
import { ActionEntry } from '@/components/queue/ActionEntry'
import { usePipeline } from '@/lib/api/loans'
import { useTodayData, type FileInfo } from '@/lib/api/queue'
import { useMyOpenTasks, useToggleTask } from '@/lib/api/tasks'
import { useAuth } from '@/lib/auth/context'
import { formatIsoDate, todayIso } from '@/lib/dates'
import { formatCompactCurrency } from '@/lib/format'
import { pipelineTiles } from '@/lib/pipeline/leadsHome'
import { pipelineInfo } from '@/lib/pipeline/pipelines'
import { priorityTone, toneBorder } from '@/lib/pipeline/priority'
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
      <PageHeader
        title={`Today${name ? `, ${name}` : ''}`}
        description={`${formatIsoDate(today)} · ${waiting} waiting for your approval`}
        action={
          <Button size="sm" onClick={() => openNewLead()}>
            <PlusIcon />
            New Lead
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="min-w-0 space-y-5">
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
        <Card title="Pipeline" action={<Button variant="ghost" size="sm" asChild><Link to="/pipeline"><KanbanIcon />Open</Link></Button>}>
          <PipelineSnapshot />
        </Card>
      </div>
    </>
  )
}
