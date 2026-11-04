import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { SearchInput } from '@/components/shared'
import { useContacts } from '@/lib/api/contacts'
import { useLoan } from '@/lib/api/loans'
import { useFilePeople } from '@/lib/api/messages'
import type { ContactSummary } from '@/lib/api/types'
import { formatPhone, fullName } from '@/lib/pipeline/helpers'
import { purposeLabel, stageLabel } from '@/lib/pipeline/stages'
import { Composer } from './Composer'

/** The reply box for one person on one file, once both have loaded. */
function ComposeFor({ contactId, loanId }: { contactId: string; loanId: string }) {
  const loan = useLoan(loanId)
  const people = useFilePeople(loanId)
  if (loan.error || people.error) return <p className="text-sm text-destructive">{(loan.error ?? people.error)?.message}</p>
  if (!loan.data || !people.data) return <p className="text-sm text-muted-foreground">Loading…</p>
  // The person picked goes first, so the box starts on them.
  const ordered = [...people.data].sort((a, b) => (a.id === contactId ? -1 : b.id === contactId ? 1 : 0))
  return <Composer key={`${loanId}:${contactId}`} loan={loan.data} people={ordered} />
}

/**
 * "New message" from the Inbox: find any client you can see, pick their file
 * (the newest one first), and write a text or email with the same reply box
 * as the Messages tab: Send or Schedule, both after your approval.
 */
export function NewMessageDialog({ onClose }: { onClose: () => void }) {
  const contacts = useContacts()
  const [search, setSearch] = useState('')
  const [person, setPerson] = useState<ContactSummary | null>(null)
  const [loanId, setLoanId] = useState<string | null>(null)

  const q = search.trim().toLowerCase()
  const digits = q.replace(/\D/g, '')
  const found =
    q.length >= 2
      ? (contacts.data ?? [])
          .filter((p) => p.loans.length > 0)
          .filter((p) => fullName(p).toLowerCase().includes(q) || (p.email ?? '').toLowerCase().includes(q) || (digits.length >= 4 && (p.phone ?? '').replace(/\D/g, '').includes(digits)))
          .slice(0, 8)
      : []

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>New message</DialogTitle>
          <DialogDescription>To any client on a file you can see. Nothing goes out until you approve it.</DialogDescription>
        </DialogHeader>
        {!person ? (
          <div className="space-y-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Search by name, email or phone" />
            {found.length > 0 && (
              <ul className="divide-y rounded-md border">
                {found.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50"
                      onClick={() => {
                        setPerson(p)
                        setLoanId(p.loans[0].id)
                      }}
                    >
                      <span className="font-medium">{fullName(p)}</span>
                      <span className="truncate text-xs text-muted-foreground">{[p.phone && formatPhone(p.phone), p.email].filter(Boolean).join(' · ')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {q.length >= 2 && found.length === 0 && <p className="text-xs text-muted-foreground">Nobody on your files matches.</p>}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{fullName(person)}</span>
              {person.loans.length > 1 ? (
                <select className="rounded-md border bg-card px-1.5 py-0.5" value={loanId ?? ''} onChange={(e) => setLoanId(e.target.value)} aria-label="Which file">
                  {person.loans.map((l) => (
                    <option key={l.id} value={l.id}>
                      {purposeLabel(l.purpose)} · {stageLabel(l.stage)}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-muted-foreground">
                  {purposeLabel(person.loans[0].purpose)} · {stageLabel(person.loans[0].stage)}
                </span>
              )}
              <Button size="xs" variant="ghost" onClick={() => setPerson(null)}>
                Someone else
              </Button>
            </div>
            {loanId && <ComposeFor contactId={person.id} loanId={loanId} />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
