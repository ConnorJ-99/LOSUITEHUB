// A file's MyHome tab (Connor, 2026-11-24: "a tab on the side specifically for
// MyHome so we have more access to it, take it off the overview"). Everything
// about the primary borrower's MyHome in one place, on open, nurture and
// closed files: the account (status, Send code to GHL, Copy link, Draft
// text/email, New code, Turn off), what they asked for from MyHome (with Save
// value & mark done), and the extra payments they reported. The nurture goals,
// assets and budget (docs/plans/nurture-goals.md) are added here phase by phase.
import { Card, EmptyState } from '@/components/shared'
import { MyHomeCard } from '@/components/portal/PortalCard'
import { useMyHomeExtraPayments } from '@/lib/api/myhome'
import { useProperties } from '@/lib/api/properties'
import type { LoanProfile } from '@/lib/api/types'
import { formatIsoDate, relativeTime } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'
import { GoalsCard } from './GoalsCard'

export function MyHomeTab({ loan }: { loan: LoanProfile }) {
  const properties = useProperties(loan.id)
  const paid = useMyHomeExtraPayments(loan.id)
  const subject = (properties.data ?? []).find((p) => p.id === loan.details.subjectPropertyId) ?? null
  const person = loan.borrower

  if (!person)
    return (
      <Card>
        <EmptyState title="No borrower yet" description="Add the primary borrower to give them MyHome." />
      </Card>
    )

  return (
    <div className="space-y-4">
      <MyHomeCard
        loan={loan}
        person={{ id: person.id, firstName: person.firstName, lastName: person.lastName, phone: person.phone, email: person.email }}
        home={subject ? { id: subject.id, estimatedValue: subject.estimatedValue, estimatedValueOn: null } : null}
      />
      <GoalsCard loan={loan} />
      {(paid.data?.length ?? 0) > 0 && (
        <Card title="Extra payments they reported" description="Logged in MyHome. The balance on the Overview's Mortgage today card counts them.">
          <ul className="divide-y text-sm">
            {paid.data!.map((p) => (
              <li key={p.id} className="flex justify-between gap-3 py-1.5">
                <span>{formatIsoDate(p.paidOn)}</span>
                <span className="font-semibold tabular-nums">{formatCurrency(p.amount)}</span>
                <span className="text-xs text-muted-foreground">logged {relativeTime(p.loggedAt)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
