import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowLeftIcon, CalendarDaysIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, TriangleAlertIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, PageHeader } from '@/components/shared'
import type { PipelineLoan } from '@/lib/api/types'
import { useOrgMembers, usePipeline } from '@/lib/api/loans'
import { formatIsoDate, todayIso } from '@/lib/dates'
import { formatCompactCurrency } from '@/lib/format'
import { calendarClosings, closingStatus, missingClosingDate, monthLabel, monthWeeks, shiftMonth, type ClosingStatus } from '@/lib/pipeline/closings'
import { fullName } from '@/lib/pipeline/helpers'
import { cardAmount, stageLabelFor } from '@/lib/pipeline/pipelines'
import { purposeLabel, stageLabel } from '@/lib/pipeline/stages'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

type Closing = PipelineLoan & { closingDate: string }

/** How an entry reads on the calendar and in the list. */
const STATUS_STYLE: Record<ClosingStatus, string> = {
  upcoming: 'bg-primary/10 text-primary',
  closed: 'bg-muted text-muted-foreground',
  date_passed: 'bg-urgent/10 text-urgent',
}

/** Closing calendar (/pipeline/closings): every file's closing date by month, from the contract (purchases) or the Overview tab (refis). */
export function ClosingCalendarPage() {
  const pipeline = usePipeline()
  const members = useOrgMembers()
  const today = todayIso()
  const [month, setMonth] = useState(today.slice(0, 7))

  const showLo = (members.data?.length ?? 0) > 1
  const files = pipeline.data ?? []
  const closings = calendarClosings(files)
  const thisMonth = closings.filter((c) => c.closingDate.startsWith(month))
  const byDay = new Map<string, Closing[]>()
  for (const c of thisMonth) byDay.set(c.closingDate, [...(byDay.get(c.closingDate) ?? []), c])
  const noDate = missingClosingDate(files)
  const total = thisMonth.reduce((sum, c) => sum + (cardAmount(c) ?? 0), 0)

  return (
    <>
      <Link to="/pipeline" className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" />
        Leads
      </Link>
      <PageHeader
        title="Closing calendar"
        description="Closing dates from the Contract tab on purchases and the Overview tab on refis."
        action={
          <div className="flex items-center gap-1">
            <Button variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => setMonth(shiftMonth(month, -1))}>
              <ChevronLeftIcon />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setMonth(today.slice(0, 7))}>
              Today
            </Button>
            <Button variant="outline" size="icon-sm" aria-label="Next month" onClick={() => setMonth(shiftMonth(month, 1))}>
              <ChevronRightIcon />
            </Button>
          </div>
        }
      />

      {pipeline.isLoading && <p className="py-12 text-center text-sm text-muted-foreground">Loading closings…</p>}
      {pipeline.isError && (
        <Card>
          <EmptyState icon={TriangleAlertIcon} title="Couldn't load closings" description={pipeline.error.message} action={<Button variant="outline" onClick={() => pipeline.refetch()}>Try again</Button>} />
        </Card>
      )}

      {pipeline.isSuccess && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-heading text-xl">{monthLabel(month)}</h2>
            <span className="text-sm text-muted-foreground tabular-nums">
              {thisMonth.length} {thisMonth.length === 1 ? 'closing' : 'closings'}
            </span>
            <span className="text-sm font-medium text-money tabular-nums">{formatCompactCurrency(total)}</span>
          </div>

          {/* The month grid is for wider screens; a phone gets the list below. */}
          <Card className="hidden md:flex" contentClassName="px-0">
            <div className="grid grid-cols-7 border-b text-xs font-medium text-muted-foreground">
              {WEEKDAYS.map((d) => (
                <div key={d} className="px-2 pb-2">{d}</div>
              ))}
            </div>
            {monthWeeks(month).map((week) => (
              <div key={week[0]} className="grid grid-cols-7 border-b last:border-b-0">
                {week.map((day) => (
                  <div key={day} className={cn('min-h-24 space-y-1 border-r p-1.5 last:border-r-0', !day.startsWith(month) && 'bg-muted/40')}>
                    <span className={cn('inline-flex size-6 items-center justify-center rounded-full text-xs tabular-nums', day === today ? 'bg-primary font-semibold text-primary-foreground' : day.startsWith(month) ? 'text-foreground' : 'text-muted-foreground')}>
                      {Number(day.slice(8))}
                    </span>
                    {day.startsWith(month) &&
                      (byDay.get(day) ?? []).map((c) => (
                        <Link key={c.id} to={`/loans/${c.id}`} title={`${fullName(c.borrower)} · ${purposeLabel(c.purpose)}`} className={cn('block truncate rounded px-1.5 py-0.5 text-xs font-medium hover:underline', STATUS_STYLE[closingStatus(c, today)])}>
                          {fullName(c.borrower)}
                        </Link>
                      ))}
                  </div>
                ))}
              </div>
            ))}
          </Card>

          {thisMonth.length === 0 ? (
            <Card>
              <EmptyState icon={CalendarDaysIcon} title={`No closings in ${monthLabel(month)}`} description="Add a closing date on a file's Contract tab (purchase) or Overview tab (refi) and it shows here." />
            </Card>
          ) : (
            <ul className="space-y-2">
              {thisMonth.map((c) => (
                <ClosingRow key={c.id} closing={c} status={closingStatus(c, today)} showLo={showLo} />
              ))}
            </ul>
          )}

          {noDate.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-sm font-medium">
                No closing date yet <span className="text-muted-foreground tabular-nums">{noDate.length}</span>
              </h2>
              <ul className="space-y-2">
                {noDate.map((l) => (
                  <li key={l.id}>
                    <Link to={`/loans/${l.id}?tab=${l.purpose === 'purchase' ? 'contract' : 'overview'}`} className="flex items-center gap-3 rounded-xl border border-dashed bg-card px-4 py-2.5 text-sm hover:shadow-soft">
                      <span className="min-w-0 flex-1 truncate font-medium">{fullName(l.borrower)}</span>
                      <span className="shrink-0 text-muted-foreground">{stageLabelFor(l.stage, l.purpose, stageLabel(l.stage))}</span>
                      <span className="shrink-0 text-xs text-primary">Add date</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </>
  )
}

function ClosingRow({ closing: c, status, showLo }: { closing: Closing; status: ClosingStatus; showLo: boolean }) {
  return (
    <li>
      <Link to={`/loans/${c.id}`} className="flex items-center gap-3 rounded-xl bg-card px-4 py-3 shadow-soft transition-shadow hover:shadow-md">
        <span className={cn('w-16 shrink-0 rounded-md px-2 py-1 text-center text-xs font-semibold tabular-nums', STATUS_STYLE[status])}>{formatIsoDate(c.closingDate).replace(/, \d{4}$/, '')}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{fullName(c.borrower)}</span>
          <span className="block text-xs text-muted-foreground">
            {status === 'closed' && <CheckIcon className="mr-1 inline size-3.5 align-[-2px]" />}
            {purposeLabel(c.purpose)} · {stageLabelFor(c.stage, c.purpose, stageLabel(c.stage))}
            {showLo && c.assignedLo && ` · ${c.assignedLo.name}`}
          </span>
          {status === 'date_passed' && <span className="block text-xs font-medium text-urgent">Date passed without closing; update the date</span>}
        </span>
        {cardAmount(c) !== null && <span className="shrink-0 text-sm font-medium text-money tabular-nums">{formatCompactCurrency(cardAmount(c))}</span>}
      </Link>
    </li>
  )
}
