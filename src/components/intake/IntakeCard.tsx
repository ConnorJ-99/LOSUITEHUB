import { Link } from 'react-router'
import { ClipboardListIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/shared'
import { useIntake } from '@/lib/api/intake'
import { summarizeIntake } from '@/lib/intake/review'
import { doneSections, SECTIONS } from '@/lib/intake/sections'

const STATUS: Record<string, string> = { draft: 'In progress', submitted: 'Waiting for review', returned: 'Sent back', accepted: 'Accepted' }

/**
 * The intake interview as one of the borrower's answer sources on the Overview, next to the
 * online application and web forms (LO Assistant step 5, Connor 2026-11-17). Hidden when the file
 * has none, or before the intake script has run.
 */
export function IntakeCard({ loanId }: { loanId: string }) {
  const intake = useIntake(loanId)
  const it = intake.data && intake.data !== 'not_installed' ? intake.data : null
  if (!it) return null
  const facts = summarizeIntake(it.answers)
  const headline = (it.summary as { headline?: string } | null)?.headline || facts.headline
  return (
    <Card
      title="Intake interview"
      description={`${STATUS[it.status] ?? it.status} · ${it.interviewerName ?? 'Unknown'} · ${doneSections(it.answers).length} of ${SECTIONS.length} sections`}
      action={
        <Button asChild size="xs" variant="outline">
          <Link to={`/loans/${loanId}/intake`}>
            <ClipboardListIcon />
            Open
          </Link>
        </Button>
      }
    >
      {headline && <p className="text-sm font-medium">{headline}</p>}
      <p className="mt-1 text-sm text-muted-foreground">
        {facts.flags.length} flag(s) · {facts.missing_docs.length} missing doc(s){facts.urgency.level === 'time_sensitive' ? ' · time-sensitive' : ''}
      </p>
    </Card>
  )
}
