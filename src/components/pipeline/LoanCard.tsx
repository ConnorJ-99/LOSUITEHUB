import type * as React from 'react'
import { Link } from 'react-router'
import { MoreHorizontalIcon, UsersIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import type { PipelineLoan } from '@/lib/api/types'
import { daysSince, formatDaysInStage, fullName } from '@/lib/pipeline/helpers'
import { purposeLabel, type PipelineStage } from '@/lib/pipeline/stages'
import { StageMenu } from './StageMenu'

export interface LoanCardProps extends React.ComponentProps<'div'> {
  loan: PipelineLoan
  showLo?: boolean
  dragging?: boolean
  onStageSelect?: (stage: PipelineStage) => void
  onOpen?: () => void
}

/** Compact pipeline card: who, what kind of loan, how long in this stage. */
export function LoanCard({ loan, showLo, dragging, onStageSelect, onOpen, className, ...props }: LoanCardProps) {
  const days = daysSince(loan.stageChangedAt)
  return (
    <div
      onClick={onOpen}
      className={cn(
        'group cursor-pointer rounded-lg border bg-card p-3 text-sm transition-shadow select-none hover:shadow-sm',
        dragging && 'rotate-1 shadow-lg ring-2 ring-primary/30',
        className,
      )}
      {...props}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          to={`/loans/${loan.id}`}
          onClick={(e) => e.stopPropagation()}
          className="min-w-0 truncate font-medium hover:underline"
        >
          {fullName(loan.borrower)}
        </Link>
        {onStageSelect && (
          <StageMenu stage={loan.stage} onSelect={onStageSelect}>
            <Button
              variant="ghost"
              size="icon-xs"
              className="-mt-0.5 -mr-1 shrink-0 text-muted-foreground"
              aria-label={`Change stage for ${fullName(loan.borrower)}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontalIcon />
            </Button>
          </StageMenu>
        )}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {purposeLabel(loan.purpose)}
        {loan.coBorrowerCount > 0 && (
          <span className="ml-1.5 inline-flex items-center gap-0.5">
            <UsersIcon className="size-3" />+{loan.coBorrowerCount}
          </span>
        )}
      </p>
      <div className="mt-2 flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span className={cn(days >= 14 && loan.stage !== 'closed' && loan.stage !== 'nurture' && 'font-medium text-amber-700')}>
          {formatDaysInStage(days)}
        </span>
        {showLo && loan.assignedLo && <span className="truncate">{loan.assignedLo.name}</span>}
      </div>
      {loan.stage === 'lost' && loan.lostReason && (
        <p className="mt-2 line-clamp-2 border-t pt-2 text-xs text-muted-foreground">{loan.lostReason}</p>
      )}
    </div>
  )
}
