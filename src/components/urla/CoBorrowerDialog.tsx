import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { FormGrid, Input } from '@/components/shared'
import { useMatchingContacts } from '@/lib/api/contacts'
import { useAddBorrower } from '@/lib/api/urla'
import { formatPhone, fullName } from '@/lib/pipeline/helpers'
import { EditDialog } from './parts'

function useDebounced<T>(value: T, ms = 400): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

/** Add a co-borrower: a new person, or someone already in LOSuite (no duplicates). */
export function CoBorrowerDialog({
  loanId,
  existingBorrowerIds,
  onClose,
  onAdded,
}: {
  loanId: string
  existingBorrowerIds: string[]
  onClose: () => void
  onAdded: (contactId: string) => void
}) {
  const add = useAddBorrower(loanId)
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const matches = useMatchingContacts(useDebounced(email), useDebounced(phone))
  const suggestions = (matches.data ?? []).filter((m) => !existingBorrowerIds.includes(m.id))

  const submit = (existingContactId: string | null = null) => {
    if (!existingContactId && (!firstName.trim() || !lastName.trim())) return toast.error('First and last name are required')
    add.mutate(
      { firstName, lastName, email, phone, existingContactId },
      {
        onSuccess: (contactId) => {
          toast.success('Co-borrower added')
          onAdded(contactId)
          onClose()
        },
        onError: (e) => toast.error(`Could not add co-borrower: ${e.message}`),
      },
    )
  }

  return (
    <EditDialog
      title="Add co-borrower"
      description="Their own 1003 details (income, declarations) go on their tab once added."
      open
      onOpenChange={(o) => !o && onClose()}
      onSubmit={() => submit()}
      saving={add.isPending}
      submitLabel="Add co-borrower"
    >
      <FormGrid className="lg:grid-cols-4">
        <Input label="First name" value={firstName} onChange={setFirstName} required span={2} autoFocus />
        <Input label="Last name" value={lastName} onChange={setLastName} required span={2} />
        <Input label="Phone" type="tel" value={phone} onChange={setPhone} span={2} />
        <Input label="Email" type="email" value={email} onChange={setEmail} span={2} />
      </FormGrid>
      {suggestions.length > 0 && (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-900">Already in LOSuite: add this person instead of creating a duplicate?</p>
          {suggestions.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-card p-2">
              <div className="text-sm">
                <p className="font-medium">{fullName(m)}</p>
                <p className="text-xs text-muted-foreground">{[formatPhone(m.phone), m.email].filter(Boolean).join(' · ')}</p>
              </div>
              <Button type="button" size="sm" onClick={() => submit(m.id)} disabled={add.isPending}>
                Add this person
              </Button>
            </div>
          ))}
        </div>
      )}
    </EditDialog>
  )
}
