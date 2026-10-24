import type * as React from 'react'
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeftIcon, ChevronDownIcon, MailIcon, PencilIcon, PhoneIcon, SearchXIcon, TriangleAlertIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, EmptyState } from '@/components/shared'
import { EditLeadDialog } from '@/components/leads/EditLeadDialog'
import { StageBadge } from '@/components/pipeline/StageBadge'
import { StageMenu } from '@/components/pipeline/StageMenu'
import { useStageChanger } from '@/components/pipeline/useStageChanger'
import { useContactLoans, useLoan, useStageHistory } from '@/lib/api/loans'
import type { PipelineLoan } from '@/lib/api/types'
import { daysSince, formatDaysInStage, formatPhone, fullName } from '@/lib/pipeline/helpers'
import { purposeLabel, stageLabel } from '@/lib/pipeline/stages'

const dateTime = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
const dateOnly = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

function StageHistory({ loanId }: { loanId: string }) {
  const history = useStageHistory(loanId)
  if (history.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (history.isError) return <p className="text-sm text-destructive">{history.error.message}</p>
  return (
    <ol className="relative space-y-4 border-l pl-4">
      {(history.data ?? []).map((entry) => (
        <li key={entry.id} className="relative">
          <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-card bg-primary" />
          <p className="text-sm">
            {entry.fromStage ? (
              <>
                {stageLabel(entry.fromStage)} → <span className="font-medium">{stageLabel(entry.toStage)}</span>
              </>
            ) : (
              <>
                Created in <span className="font-medium">{stageLabel(entry.toStage)}</span>
              </>
            )}
          </p>
          {entry.lostReason && <p className="text-xs text-muted-foreground">Reason: {entry.lostReason}</p>}
          <p className="text-xs text-muted-foreground">
            {dateTime.format(new Date(entry.changedAt))}
            {entry.changedBy && ` · ${entry.changedBy.name}`}
          </p>
        </li>
      ))}
    </ol>
  )
}

function OtherLoans({ loan }: { loan: PipelineLoan }) {
  const loans = useContactLoans(loan.borrower?.id)
  const others = (loans.data ?? []).filter((l) => l.id !== loan.id)
  if (others.length === 0) return <p className="text-sm text-muted-foreground">This is their only loan so far.</p>
  return (
    <ul className="divide-y">
      {others.map((other) => (
        <li key={other.id}>
          <Link to={`/loans/${other.id}`} className="flex items-center justify-between gap-3 py-2 hover:underline">
            <span className="text-sm">
              {purposeLabel(other.purpose)}
              <span className="text-xs text-muted-foreground"> · {dateOnly.format(new Date(other.createdAt))}</span>
              {other.id === loan.priorLoanId && <span className="text-xs text-muted-foreground"> · prior loan</span>}
            </span>
            <StageBadge stage={other.stage} />
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** Phase 1 borrower record. Phase 2 turns this into the full tabbed profile. */
export function LoanPage() {
  const { loanId = '' } = useParams()
  const loan = useLoan(loanId)
  const { requestChange, dialog } = useStageChanger()
  const [editing, setEditing] = useState(false)

  if (loan.isLoading) return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
  if (loan.isError) {
    return (
      <Card>
        <EmptyState icon={TriangleAlertIcon} title="Couldn't load this record" description={loan.error.message} />
      </Card>
    )
  }
  if (!loan.data) {
    return (
      <Card>
        <EmptyState
          icon={SearchXIcon}
          title="Record not found"
          description="It may have been deleted, or it isn't assigned to you."
          action={<Button variant="outline" asChild><Link to="/pipeline">Back to pipeline</Link></Button>}
        />
      </Card>
    )
  }

  const data = loan.data
  const name = fullName(data.borrower)
  const b = data.borrower

  return (
    <>
      <Link to="/pipeline" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" />
        Pipeline
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {purposeLabel(data.purpose)} · {formatDaysInStage(daysSince(data.stageChangedAt))} in {stageLabel(data.stage)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setEditing(true)}>
            <PencilIcon />
            Edit
          </Button>
          <StageMenu stage={data.stage} onSelect={(stage) => requestChange({ id: data.id, stage: data.stage, borrowerName: name }, stage)}>
            <Button>
              {stageLabel(data.stage)}
              <ChevronDownIcon />
            </Button>
          </StageMenu>
        </div>
      </div>

      {data.stage === 'lost' && data.lostReason && (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm">
          <span className="font-medium">Lost:</span> {data.lostReason}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card title="Contact">
            <dl className="grid gap-4 sm:grid-cols-2">
              <Detail label="Phone">
                {b?.phone ? (
                  <a href={`tel:${b.phone}`} className="inline-flex items-center gap-1.5 text-primary hover:underline">
                    <PhoneIcon className="size-3.5" />
                    {formatPhone(b.phone)}
                  </a>
                ) : (
                  '—'
                )}
              </Detail>
              <Detail label="Email">
                {b?.email ? (
                  <a href={`mailto:${b.email}`} className="inline-flex items-center gap-1.5 break-all text-primary hover:underline">
                    <MailIcon className="size-3.5 shrink-0" />
                    {b.email}
                  </a>
                ) : (
                  '—'
                )}
              </Detail>
            </dl>
          </Card>

          <Card title="Loan">
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Detail label="Purpose">{purposeLabel(data.purpose)}</Detail>
              <Detail label="Stage">
                <StageBadge stage={data.stage} />
              </Detail>
              <Detail label="Assigned LO">{data.assignedLo?.name ?? 'Unassigned'}</Detail>
              <Detail label="Referral source">{data.referralSource ?? '—'}</Detail>
              <Detail label="Created">{dateOnly.format(new Date(data.createdAt))}</Detail>
              <Detail label="Co-borrowers">{data.coBorrowerCount || 'None'}</Detail>
            </dl>
          </Card>

          <Card title="Other loans for this person">
            <OtherLoans loan={data} />
          </Card>
        </div>

        <Card title="Stage history">
          <StageHistory loanId={data.id} />
        </Card>
      </div>

      {editing && <EditLeadDialog loan={data} open={editing} onOpenChange={setEditing} />}
      {dialog}
    </>
  )
}
