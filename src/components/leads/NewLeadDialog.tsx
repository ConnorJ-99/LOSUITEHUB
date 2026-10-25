import type * as React from 'react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router'
import { UserCheckIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormGrid, Input, Select, ToggleChip } from '@/components/shared'
import { StageBadge } from '@/components/pipeline/StageBadge'
import { useMatchingContacts } from '@/lib/api/contacts'
import { useCreateLead, useOrgMembers } from '@/lib/api/loans'
import type { ContactSummary } from '@/lib/api/types'
import { useAuth } from '@/lib/auth/context'
import { formatPhone, fullName } from '@/lib/pipeline/helpers'
import { PURPOSES, purposeLabel, type LoanPurpose } from '@/lib/pipeline/stages'

interface FormState {
  firstName: string
  lastName: string
  phone: string
  email: string
  purpose: LoanPurpose
  referralSource: string
  assignedLoId: string | null
}

const blankForm = (myId: string | null): FormState => ({
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  purpose: 'purchase',
  referralSource: '',
  assignedLoId: myId,
})

/** Waits until typing pauses before looking up duplicates. */
function useDebounced<T>(value: T, ms = 400): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

export function NewLeadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { state } = useAuth()
  const myId = state.status === 'signedIn' ? state.user.id : null
  const navigate = useNavigate()
  const createLead = useCreateLead()
  const members = useOrgMembers()

  const [form, setForm] = useState<FormState>(() => blankForm(myId))
  const [existing, setExisting] = useState<ContactSummary | null>(null)
  const [dismissedIds, setDismissedIds] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)
  // On a call: open the Prequal tab right after saving. Stays on for the next lead.
  const [startPrequal, setStartPrequal] = useState(false)

  const set = <K extends keyof FormState>(key: K) => (value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))

  const email = useDebounced(form.email)
  const phone = useDebounced(form.phone)
  const matches = useMatchingContacts(existing ? '' : email, existing ? '' : phone)
  const suggestions = (matches.data ?? []).filter((m) => !dismissedIds.includes(m.id))

  const reset = () => {
    setForm(blankForm(myId))
    setExisting(null)
    setDismissedIds([])
    setSubmitted(false)
  }

  const close = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const errors = {
    firstName: !existing && !form.firstName.trim() ? 'First name is required' : undefined,
    lastName: !existing && !form.lastName.trim() ? 'Last name is required' : undefined,
    contact: !existing && !form.phone.trim() && !form.email.trim() ? 'Add a phone number or email' : undefined,
  }
  const hasErrors = Object.values(errors).some(Boolean)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (hasErrors) return
    createLead.mutate(
      {
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone,
        purpose: form.purpose,
        referralSource: form.referralSource,
        assignedLoId: form.assignedLoId,
        existingContactId: existing?.id ?? null,
        priorLoanId: existing?.loans[0]?.id ?? null,
      },
      {
        onSuccess: (loanId) => {
          const name = existing ? fullName(existing) : `${form.firstName} ${form.lastName}`.trim()
          close(false)
          if (startPrequal) {
            navigate(`/loans/${loanId}?tab=prequal`)
            toast.success(`${name} added to Lead`)
            return
          }
          toast.success(`${name} added to Lead`, {
            action: { label: 'Open', onClick: () => navigate(`/loans/${loanId}`) },
          })
        },
        onError: (error) => toast.error(`Could not save lead: ${error.message}`),
      },
    )
  }

  const memberOptions = (members.data ?? []).map((m) => ({ value: m.id, label: m.name }))

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New Lead</DialogTitle>
          <DialogDescription>Starts in the Lead stage. You can fill in the rest later.</DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4" noValidate>
          {existing ? (
            <div className="flex items-start justify-between gap-3 rounded-lg border border-primary/30 bg-accent p-3">
              <div className="flex gap-3">
                <UserCheckIcon className="mt-0.5 size-4 shrink-0 text-accent-foreground" />
                <div className="text-sm">
                  <p className="font-medium">New loan for {fullName(existing)}</p>
                  <p className="text-xs text-muted-foreground">
                    {[formatPhone(existing.phone), existing.email].filter(Boolean).join(' · ')}
                  </p>
                  {existing.loans[0] && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Linked to their previous {purposeLabel(existing.loans[0].purpose).toLowerCase()} loan
                    </p>
                  )}
                </div>
              </div>
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => setExisting(null)} aria-label="Use a new person instead">
                <XIcon />
              </Button>
            </div>
          ) : (
            <FormGrid className="lg:grid-cols-4">
              <Input label="First name" value={form.firstName} onChange={set('firstName')} required span={2} autoFocus error={submitted ? errors.firstName : undefined} />
              <Input label="Last name" value={form.lastName} onChange={set('lastName')} required span={2} error={submitted ? errors.lastName : undefined} />
              <Input label="Phone" type="tel" autoComplete="off" value={form.phone} onChange={set('phone')} span={2} error={submitted ? errors.contact : undefined} />
              <Input label="Email" type="email" autoComplete="off" value={form.email} onChange={set('email')} span={2} />
            </FormGrid>
          )}

          {!existing && suggestions.length > 0 && (
            <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
              <p className="text-xs font-medium text-amber-900">Already in LOSuite: add a new loan to this person instead of a duplicate?</p>
              {suggestions.map((match) => (
                <div key={match.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-card p-2">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium">{fullName(match)}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[formatPhone(match.phone), match.email].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {match.loans[0] && <StageBadge stage={match.loans[0].stage} />}
                    <Button type="button" size="sm" onClick={() => setExisting(match)}>
                      Use this person
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setDismissedIds((ids) => [...ids, match.id])}>
                      Not them
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <FormGrid className="lg:grid-cols-4">
            <Select label="Loan purpose" value={form.purpose} onChange={set('purpose')} options={PURPOSES} required span={2} />
            <Select
              label="Assigned LO"
              value={form.assignedLoId}
              onChange={set('assignedLoId')}
              options={memberOptions}
              placeholder={members.isLoading ? 'Loading…' : 'Select…'}
              span={2}
            />
            <Input
              label="Referral source"
              value={form.referralSource}
              onChange={set('referralSource')}
              placeholder="e.g. Realtor Amy Lee, Zillow, past client"
              span={4}
            />
          </FormGrid>

          <ToggleChip label="Start prequal call after saving" pressed={startPrequal} onChange={setStartPrequal} />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createLead.isPending}>
              {createLead.isPending ? 'Saving…' : 'Add lead'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
