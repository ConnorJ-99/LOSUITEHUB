import { cn } from 'cn'
import { Badge } from '@/components/ui/badge'
import { stageLabel, type PipelineStage } from '@/lib/pipeline/stages'

/** Stage pill. Closed uses the accent color, Lost reads as a warning, the rest stay neutral. */
export function StageBadge({ stage, className }: { stage: PipelineStage; className?: string }) {
  const variant = stage === 'closed' ? 'default' : stage === 'lost' ? 'destructive' : stage === 'nurture' ? 'outline' : 'secondary'
  return (
    <Badge variant={variant} className={cn('whitespace-nowrap', className)}>
      {stageLabel(stage)}
    </Badge>
  )
}
