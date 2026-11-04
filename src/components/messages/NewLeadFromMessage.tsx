import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormGrid, Input, Select } from '@/components/shared'
import { db, unwrap } from '@/lib/api/client'
import { useCreateLead, useOrgMembers } from '@/lib/api/loans'
import { useMatchMessage, type NeedsMatchingGroup } from '@/lib/api/messages'
import { useAuth } from '@/lib/auth/context'
import { PURPOSES, type LoanPurpose } from '@/lib/pipeline/stages'

/** GHL's name for the contact, split into first and last as a starting point. */
function splitName(name: string | null): { first: string; last: string } {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return { first: '', last: '' }
  return { first: parts[0], last: parts.slice(1).join(' ') }
}

/**
 * Needs matching → "New lead from this": a sender nobody in MPS HQ has yet
 * becomes a new lead (the usual create_lead), and their waiting messages go
 * on the new file (the usual match_message, which also links the GHL contact
 * so later messages match on their own). Admins only, like the list.
 */
export function NewLeadFromMessage({ group, onDone }: { group: NeedsMatchingGroup; onDone: () => void }) {
  const { state } = useAuth()
  const myId = state.status === 'signedIn' ? state.user.id : null
  const members = useOrgMembers()
  const createLead = useCreateLead()
  const match = useMatchMessage()
  const start = splitName(group.name)
  const [first, setFirst] = useState(start.first)
  const [last, setLast] = useState(start.last)
  const [phone, setPhone] = useState(group.phone ?? '')
  const [email, setEmail] = useState(group.email ?? '')
  const [purpose, setPurpose] = useState<LoanPurpose>('purchase')
  const [lo, setLo] = useState<string | null>(myId)
  const busy = createLead.isPending || match.isPending
  const n = group.messages.length

  const save = async () => {
    if (!first.trim() || !last.trim()) return toast.error('Add a first and last name.')
    if (!phone.trim() && !email.trim()) return toast.error('Add a phone or an email.')
    try {
      const loanId = await createLead.mutateAsync({
        firstName: first.trim(),
        lastName: last.trim(),
        email: email.trim(),
        phone: phone.trim(),
        purpose,
        referralSource: 'Text or email (GHL)',
        assignedLoId: lo,
        existingContactId: null,
        priorLoanId: null,
      })
      const people = unwrap<{ contact_id: string }[]>(await db().from('loan_borrowers').select('contact_id').eq('loan_id', loanId).eq('role', 'primary'))
      const contactId = people[0]?.contact_id
      if (!contactId) throw new Error('The lead was added, but its person was not found. Match the messages with "This is…".')
      const count = await match.mutateAsync({ messageId: group.messages[0].id, contactId })
      toast.success(`New lead added for ${first.trim()} ${last.trim()}, with ${count} message${count === 1 ? '' : 's'}`)
      onDone()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onDone()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New lead from {n === 1 ? 'this message' : `these ${n} messages`}</DialogTitle>
          <DialogDescription>Adds them as a new lead and puts their messages on the new file. Nothing is sent.</DialogDescription>
        </DialogHeader>
        <FormGrid className="lg:grid-cols-4">
          <Input label="First name" value={first} onChange={setFirst} required span={2} autoFocus />
          <Input label="Last name" value={last} onChange={setLast} required span={2} />
          <Input label="Phone" type="tel" autoComplete="off" value={phone} onChange={setPhone} span={2} />
          <Input label="Email" type="email" autoComplete="off" value={email} onChange={setEmail} span={2} />
          <Select label="Loan purpose" value={purpose} onChange={(v) => setPurpose(v as LoanPurpose)} options={PURPOSES} required span={2} />
          <Select
            label="Assigned LO"
            value={lo}
            onChange={setLo}
            options={(members.data ?? []).map((m) => ({ value: m.id, label: m.name }))}
            placeholder={members.isLoading ? 'Loading…' : 'Select…'}
            span={2}
          />
        </FormGrid>
        <DialogFooter>
          <Button variant="ghost" disabled={busy} onClick={onDone}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={save}>
            {busy ? 'Adding…' : 'Add lead'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
