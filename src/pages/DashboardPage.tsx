import { CalendarCheckIcon, KanbanIcon } from 'lucide-react'
import { Card, EmptyState, PageHeader } from '@/components/shared'
import { useAuth } from '@/lib/auth/context'

export function DashboardPage() {
  const { state } = useAuth()
  const name = state.status === 'signedIn' || state.status === 'preview' ? state.user.fullName.split(' ')[0] : ''

  return (
    <>
      <PageHeader title={`Welcome${name ? `, ${name}` : ''}`} description="Your pipeline and tasks at a glance." />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Pipeline snapshot" className="lg:col-span-2">
          <EmptyState
            icon={KanbanIcon}
            title="No leads yet"
            description="Once lead capture is built in Phase 1, counts by stage will show here."
          />
        </Card>
        <Card title="Today's tasks">
          <EmptyState icon={CalendarCheckIcon} title="Nothing due" description="Follow-ups and tasks will appear here." />
        </Card>
      </div>
    </>
  )
}
