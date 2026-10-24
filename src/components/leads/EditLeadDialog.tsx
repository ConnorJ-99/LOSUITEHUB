import type * as React from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormGrid, Input, Select } from '@/components/shared'
import { useOrgMembers, useUpdateLead } from '@/lib/api/loans'
import type { PipelineLoan } from '@/lib/api/types'
import { PURPOSES, type LoanPurpose } from '@/lib/pipeline/stages'

/** Edit the person's contact details and the loan's basics from the record page. */
export function EditLeadDialog({
  loan,
  open,
  onOpenChange,
}: {
  loan: PipelineLoan
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const members = useOrgMembers()
  const updateLead = useUpdateLead()
  const [form, setForm] = useState(() => ({
    firstName: loan.borrower?.firstName ?? '',
    lastName: loan.borrower?.lastName ?? '',
    phone: loan.borrower?.phone ?? '',
    email: loan.borrower?.email ?? '',
    purpose: loan.purpose as LoanPurpose,
    referralSource: loan.referralSource ?? '',
    assignedLoId: loan.assignedLo?.id ?? null,
  }))
  const [submitted, setSubmitted] = useState(false)
  const set = <K extends keyof typeof form>(key: K) => (value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }))

  const errors = {
    firstName: !form.firstName.trim() ? 'First name is required' : undefined,
    lastName: !form.lastName.trim() ? 'Last name is required' : undefined,
    contact: !form.phone.trim() && !form.email.trim() ? 'Add a phone number or email' : undefined,
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitted(true)
    if (Object.values(errors).some(Boolean) || !loan.borrower) return
    updateLead.mutate(
      {
        loanId: loan.id,
        contactId: loan.borrower.id,
        contact: { firstName: form.firstName, lastName: form.lastName, phone: form.phone, email: form.email },
        loan: { purpose: form.purpose, referralSource: form.referralSource, assignedLoId: form.assignedLoId },
      },
      {
        onSuccess: () => {
          toast.success('Saved')
          onOpenChange(false)
        },
        onError: (error) => toast.error(`Could not save: ${error.message}`),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit</DialogTitle>
          <DialogDescription>Contact details are shared by every loan this person has.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormGrid className="lg:grid-cols-4">
            <Input label="First name" value={form.firstName} onChange={set('firstName')} required span={2} error={submitted ? errors.firstName : undefined} />
            <Input label="Last name" value={form.lastName} onChange={set('lastName')} required span={2} error={submitted ? errors.lastName : undefined} />
            <Input label="Phone" type="tel" value={form.phone} onChange={set('phone')} span={2} error={submitted ? errors.contact : undefined} />
            <Input label="Email" type="email" value={form.email} onChange={set('email')} span={2} />
            <Select label="Loan purpose" value={form.purpose} onChange={set('purpose')} options={PURPOSES} required span={2} />
            <Select
              label="Assigned LO"
              value={form.assignedLoId}
              onChange={set('assignedLoId')}
              options={(members.data ?? []).map((m) => ({ value: m.id, label: m.name }))}
              span={2}
            />
            <Input label="Referral source" value={form.referralSource} onChange={set('referralSource')} span={4} />
          </FormGrid>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={updateLead.isPending}>
              {updateLead.isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
