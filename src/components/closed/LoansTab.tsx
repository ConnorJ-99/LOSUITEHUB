import { useState } from 'react'
import { Link } from 'react-router'
import { CopyPlusIcon, Link2Icon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, EmptyState } from '@/components/shared'
import { StageBadge } from '@/components/pipeline/StageBadge'
import { useClosedLoan } from '@/lib/api/closed'
import { useContactLoans } from '@/lib/api/loans'
import type { LoanProfile, PipelineLoan } from '@/lib/api/types'
import { formatIsoDate } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'
import { purposeLabel } from '@/lib/pipeline/stages'
import { CopyToLeadDialog } from './CopyToLeadDialog'

/**
 * Every loan this person is on (closed, open or lost), newest first. Each row
 * opens that file, and "Copy to a new lead" starts their next loan from it.
 * One person, one record: these are all the same contact's files.
 */
export function LoansTab({ loan }: { loan: LoanProfile }) {
  const loans = useContactLoans(loan.borrower?.id)
  const [copying, setCopying] = useState<string | null>(null)
  const name = loan.borrower ? `${loan.borrower.firstName} ${loan.borrower.lastName}`.trim() : 'This person'

  return (
    <Card title="Loans" description={`Every loan ${name} is on. Click one to open it.`}>
      {loans.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : loans.error ? (
        <p className="text-sm text-destructive">{loans.error.message}</p>
      ) : !loans.data?.length ? (
        <EmptyState title="No loans" description="This person isn't on any loan yet." />
      ) : (
        <ul className="divide-y">
          {loans.data.map((l) => (
            <LoanRow key={l.id} l={l} current={l.id === loan.id} priorOfCurrent={l.id === loan.priorLoanId} onCopy={() => setCopying(l.id)} />
          ))}
        </ul>
      )}
      {copying && <CopyFromLoan loanId={copying} organizationId={loan.organizationId} onClose={() => setCopying(null)} />}
    </Card>
  )
}

function LoanRow({ l, current, priorOfCurrent, onCopy }: { l: PipelineLoan; current: boolean; priorOfCurrent: boolean; onCopy: () => void }) {
  const date = l.stage === 'closed' && l.closingDate ? `Closed ${formatIsoDate(l.closingDate)}` : `Started ${formatIsoDate(l.createdAt.slice(0, 10))}`
  return (
    <li className="flex flex-wrap items-center gap-3 py-3">
      <Link to={`/loans/${l.id}`} className="min-w-0 flex-1 rounded-md hover:underline">
        <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
          {purposeLabel(l.purpose)}
          {l.loanAmount != null && <span className="font-normal tabular-nums text-muted-foreground">{formatCurrency(l.loanAmount)}</span>}
          {current && <span className="rounded-full bg-accent px-2 py-0.5 text-[11px] font-medium text-accent-foreground">This file</span>}
          {priorOfCurrent && (
            <span className="inline-flex items-center gap-1 text-[11px] font-normal text-muted-foreground">
              <Link2Icon className="size-3" />
              this file came from it
            </span>
          )}
        </p>
        <p className="text-xs text-muted-foreground">
          {date}
          {l.assignedLo && ` · ${l.assignedLo.name}`}
          {l.stage === 'lost' && l.lostReason && ` · ${l.lostReason}`}
        </p>
      </Link>
      <StageBadge stage={l.stage} />
      <Button size="sm" variant="outline" onClick={onCopy}>
        <CopyPlusIcon />
        Copy to a new lead
      </Button>
    </li>
  )
}

/** Loads the loan's facts, then opens the same "Copy to a new lead" dialog the closed loan card uses. */
function CopyFromLoan({ loanId, organizationId, onClose }: { loanId: string; organizationId: string; onClose: () => void }) {
  const loan = useClosedLoan(loanId)
  if (!loan.data) return null
  return <CopyToLeadDialog closed={loan.data} organizationId={organizationId} onClose={onClose} />
}
