import { Link } from 'react-router'
import { CalendarCheckIcon, KanbanIcon, PlusIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, PageHeader } from '@/components/shared'
import { useNewLead } from '@/components/leads/new-lead-context'
import { usePipeline } from '@/lib/api/loans'
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
          <EmptyState icon={CalendarCheckIcon} title="Nothing due" description="Follow-ups and tasks will appear here." />
        </Card>
      </div>
    </>
  )
}
