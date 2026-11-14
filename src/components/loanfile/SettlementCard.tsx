// "Settlement & insurance" on a file's Overview (Connor, 2026-11-13): the
// file's title company and insurance agent (picked from the Partner center
// or added here; contract intake's "Add to team" fills title in), and the
// mortgagee clause the insurance agent needs: the loan's override if set,
// else the lender's clause, plus "Loan # {lender loan #}". "Send request"
// emails the title or insurance request through GoHighLevel (PartnerRequestDialog).
import { useState } from 'react'
import { CopyIcon, MailIcon, PhoneIcon, SendIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, TextArea } from '@/components/shared'
import { TeamMemberDialog } from '@/components/partners/TeamMemberDialog'
import { afterPartnerJoined } from '@/components/messaging/fileTextRequests'
import type { RequestKind } from '@/lib/partners/requestEmail'
import { PartnerMessages } from './PartnerMessages'
import { PartnerRequestDialog } from './PartnerRequestDialog'
import { lenderClause, useLenders } from '@/lib/api/lenders'
import { useLoanFile, useSaveTeamMember, type TeamRole } from '@/lib/api/loanfile'
import { useLoanNumbers, useSaveLoanNumbers } from '@/lib/api/loanNumbers'
import { resolveLender } from '@/lib/loans/numbers'
import { mortgageeClause } from '@/lib/loans/mortgagee'

const SLOTS: { role: TeamRole; label: string; request: RequestKind }[] = [
  { role: 'title', label: 'Title company', request: 'title' },
  { role: 'insurance_agent', label: 'Insurance agent', request: 'insurance' },
]

const FROM_LABEL = { override: 'Override for this loan', lender: "From the lender's clause", legacy: "From the lender's one-line clause" } as const

export function SettlementCard({ loanId, organizationId }: { loanId: string; organizationId: string }) {
  const file = useLoanFile(loanId)
  const saveTeam = useSaveTeamMember(loanId, organizationId)
  const nums = useLoanNumbers(loanId)
  const lenders = useLenders()
  const saveNums = useSaveLoanNumbers(loanId)
  const [editing, setEditing] = useState<{ role: TeamRole; label: string } | null>(null)
  const [override, setOverride] = useState<string | null>(null)
  const [request, setRequest] = useState<{ kind: RequestKind; partnerId: string } | null>(null)

  const n = nums.data
  const lender = n ? resolveLender(n, lenders.data ?? []) : null
  const lenderRow = lender?.id ? (lenders.data ?? []).find((l) => l.id === lender.id) : null
  const clause = n ? mortgageeClause(n.mortgageeClauseOverride, lenderRow ? lenderClause(lenderRow) : null, n.lenderLoanNumber) : null

  return (
    <Card title="Settlement & insurance">
      <div className="space-y-3">
        {/* The insurance agent role exists once the partner requests script has run. */}
        {SLOTS.filter((slot) => slot.role !== 'insurance_agent' || n?.ready).map((slot) => {
          const r = file.data?.team.find((t) => t.role === slot.role) ?? null
          return (
            <div key={slot.role} className="flex flex-wrap items-start justify-between gap-2 border-b pb-3 last:border-0">
              <div className="min-w-0 text-sm">
                <p className="text-xs text-muted-foreground">{slot.label}</p>
                {r ? (
                  <>
                    <p className="font-medium">
                      {[r.company, r.name].filter(Boolean).join(' · ')}
                    </p>
                    <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                      {r.email && (
                        <span className="inline-flex items-center gap-1">
                          <MailIcon className="size-3" />
                          {r.email}
                        </span>
                      )}
                      {r.phone && (
                        <span className="inline-flex items-center gap-1">
                          <PhoneIcon className="size-3" />
                          {r.phone}
                        </span>
                      )}
                    </p>
                    {/* The requests sent and their replies (saved from GoHighLevel). */}
                    {r.partnerId && <PartnerMessages loanId={loanId} partnerId={r.partnerId} />}
                  </>
                ) : (
                  <p className="text-muted-foreground">Not picked yet</p>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {r && (
                  <Button
                    size="xs"
                    // Only a saved partner (linked by email or phone) can be emailed through GoHighLevel.
                    onClick={() => (r.partnerId ? setRequest({ kind: slot.request, partnerId: r.partnerId }) : toast.error(`Add ${r.company || r.name || "their"} email with Change first, so they are saved as a partner.`))}
                  >
                    <SendIcon />
                    Send {slot.request} request
                  </Button>
                )}
                <Button size="xs" variant="outline" onClick={() => setEditing(slot)}>
                  {r ? 'Change' : 'Pick or add'}
                </Button>
              </div>
            </div>
          )
        })}

        {n?.ready && (
          <div className="text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-xs text-muted-foreground">Mortgagee clause{clause?.from ? ` · ${FROM_LABEL[clause.from]}` : ''}</p>
              {clause?.text && override === null && (
                <Button size="xs" variant="ghost" onClick={() => navigator.clipboard.writeText(clause.text!).then(() => toast.success('Mortgagee clause copied'), () => toast.error("Couldn't copy"))}>
                  <CopyIcon />
                  Copy
                </Button>
              )}
            </div>
            {override !== null ? (
              <div className="mt-1 space-y-2">
                <TextArea label="Clause for this loan" value={override} onChange={setOverride} rows={4} hint="The lender loan # is added at the end if it isn't in the text." />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="xs"
                    disabled={saveNums.isPending}
                    onClick={() =>
                      saveNums.mutate(
                        { mortgageeClauseOverride: override },
                        {
                          onSuccess: () => {
                            toast.success(override.trim() ? 'Clause override saved' : "Using the lender's clause")
                            setOverride(null)
                          },
                          onError: (e) => toast.error(e.message),
                        },
                      )
                    }
                  >
                    Save
                  </Button>
                  <Button size="xs" variant="outline" onClick={() => setOverride(null)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {clause?.text ? (
                  <pre className="mt-1 rounded-md bg-muted/60 p-2 font-sans text-xs whitespace-pre-wrap">{clause.text}</pre>
                ) : (
                  <p className="mt-1 text-xs text-muted-foreground">{lender?.name ? `${lender.name} has no mortgagee clause yet (Lenders page).` : 'Pick the lender (the Lender chip at the top) to see its clause.'}</p>
                )}
                <div className="mt-1 flex flex-wrap gap-2">
                  <Button size="xs" variant="outline" onClick={() => setOverride(n.mortgageeClauseOverride ?? (clause?.from === 'lender' || clause?.from === 'legacy' ? (clause.text ?? '').replace(/\nLoan # .*$/, '') : ''))}>
                    {n.mortgageeClauseOverride ? 'Edit override' : 'Override for this loan'}
                  </Button>
                  {n.mortgageeClauseOverride && (
                    <Button size="xs" variant="ghost" disabled={saveNums.isPending} onClick={() => saveNums.mutate({ mortgageeClauseOverride: null }, { onError: (e) => toast.error(e.message) })}>
                      Use the lender's clause
                    </Button>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {request && (
        <PartnerRequestDialog kind={request.kind} loanId={loanId} partnerId={request.partnerId} clause={clause?.text ?? null} lenderLoanNumber={n?.lenderLoanNumber ?? null} onClose={() => setRequest(null)} />
      )}

      {editing && (
        <TeamMemberDialog
          role={editing.role}
          label={editing.label}
          withCompany
          record={file.data?.team.find((t) => t.role === editing.role) ?? null}
          saving={saveTeam.isPending}
          onClose={() => setEditing(null)}
          onSave={(member) =>
            saveTeam.mutate(
              { role: editing.role, member },
              {
                onSuccess: (partnerId) => {
                  toast.success(`${editing.label} saved`)
                  setEditing(null)
                  // A partner new on this file: add them to GoHighLevel and offer the intro text.
                  if (partnerId) void afterPartnerJoined(organizationId, loanId, partnerId)
                },
                onError: (e) => toast.error(e.message),
              },
            )
          }
        />
      )}
    </Card>
  )
}
