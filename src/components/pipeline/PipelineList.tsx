import { useNavigate } from 'react-router'
import { ChevronDownIcon } from 'lucide-react'
import { DataTable } from '@/components/shared'
import type { PipelineLoan } from '@/lib/api/types'
import { daysSince, formatDaysInStage, formatPhone, fullName } from '@/lib/pipeline/helpers'
import { purposeLabel, type PipelineStage } from '@/lib/pipeline/stages'
import { StageBadge } from './StageBadge'
import { StageMenu } from './StageMenu'

type RequestChange = (loan: { id: string; stage: PipelineStage; borrowerName: string }, stage: PipelineStage) => void

const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

/** Table view of the pipeline. Click a row to open the record; click the stage to change it. */
export function PipelineList({ loans, showLo, onRequestChange }: { loans: PipelineLoan[]; showLo: boolean; onRequestChange: RequestChange }) {
  const navigate = useNavigate()
  return (
    <DataTable
      rows={loans}
      rowKey={(l) => l.id}
      onRowClick={(l) => navigate(`/loans/${l.id}`)}
      columns={[
        {
          key: 'borrower',
          header: 'Borrower',
          cell: (l) => (
            <div className="min-w-0">
              <p className="font-medium">{fullName(l.borrower)}</p>
              <p className="font-mono text-xs text-muted-foreground">{formatPhone(l.borrower?.phone) || l.borrower?.email}</p>
            </div>
          ),
        },
        {
          key: 'stage',
          header: 'Stage',
          cell: (l) => (
            <StageMenu
              stage={l.stage}
              onSelect={(stage) => onRequestChange({ id: l.id, stage: l.stage, borrowerName: fullName(l.borrower) }, stage)}
            >
              <button
                type="button"
                className="inline-flex items-center gap-1 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                onClick={(e) => e.stopPropagation()}
                aria-label={`Change stage for ${fullName(l.borrower)}`}
              >
                <StageBadge stage={l.stage} />
                <ChevronDownIcon className="size-3.5 text-muted-foreground" />
              </button>
            </StageMenu>
          ),
        },
        { key: 'purpose', header: 'Purpose', cell: (l) => purposeLabel(l.purpose), hideOnMobile: true },
        ...(showLo
          ? [{ key: 'lo', header: 'Assigned LO', cell: (l: PipelineLoan) => l.assignedLo?.name ?? '—', hideOnMobile: true }]
          : []),
        { key: 'source', header: 'Referral source', cell: (l) => l.referralSource ?? '—', hideOnMobile: true },
        { key: 'days', header: 'In stage', cell: (l) => formatDaysInStage(daysSince(l.stageChangedAt)), align: 'right' },
        { key: 'created', header: 'Created', cell: (l) => dateFormat.format(new Date(l.createdAt)), align: 'right', hideOnMobile: true },
      ]}
    />
  )
}
