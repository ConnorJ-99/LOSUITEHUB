import type * as React from 'react'
import { Link } from 'react-router'
import { MailIcon, MessageSquareIcon, MoreHorizontalIcon, PhoneIcon, StarIcon, UsersIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { useUpdateCard, type CardChanges } from '@/lib/api/loans'
import type { PipelineLoan } from '@/lib/api/types'
import { formatCurrency } from '@/lib/format'
import { daysSince, fullName } from '@/lib/pipeline/helpers'
import { cardAmount, stageLabelFor } from '@/lib/pipeline/pipelines'
import { purposeLabel, stageLabel, type PipelineStage } from '@/lib/pipeline/stages'
import { statusDetailOptions } from '@/lib/pipeline/statusDetail'
import { TIMELINE_OPTIONS, timelineChoice } from '@/lib/pipeline/timeline'
import { StageMenu } from './StageMenu'

export interface LoanCardProps extends React.ComponentProps<'div'> {
  loan: PipelineLoan
  showLo?: boolean
  dragging?: boolean
  onStageSelect?: (stage: PipelineStage) => void
  onOpen?: () => void
}

/** Stage dot colors, by how far along the file is. */
const DOT: Partial<Record<PipelineStage, string>> = {
  lead: 'bg-slate-400',
  contacted: 'bg-teal-500',
  pre_qualified: 'bg-violet-500',
  pre_approved: 'bg-indigo-500',
  home_search: 'bg-emerald-500',
  under_contract: 'bg-amber-500',
  processing: 'bg-sky-500',
  clear_to_close: 'bg-blue-600',
  closed: 'bg-green-700',
  nurture: 'bg-orange-400',
  lost: 'bg-rose-500',
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('') || '?'

/** Keeps clicks and drags on a control from opening the file or picking up the card. */
const stop = { onClick: (e: React.SyntheticEvent) => e.stopPropagation(), onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(), onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation() }

/** Pipeline card (Connor's old app): star, who, loan type and amount, stage, status detail, timeline and quick contact buttons. */
export function LoanCard({ loan, showLo, dragging, onStageSelect, onOpen, className, ...props }: LoanCardProps) {
  const update = useUpdateCard()
  const days = daysSince(loan.stageChangedAt)
  const name = fullName(loan.borrower)
  const amount = cardAmount(loan)
  const phone = loan.borrower?.phone ?? null
  const email = loan.borrower?.email ?? null
  const save = (changes: CardChanges, what: string) => update.mutate({ loanId: loan.id, changes }, { onError: (e) => toast.error(`Couldn't save the ${what}: ${e.message}`) })
  const timeline = timelineChoice(loan.timeline)
  const details = statusDetailOptions(loan.stage, loan.purpose, loan.statusDetail)
  const select = 'h-7 w-full truncate rounded-full border px-2.5 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring'

  return (
    <div
      onClick={onOpen}
      className={cn('group cursor-pointer rounded-xl border bg-card p-3 text-sm shadow-xs transition-shadow select-none hover:shadow-sm', dragging && 'rotate-1 shadow-lg ring-2 ring-primary/30', className)}
      {...props}
    >
      <div className="flex items-start gap-2.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">{initials(name)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={loan.priority ? `Remove ${name} from Priority Leads` : `Add ${name} to Priority Leads`}
              aria-pressed={loan.priority}
              title={loan.priority ? 'Priority (click to remove)' : 'Mark as priority'}
              className={cn('-ml-0.5 shrink-0 rounded p-0.5', loan.priority ? 'text-amber-500' : 'text-muted-foreground/40 hover:text-amber-500')}
              {...stop}
              onClick={(e) => {
                e.stopPropagation()
                save({ priority: !loan.priority }, 'star')
              }}
            >
              <StarIcon className={cn('size-3.5', loan.priority && 'fill-current')} />
            </button>
            <Link to={`/loans/${loan.id}`} {...stop} className="min-w-0 truncate font-semibold hover:underline">
              {name}
            </Link>
            <span className="ml-auto shrink-0 text-[11px] text-muted-foreground" title="Days in this stage">
              {days === 0 ? 'today' : `${days}d`}
            </span>
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {purposeLabel(loan.purpose)}
            {amount != null && ` · ${formatCurrency(amount)}`}
            {loan.coBorrowerCount > 0 && (
              <span className="ml-1.5 inline-flex items-center gap-0.5">
                <UsersIcon className="size-3" />+{loan.coBorrowerCount}
              </span>
            )}
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs">
            <span className={cn('size-1.5 rounded-full', DOT[loan.stage] ?? 'bg-slate-400')} />
            {stageLabelFor(loan.stage, loan.purpose, stageLabel(loan.stage))}
          </p>
        </div>
      </div>

      {loan.stage !== 'lost' && (
        <div className="mt-2.5 space-y-1.5">
          {details.length > 0 && (
            <select
              aria-label={`Status detail for ${name}`}
              value={loan.statusDetail ?? ''}
              onChange={(e) => save({ statusDetail: e.target.value || null }, 'status detail')}
              className={cn(select, loan.statusDetail ? 'border-primary/30 bg-accent text-accent-foreground' : 'bg-card text-muted-foreground')}
              {...stop}
            >
              <option value="">Status detail?</option>
              {details.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label={`Timeline for ${name}`}
            value={timeline === 'other' ? loan.timeline! : (timeline ?? '')}
            onChange={(e) => save({ timeline: e.target.value || null }, 'timeline')}
            className={cn(select, timeline ? 'border-indigo-200 bg-indigo-50 text-indigo-900' : 'bg-card text-muted-foreground')}
            {...stop}
          >
            <option value="">Timeline?</option>
            {TIMELINE_OPTIONS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
            {timeline === 'other' && <option value={loan.timeline!}>Other: {loan.timeline}</option>}
          </select>
        </div>
      )}

      <div className="mt-2 flex items-center gap-0.5 text-muted-foreground">
        <QuickLink href={phone ? `tel:${phone}` : null} label={phone ? `Call ${phone}` : 'No phone on file'} icon={PhoneIcon} />
        <QuickLink href={phone ? `sms:${phone}` : null} label={phone ? `Text ${phone}` : 'No phone on file'} icon={MessageSquareIcon} />
        <QuickLink href={email ? `mailto:${email}` : null} label={email ? `Email ${email}` : 'No email on file'} icon={MailIcon} />
        {showLo && loan.assignedLo && <span className="ml-1 truncate text-[11px]">{loan.assignedLo.name}</span>}
        {onStageSelect && (
          <StageMenu stage={loan.stage} onSelect={onStageSelect}>
            <Button variant="ghost" size="icon-xs" className="ml-auto" aria-label={`Change stage for ${name}`} {...stop}>
              <MoreHorizontalIcon />
            </Button>
          </StageMenu>
        )}
      </div>

      {loan.stage === 'lost' && loan.lostReason && <p className="mt-2 line-clamp-2 border-t pt-2 text-xs text-muted-foreground">{loan.lostReason}</p>}
    </div>
  )
}

function QuickLink({ href, label, icon: Icon }: { href: string | null; label: string; icon: typeof PhoneIcon }) {
  if (!href)
    return (
      <span title={label} className="rounded p-1.5 opacity-30">
        <Icon className="size-3.5" />
      </span>
    )
  return (
    <a href={href} title={label} aria-label={label} className="rounded p-1.5 hover:bg-muted hover:text-foreground" {...stop}>
      <Icon className="size-3.5" />
    </a>
  )
}
