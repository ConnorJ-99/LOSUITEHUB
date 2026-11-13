import { useState } from 'react'
import { UserCheckIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { FormGrid, Input } from '@/components/shared'
import { EditDialog } from '@/components/urla/parts'
import { useMatchingContacts } from '@/lib/api/contacts'
import { useCreateLead } from '@/lib/api/loans'
import { primaryContactOf, saveQuoteToLoan } from '@/lib/api/quickQuotes'
import type { ContactSummary } from '@/lib/api/types'
import { useAuth } from '@/lib/auth/context'
import { formatPhone, fullName } from '@/lib/pipeline/helpers'
import { purposeLabel } from '@/lib/pipeline/stages'
import { leadOption, loanFactsFromQuote } from '@/lib/quickquote/handoff'
import { scoreFor, splitName, type QuoteOption, type QuoteScenario } from '@/lib/quickquote/quote'

export interface SavedLead {
  loanId: string
  contactId: string
  name: string
}

/**
 * Saves the quote's borrower as a new Lead (or a new loan for someone already
 * in LOSuite, matched by email or phone like New Lead) and writes the quote's
 * deal into the file.
 */
export function SaveLeadDialog({ scenario, options, reason, onSaved, onClose }: { scenario: QuoteScenario; options: QuoteOption[]; reason: string; onSaved: (lead: SavedLead) => void; onClose: () => void }) {
  const { state } = useAuth()
  const me = state.status === 'signedIn' ? state.user.id : null
  const createLead = useCreateLead()
  const initial = splitName(scenario.borrower.name)
  const [firstName, setFirstName] = useState(initial.firstName)
  const [lastName, setLastName] = useState(initial.lastName)
  const [email, setEmail] = useState(scenario.borrower.email)
  const [phone, setPhone] = useState(scenario.borrower.phone)
  const [existing, setExisting] = useState<ContactSummary | null>(null)
  const [dismissed, setDismissed] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(false)
  const matches = useMatchingContacts(existing ? '' : email, existing ? '' : phone)
  const suggestions = (matches.data ?? []).filter((m) => !dismissed.includes(m.id))

  const errors = {
    firstName: !existing && !firstName.trim() ? 'First name is required' : undefined,
    lastName: !existing && !lastName.trim() ? 'Last name is required' : undefined,
    contact: !existing && !email.trim() && !phone.trim() ? 'Add a phone number or email' : undefined,
  }

  const submit = async () => {
    setSubmitted(true)
    if (errors.firstName || errors.lastName || errors.contact) return
    setSaving(true)
    try {
      const loanId = await createLead.mutateAsync({
        firstName,
        lastName,
        email,
        phone,
        purpose: scenario.purpose,
        referralSource: 'Quick quote',
        assignedLoId: me,
        existingContactId: existing?.id ?? null,
        priorLoanId: existing?.loans[0]?.id ?? null,
      })
      const contactId = existing?.id ?? (await primaryContactOf(loanId))
      const name = existing ? fullName(existing) : `${firstName.trim()} ${lastName.trim()}`
      try {
        await saveQuoteToLoan(loanId, contactId, loanFactsFromQuote(scenario, leadOption(options)), scoreFor(scenario.creditBucket))
      } catch (e) {
        toast.error(`${name} was saved as a Lead, but the quote's numbers didn't copy into the file: ${(e as Error).message}`)
      }
      onSaved({ loanId, contactId, name })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <EditDialog
      title="Save as lead"
      description={`${reason} The quote's price, loan amount, loan type, rate and credit range go into the new file.`}
      open
      onOpenChange={(o) => !o && onClose()}
      onSubmit={submit}
      saving={saving}
      submitLabel={saving ? 'Saving…' : existing ? `Add a ${purposeLabel(scenario.purpose).toLowerCase()} loan` : 'Save lead'}
    >
      {existing ? (
        <div className="flex items-start justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-sm">
          <div>
            <p className="font-medium">New loan for {fullName(existing)}</p>
            <p className="text-muted-foreground">{[formatPhone(existing.phone), existing.email].filter(Boolean).join(' · ')}</p>
          </div>
          <Button type="button" size="sm" variant="ghost" onClick={() => setExisting(null)}>
            <XIcon />
            Not them
          </Button>
        </div>
      ) : (
        <FormGrid className="lg:grid-cols-2">
          <Input label="First name" required value={firstName} onChange={setFirstName} error={submitted ? errors.firstName : undefined} />
          <Input label="Last name" required value={lastName} onChange={setLastName} error={submitted ? errors.lastName : undefined} />
          <Input label="Email" type="email" value={email} onChange={setEmail} error={submitted ? errors.contact : undefined} />
          <Input label="Phone" type="tel" value={phone} onChange={setPhone} />
        </FormGrid>
      )}
      {!existing && suggestions.length > 0 && (
        <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3">
          <p className="text-xs font-medium text-amber-900">Already in LOSuite: add a new loan to this person instead of a duplicate?</p>
          {suggestions.map((m) => (
            <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-card p-2 text-sm">
              <div>
                <p className="font-medium">{fullName(m)}</p>
                <p className="text-xs text-muted-foreground">{[formatPhone(m.phone), m.email].filter(Boolean).join(' · ')}</p>
              </div>
              <div className="flex gap-1.5">
                <Button type="button" size="sm" variant="outline" onClick={() => setDismissed((d) => [...d, m.id])}>
                  Different person
                </Button>
                <Button type="button" size="sm" onClick={() => setExisting(m)}>
                  <UserCheckIcon />
                  Use this person
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </EditDialog>
  )
}
