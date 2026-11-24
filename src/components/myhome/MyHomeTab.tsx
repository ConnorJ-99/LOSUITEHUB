// A file's MyHome tab (Connor, 2026-11-24: "a tab on the side specifically for
// MyHome so we have more access to it, take it off the overview"). Everything
// about the primary borrower's MyHome in one place, on open, nurture and
// closed files: the account (status, Send code to GHL, Copy link, Draft
// text/email, New code, Turn off), what they asked for from MyHome (with Save
// value & mark done), and the extra payments they reported. The nurture goals,
// assets and budget (docs/plans/nurture-goals.md) are added here phase by phase.
// "See what they see" (Connor, 2026-11-24) opens this file as the primary
// borrower sees it in MyHome, read only, so it can be checked without their code.
import { lazy, Suspense, useState } from 'react'
import { EyeIcon } from 'lucide-react'
import { Card, EmptyState } from '@/components/shared'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { MyHomeCard } from '@/components/portal/PortalCard'
import { useMyHomeExtraPayments } from '@/lib/api/myhome'
import { useProperties } from '@/lib/api/properties'
import type { LoanProfile } from '@/lib/api/types'
import { formatIsoDate, relativeTime } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'
import { GoalsCard } from './GoalsCard'

// The borrower's MyHome screens load only when the preview is opened.
const MyHomePreview = lazy(() => import('@/pages/MyHomePage').then((m) => ({ default: m.MyHomePreview })))

export function MyHomeTab({ loan }: { loan: LoanProfile }) {
  const properties = useProperties(loan.id)
  const paid = useMyHomeExtraPayments(loan.id)
  const subject = (properties.data ?? []).find((p) => p.id === loan.details.subjectPropertyId) ?? null
  const person = loan.borrower
  const [previewing, setPreviewing] = useState(false)

  if (!person)
    return (
      <Card>
        <EmptyState title="No borrower yet" description="Add the primary borrower to give them MyHome." />
      </Card>
    )

  return (
    <div className="space-y-4">
      <Card
        title={`What ${person.firstName} sees`}
        action={
          <Button size="sm" variant="outline" onClick={() => setPreviewing(true)}>
            <EyeIcon /> See their MyHome
          </Button>
        }
      >
        <p className="text-sm text-muted-foreground">This file as it looks in their MyHome, read only. Buttons there don't change anything, and they aren't told you looked.</p>
      </Card>
      <Dialog open={previewing} onOpenChange={setPreviewing}>
        <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-2xl">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle>{person.firstName}'s MyHome · preview</DialogTitle>
            <DialogDescription>What they see on this file. Read only: nothing you click here is saved or sent.</DialogDescription>
          </DialogHeader>
          {previewing && (
            <Suspense fallback={<p className="py-16 text-center text-sm text-muted-foreground">Loading…</p>}>
              <MyHomePreview loanId={loan.id} />
            </Suspense>
          )}
        </DialogContent>
      </Dialog>
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
