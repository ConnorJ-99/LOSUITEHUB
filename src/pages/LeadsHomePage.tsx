import { Link } from 'react-router'
import { ArrowRightIcon, CalendarDaysIcon, CircleXIcon, InboxIcon, KanbanIcon, LandmarkIcon, LeafIcon, PlusIcon, RefreshCwIcon, StarIcon, TrendingUpIcon, TriangleAlertIcon, UsersIcon, WorkflowIcon, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, EmptyState } from '@/components/shared'
import { useNewLead } from '@/components/leads/new-lead-context'
import { usePipeline } from '@/lib/api/loans'
import { formatCompactCurrency } from '@/lib/format'
import { formatPhone, fullName } from '@/lib/pipeline/helpers'
import { calendarClosings } from '@/lib/pipeline/closings'
import { pipelineTiles, priorityLeads } from '@/lib/pipeline/leadsHome'
import { priorityTone, toneBorder } from '@/lib/pipeline/priority'
import { useOpenTasks } from '@/lib/api/tasks'
import { todayIso } from '@/lib/dates'
import { cn } from 'cn'
import { cardAmount, pipelineInfo, PIPELINES, type PipelineId } from '@/lib/pipeline/pipelines'

const ICON: Record<PipelineId, LucideIcon> = {
  new_leads: InboxIcon,
  purchase: UsersIcon,
  refinance: RefreshCwIcon,
  investment: TrendingUpIcon,
  heloc: LandmarkIcon,
  in_process: WorkflowIcon,
  nurture: LeafIcon,
  lost: CircleXIcon,
}

/** Leads home (Pipeline v2): Priority Leads, then a tile for each pipeline with its count and dollar total. */
export function LeadsHomePage() {
  const pipeline = usePipeline()
  const openTasks = useOpenTasks()
  const today = todayIso()
  const { openNewLead } = useNewLead()
  const files = pipeline.data ?? []
  const priority = priorityLeads(files)
  const tiles = new Map(pipelineTiles(files).map((t) => [t.id, t]))
  const closingsThisMonth = calendarClosings(files).filter((c) => c.closingDate.startsWith(today.slice(0, 7)))

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="text-center">
        <h1 className="text-4xl leading-tight">Leads</h1>
        <p className="text-sm text-muted-foreground">Pick the pipeline you want to work.</p>
        <div className="mt-3 flex justify-center gap-2">
          <Button onClick={() => openNewLead()}>
            <PlusIcon />
            New Lead
          </Button>
          <Button variant="outline" asChild>
            <Link to="/pipeline/all">
              <KanbanIcon />
              All loans
            </Link>
          </Button>
        </div>
      </div>

      {pipeline.isLoading && <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>}
      {pipeline.isError && (
        <Card>
          <EmptyState icon={TriangleAlertIcon} title="Couldn't load your leads" description={pipeline.error.message} action={<Button variant="outline" onClick={() => pipeline.refetch()}>Try again</Button>} />
        </Card>
      )}

      {pipeline.isSuccess && (
        <>
          <section className="space-y-2">
            <h2 className="flex items-center gap-1.5 text-sm font-medium">
              <StarIcon className="size-4 fill-amber-400 text-amber-500" />
              Priority Leads
              <span className="text-muted-foreground tabular-nums">{priority.length}</span>
            </h2>
            {priority.length === 0 ? (
              <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">Star a file (the Star button at the top of a loan) to keep it here.</p>
            ) : (
              <ul className="space-y-2">
                {priority.map(({ file, pipeline: where }) => (
                  <li key={file.id}>
                    <Link to={`/loans/${file.id}`} className={cn('flex items-center gap-3 rounded-xl bg-card px-4 py-3 shadow-soft transition-shadow hover:shadow-md', toneBorder(priorityTone((openTasks.data?.get(file.id) ?? []).map((t) => t.dueOn), file.stage, today)))}>
                      <StarIcon className="size-4 shrink-0 fill-amber-400 text-amber-500" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{fullName(file.borrower)}</span>
                        <span className="font-mono text-sm text-muted-foreground">{formatPhone(file.borrower?.phone) || 'No phone'}</span>
                      </span>
                      {where && <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">{pipelineInfo(where).label}</span>}
                      <ArrowRightIcon className="size-4 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="grid gap-3 sm:grid-cols-2">
            {PIPELINES.map((p) => {
              const Icon = ICON[p.id]
              const tile = tiles.get(p.id)!
              return (
                <Link key={p.id} to={`/pipeline/${p.id}`} className="flex flex-col gap-3 rounded-2xl bg-card p-5 shadow-soft transition-shadow hover:shadow-md">
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Icon className="size-5" />
                    </span>
                    <span className="text-right">
                      <span className="block text-2xl font-semibold tabular-nums">{tile.count}</span>
                      <span className="text-xs font-medium text-money tabular-nums">{formatCompactCurrency(tile.total)}</span>
                    </span>
                  </div>
                  <span>
                    <span className="block font-heading text-xl">{p.label}</span>
                    <span className="text-sm text-muted-foreground">{p.description}</span>
                  </span>
                </Link>
              )
            })}
            <Link to="/pipeline/closings" className="flex flex-col gap-3 rounded-2xl bg-card p-5 shadow-soft transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <CalendarDaysIcon className="size-5" />
                </span>
                <span className="text-right">
                  <span className="block text-2xl font-semibold tabular-nums">{closingsThisMonth.length}</span>
                  <span className="text-xs font-medium text-money tabular-nums">{formatCompactCurrency(closingsThisMonth.reduce((sum, c) => sum + (cardAmount(c) ?? 0), 0))}</span>
                </span>
              </div>
              <span>
                <span className="block font-heading text-xl">Closing calendar</span>
                <span className="text-sm text-muted-foreground">Closings this month, by date</span>
              </span>
            </Link>
          </section>
        </>
      )}
    </div>
  )
}
