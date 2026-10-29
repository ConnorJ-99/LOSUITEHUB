import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ToggleChip, ToggleChipGroup } from '@/components/shared'
import { useCopyToNewLead, type ClosedLoan } from '@/lib/api/closed'
import { useAuth } from '@/lib/auth/context'
import { mortgageToday } from '@/lib/calc'
import { todayIso } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'
import { fullName } from '@/lib/pipeline/helpers'
import { PURPOSES, type LoanPurpose } from '@/lib/pipeline/stages'

/**
 * Copies a closed client into a new lead: the same person (one record), the
 * co-borrowers, and for a refinance or HELOC the home with this loan as its
 * current mortgage. The new file links back to the closed loan.
 */
export function CopyToLeadDialog({ closed: c, organizationId, onClose }: { closed: ClosedLoan; organizationId: string; onClose: () => void }) {
  const navigate = useNavigate()
  const { state } = useAuth()
  const copy = useCopyToNewLead()
  const [purpose, setPurpose] = useState<LoanPurpose>('refinance_rate_term')
  const [withCoBorrowers, setWithCoBorrowers] = useState(true)
  const [withHome, setWithHome] = useState(true)

  const now = mortgageToday({ loanAmount: c.loanAmount, ratePct: c.rate, termMonths: c.termMonths, firstPaymentDate: c.firstPaymentDate, closingDate: c.closingDate }, todayIso(), null)
  const balance = now?.balance ?? null
  const payment = now?.schedule.monthlyPayment ?? null
  const name = c.borrower ? fullName(c.borrower) : 'the client'
  const myId = state.status === 'signedIn' ? state.user.id : null
  const forOther = c.lo && c.lo.id !== myId

  const submit = () =>
    copy.mutate(
      { closed: c, organizationId, purpose, withCoBorrowers, withHome: withHome && !!c.home, currentLien: { balance, monthlyPayment: payment } },
      {
        onSuccess: (id) => {
          toast.success(`New lead for ${name}, linked to this closed loan${forOther ? ` and assigned to ${c.lo!.name}` : ''}`)
          onClose()
          navigate(`/loans/${id}`)
        },
        onError: (e) => toast.error(e.message),
      },
    )

  return (
    <Dialog open onOpenChange={(o) => !o && !copy.isPending && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Copy {name} to a new lead</DialogTitle>
          <DialogDescription>
            Same person, so their contact info, addresses, jobs and income come along. The new file starts as a Lead and links back to this loan.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm font-medium">What's the new loan for?</p>
            <ToggleChipGroup>
              {PURPOSES.map((p) => (
                <ToggleChip key={p.value} label={p.label} pressed={purpose === p.value} onChange={() => setPurpose(p.value)} />
              ))}
            </ToggleChipGroup>
          </div>
          <ToggleChipGroup>
            {c.coBorrowers.length > 0 && <ToggleChip label={`Bring ${c.coBorrowers.map((p) => p.firstName).join(', ')}`} pressed={withCoBorrowers} onChange={setWithCoBorrowers} />}
            {c.home && <ToggleChip label="Copy the home and this mortgage" pressed={withHome} onChange={setWithHome} />}
          </ToggleChipGroup>
          {c.home && withHome && (
            <p className="text-xs text-muted-foreground">
              {c.home.addressLine} is added {purpose === 'purchase' ? 'as their current home' : 'as the subject property'}, with this loan as its first mortgage
              {balance !== null ? ` (estimated balance ${formatCurrency(balance)}, P&I ${formatCurrency(payment)}/mo)` : ''}. Check the balance against a statement.
            </p>
          )}
          {forOther && <p className="text-xs text-muted-foreground">The new lead goes to {c.lo!.name}, this file's loan officer.</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={copy.isPending} onClick={onClose}>Cancel</Button>
          <Button disabled={copy.isPending} onClick={submit}>{copy.isPending ? 'Copying…' : 'Create lead'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
