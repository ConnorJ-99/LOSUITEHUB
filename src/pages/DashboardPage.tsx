import { Link } from 'react-router'
import { cn } from 'cn'
import { CalendarCheckIcon, KanbanIcon, PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, PageHeader } from '@/components/shared'
import { useNewLead } from '@/components/leads/new-lead-context'
import { usePipeline } from '@/lib/api/loans'
import { useMyOpenTasks } from '@/lib/api/tasks'
import { dueLabel, todayIso } from '@/lib/dates'
import { useAuth } from '@/lib/auth/context'
import { isOnBoard } from '@/lib/pipeline/helpers'
import { STAGES } from '@/lib/pipeline/stages'

function PipelineSnapshot() {
  const pipeline = usePipeline()
  const { openNewLead } = useNewLead()

  if (pipeline.isLoading) return <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
  const loans = (pipeline.data ?? []).filter((l) => isOnBoard(l.stage, l.stageChangedAt))
  if (loans.length === 0) {
    return (
      <EmptyState
        icon={KanbanIcon}
        title="No leads yet"
        description={pipeline.isError ? pipeline.error.message : 'Add your first lead to start the pipeline.'}
        action={!pipeline.isError && <Button size="sm" onClick={openNewLead}><PlusIcon />New Lead</Button>}
      />
    )
  }

  const max = Math.max(...STAGES.map((s) => loans.filter((l) => l.stage === s.value).length), 1)
  return (
    <ul className="space-y-2">
      {STAGES.map((stage) => {
        const count = loans.filter((l) => l.stage === stage.value).length
        return (
          <li key={stage.value} className="grid grid-cols-[9rem_1fr_2rem] items-center gap-3 text-sm">
            <span className="truncate text-muted-foreground">{stage.label}</span>
            <span className="h-2 overflow-hidden rounded-full bg-muted">
              <span className="block h-full rounded-full bg-primary" style={{ width: `${(count / max) * 100}%` }} />
            </span>
            <span className="text-right font-medium tabular-nums">{count}</span>
          </li>
        )
      })}
    </ul>
  )
}

/** Open tasks assigned to me that are overdue, due today, or undated, plus the next few upcoming. */
function MyTasks() {
  const tasks = useMyOpenTasks()
  if (tasks.isLoading) return <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
  if (tasks.isError) return <EmptyState icon={CalendarCheckIcon} title="Couldn't load tasks" description={tasks.error.message} />

  const today = todayIso()
  const due = (tasks.data ?? []).filter((t) => !t.dueOn || t.dueOn <= today)
  const upcoming = (tasks.data ?? []).filter((t) => t.dueOn && t.dueOn > today).slice(0, 5)
  if (due.length === 0 && upcoming.length === 0) {
    return <EmptyState icon={CalendarCheckIcon} title="Nothing due" description="Add tasks from a borrower's Overview." />
  }

  const row = (t: (typeof due)[number]) => {
    const label = t.dueOn ? dueLabel(t.dueOn, today) : null
    return (
      <li key={t.id}>
        <Link to={`/loans/${t.loanId}`} className="block rounded-md px-2 py-1.5 hover:bg-muted">
          <p className="text-sm">{t.title}</p>
          <p className="text-xs text-muted-foreground">
            {t.borrowerName}
            {label && <span className={cn(label.overdue && 'font-medium text-destructive')}> · {label.text}</span>}
          </p>
        </Link>
      </li>
    )
  }

  return (
    <div className="space-y-3">
      {due.length > 0 ? <ul className="-mx-2">{due.map(row)}</ul> : <p className="text-sm text-muted-foreground">Nothing due today.</p>}
      {upcoming.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Coming up</p>
          <ul className="-mx-2">{upcoming.map(row)}</ul>
        </div>
      )}
    </div>
  )
}

export function DashboardPage() {
  const { state } = useAuth()
  const name = state.status === 'signedIn' || state.status === 'preview' ? state.user.fullName.split(' ')[0] : ''

  return (
    <>
      <PageHeader title={`Welcome${name ? `, ${name}` : ''}`} description="Your pipeline and tasks at a glance." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card
          title="Pipeline snapshot"
          className="lg:col-span-2"
          action={<Button variant="ghost" size="sm" asChild><Link to="/pipeline">Open pipeline</Link></Button>}
        >
          {state.status === 'preview' ? (
            <EmptyState icon={KanbanIcon} title="Preview mode" description="Connect Supabase to see your pipeline." />
          ) : (
            <PipelineSnapshot />
          )}
        </Card>
        <Card title="Today's tasks">
          {state.status === 'preview' ? (
            <EmptyState icon={CalendarCheckIcon} title="Preview mode" description="Connect Supabase to see your tasks." />
          ) : (
            <MyTasks />
          )}
        </Card>
      </div>
    </>
  )
}
