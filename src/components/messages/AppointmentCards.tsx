import { Link } from 'react-router'
import { CalendarCheckIcon, CalendarPlusIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/shared'
import { useFileAppointments, useMyAppointments, type Appointment } from '@/lib/api/appointments'
import { isToday, splitAppointments, whenLabel } from '@/lib/messaging/appointments'

function Row({ a, showName, muted }: { a: Appointment; showName: 'file' | 'person'; muted?: boolean }) {
  return (
    <li className={cn('flex items-start gap-2 py-2 text-sm first:pt-0', muted && 'text-muted-foreground')}>
      <CalendarCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
      <div className="min-w-0">
        <p className="font-medium tabular-nums">
          {whenLabel(a.startsAt)}
          {a.status === 'cancelled' && <span className="ml-1.5 text-xs font-normal">(cancelled)</span>}
        </p>
        <p className="break-words">
          {showName === 'file' ? (
            <Link to={`/loans/${a.loanId}?tab=messages`} className="hover:underline">
              {a.contactName}
            </Link>
          ) : (
            a.contactName
          )}
          {' · '}
          {a.title}
        </p>
        {a.notes && <p className="text-xs break-words text-muted-foreground">{a.notes}</p>}
      </div>
    </li>
  )
}

/**
 * The file's appointments on the Overview (Connor, 2026-11-18): coming up,
 * then the last few past ones, Central time. Hidden when the file has none,
 * or before the appointments script has run.
 */
export function FileAppointmentsCard({ loanId }: { loanId: string }) {
  const appts = useFileAppointments(loanId)
  const rows = appts.data ?? []
  if (!rows.length) return null
  const { upcoming, past } = splitAppointments(rows)
  return (
    <Card
      title="Appointments"
      description="Booked from MPS HQ on the loan officer's GHL calendar. Times are Central."
      action={
        <Button asChild size="xs" variant="outline">
          <Link to={`/loans/${loanId}?tab=messages`}>
            <CalendarPlusIcon />
            Book another
          </Link>
        </Button>
      }
    >
      {upcoming.length > 0 ? (
        <ul className="divide-y">
          {upcoming.map((a) => (
            <Row key={a.id} a={a} showName="person" />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing coming up.</p>
      )}
      {past.length > 0 && (
        <>
          <p className="mt-3 text-[0.7rem] font-medium tracking-wide text-muted-foreground uppercase">Past</p>
          <ul className="mt-1 divide-y">
            {past.map((a) => (
              <Row key={a.id} a={a} showName="person" muted />
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

/**
 * Today's Appointments box (Connor, 2026-11-18): appointments on your
 * calendar or that you booked, today and the next 7 days. Hidden when there
 * are none.
 */
export function TodayAppointmentsCard() {
  const appts = useMyAppointments(7)
  const rows = appts.data ?? []
  if (!rows.length) return null
  const today = rows.filter((a) => isToday(a.startsAt))
  const later = rows.filter((a) => !isToday(a.startsAt))
  return (
    <Card title="Appointments" description={`${today.length ? `${today.length} today` : 'None today'}${later.length ? ` · ${later.length} in the next 7 days` : ''}. Times are Central.`}>
      <ul className="divide-y">
        {[...today, ...later].map((a) => (
          <Row key={a.id} a={a} showName="file" />
        ))}
      </ul>
    </Card>
  )
}
