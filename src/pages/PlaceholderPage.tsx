import type { LucideIcon } from 'lucide-react'
import { Card, EmptyState, PageHeader } from '@/components/shared'

/** Stand-in for screens that are scheduled for a later build phase. */
export function PlaceholderPage({
  title,
  description,
  phase,
  icon,
}: {
  title: string
  description: string
  phase: string
  icon: LucideIcon
}) {
  return (
    <>
      <PageHeader title={title} />
      <Card>
        <EmptyState icon={icon} title={`Coming in ${phase}`} description={description} />
      </Card>
    </>
  )
}
