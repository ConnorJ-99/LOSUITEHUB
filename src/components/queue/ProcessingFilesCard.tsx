import { Link } from 'react-router'
import { Card } from '@/components/shared'
import { useProcessingFiles } from '@/lib/api/fileRole'
import { purposeLabel, stageLabel, type LoanPurpose, type PipelineStage } from '@/lib/pipeline/stages'

/** Today: the files you're processing for another loan officer (Connor, 2026-11-16). Hidden when there are none. */
export function ProcessingFilesCard() {
  const files = useProcessingFiles()
  const list = (files.data ?? []).filter((f) => f.stage !== 'closed' && f.stage !== 'lost')
  if (!list.length) return null
  return (
    <Card className="border-t-2 border-t-primary" title={`Files I'm processing (${list.length})`}>
      <ul className="divide-y">
        {list.map((f) => (
          <li key={f.loanId}>
            <Link to={`/loans/${f.loanId}`} className="flex flex-wrap items-baseline justify-between gap-x-2 py-2 hover:bg-muted/40">
              <span className="text-sm font-medium">{f.borrowerName}</span>
              <span className="text-xs text-muted-foreground">
                {purposeLabel(f.purpose as LoanPurpose)} · {stageLabel(f.stage as PipelineStage)} · for {f.loName ?? 'no loan officer'}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  )
}
