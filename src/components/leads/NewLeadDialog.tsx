import type * as React from 'react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { UserCheckIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormGrid, Input, Select, ToggleChip } from '@/components/shared'
import { StageBadge } from '@/components/pipeline/StageBadge'
import { useMatchingContacts } from '@/lib/api/contacts'
import { db, keys, unwrap } from '@/lib/api/client'
import { linkGhlContact, useGhlStatus } from '@/lib/api/ghl'
import { offerApplicationLink, offerBorrowerIntro } from '@/components/messaging/fileTextRequests'
import { useCreateLead, useOrgMembers, useUpdateStage } from '@/lib/api/loans'
import { addLeadForLo, useTeamAccess } from '@/lib/api/team'
import type { ContactSummary } from '@/lib/api/types'
import { useAuth } from '@/lib/auth/context'
import { formatPhone, fullName } from '@/lib/pipeline/helpers'
import { PURPOSES, purposeLabel, stageLabel, type LoanPurpose } from '@/lib/pipeline/stages'
import type { NewLeadPreset } from './new-lead-context'

interface FormState {
  firstName: string
  lastName: string
  phone: string
  email: string
  purpose: LoanPurpose
  referralSource: string
  assignedLoId: string | null
}

const blankForm = (myId: string | null, preset: NewLeadPreset | null = null): FormState => ({
  firstName: '',
  lastName: '',
  phone: '',
  email: '',
  purpose: preset?.purpose ?? 'purchase',
  referralSource: '',
  assignedLoId: myId,
})

// The loan officer an LO Assistant picked last (this device only).
const LAST_LO_KEY = 'mpshq.newLead.lastLo'
const readLastLo = (): string | null => {
  try {
    return localStorage.getItem(LAST_LO_KEY)
  } catch {
    return null
  }
}
const writeLastLo = (id: string) => {
  try {
    localStorage.setItem(LAST_LO_KEY, id)
  } catch {
    // Private window: just not remembered.
  }
}

/** Waits until typing pauses before looking up duplicates. */
function useDebounced<T>(value: T, ms = 400): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms)
    return () => clearTimeout(timer)
  }, [value, ms])
  return debounced
}

/** preset: from a pipeline column's "+ Add lead": that board's loan type, and the column's stage to start in. */
export function NewLeadDialog({ open, onOpenChange, preset = null }: { open: boolean; onOpenChange: (open: boolean) => void; preset?: NewLeadPreset | null }) {
  const { state } = useAuth()
  const myId = state.status === 'signedIn' ? state.user.id : null
  const organizationId = state.status === 'signedIn' ? state.user.organizationId : null
  const navigate = useNavigate()
  const createLead = useCreateLead()
  const updateStage = useUpdateStage()
  const members = useOrgMembers()
  const queryClient = useQueryClient()

  const [form, setForm] = useState<FormState>(() => blankForm(myId, preset))
  // A different "+ Add lead" column starts the form over with its loan type.
  const [presetSeen, setPresetSeen] = useState(preset)
  if (open && preset !== presetSeen) {
    setPresetSeen(preset)
    setForm(blankForm(myId, preset))
  }
  const startStage = preset?.stage && preset.stage !== 'lead' ? preset.stage : null
  const [existing, setExisting] = useState<ContactSummary | null>(null)
  const [dismissedIds, setDismissedIds] = useState<string[]>([])
  const [submitted, setSubmitted] = useState(false)
  // On a call: open the Prequal tab right after saving. Stays on for the next lead.
  const [startPrequal, setStartPrequal] = useState(false)
  const [addToGhl, setAddToGhl] = useState(false)
  // Text the loan application link (with the LO's NMLS #) after saving, in the intro text.
  const [sendApplication, setSendApplication] = useState(false)
  const ghl = useGhlStatus()

  const set = <K extends keyof FormState>(key: K) => (value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))

  // Who the lead can go to (Connor, 2026-11-17): owners and admins pick any loan officer; an LO Assistant picks
  // the loan officers they assist or themselves; everyone else adds their own. Before the LO assistant roles
  // script, the old picker stays.
  const access = useTeamAccess()
  const companyAdmin = state.status === 'signedIn' && (state.user.role === 'owner' || state.user.role === 'admin')
  const meMember = access.data?.members.find((m) => m.id === myId)
  const assists = (meMember?.secondaryRoles.includes('loa') ? meMember.assists : []).filter((id) => access.data?.members.some((m) => m.id === id))
  const pickMode: 'all' | 'loa' | 'none' = !access.data?.ready || companyAdmin ? 'all' : assists.length ? 'loa' : 'none'
  const nameOf = (id: string | null) => access.data?.members.find((m) => m.id === id)?.name ?? members.data?.find((m) => m.id === id)?.name ?? 'the loan officer'
  const firstOf = (id: string | null) => nameOf(id).split(/\s+/)[0]
  const [notifyLo, setNotifyLo] = useState(true)
  const intakeAfter = useRef(false)
  // An LO Assistant starts on the loan officer they picked last time.
  const [loaDefaulted, setLoaDefaulted] = useState(false)
  if (open && pickMode === 'loa' && !loaDefaulted) {
    setLoaDefaulted(true)
    const last = readLastLo()
    setForm((f) => ({ ...f, assignedLoId: last && (assists.includes(last) || last === myId) ? last : assists[0] }))
  }
  const forOther = !!form.assignedLoId && form.assignedLoId !== myId

  const email = useDebounced(form.email)
  const phone = useDebounced(form.phone)
  const matches = useMatchingContacts(existing ? '' : email, existing ? '' : phone)
  const suggestions = (matches.data ?? []).filter((m) => !dismissedIds.includes(m.id))

  const reset = () => {
    setForm(blankForm(myId, preset))
    setExisting(null)
    setDismissedIds([])
    setSubmitted(false)
    setLoaDefaulted(false)
    setNotifyLo(true)
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
        // Made as yours first, so it can be moved to its column; handed over below.
        assignedLoId: myId,
        existingContactId: existing?.id ?? null,
        priorLoanId: existing?.loans[0]?.id ?? null,
      },
      {
        onSuccess: async (loanId) => {
          // "Save & start intake interview" (Connor, 2026-11-17): the interview opens once the lead is saved and handed over.
          const thenIntake = intakeAfter.current
          intakeAfter.current = false
          const name = existing ? fullName(existing) : `${form.firstName} ${form.lastName}`.trim()
          close(false)
          // "Add to GoHighLevel after saving": the same match-or-create as the file's button, once the file has its loan officer.
          const borrower = addToGhl || sendApplication ? (unwrap<{ contact_id: string } | null>(await db().from('loan_borrowers').select('contact_id').eq('loan_id', loanId).eq('role', 'primary').maybeSingle())?.contact_id ?? null) : null
          // Then the intro text (work number, personal cell) while they're fresh: with the application link when that chip is on.
          const offerIntro = () => {
            if (!borrower) return
            if (sendApplication) void offerApplicationLink(loanId, borrower)
            else void offerBorrowerIntro(loanId, borrower)
          }
          const ghlAdd = async () => {
            if (!borrower || !organizationId) return
            if (!addToGhl) {
              // Application link without "Add to GoHighLevel": the send itself matches or adds them.
              offerIntro()
              return
            }
            try {
              const r = await linkGhlContact(organizationId, loanId, borrower)
              if ('skipped' in r) toast.message(`${name} wasn't added to GoHighLevel: ${r.skipped}`)
              else {
                toast.success(r.created ? `${name} added to GoHighLevel` : `${name} linked to their GoHighLevel contact`)
                offerIntro()
              }
            } catch (e) {
              toast.error(`${name} wasn't added to GoHighLevel: ${(e as Error).message} Retry from the file's Messages tab.`)
            }
          }
          // Added from a pipeline column: move it to that column (logged like any stage change).
          if (startStage) {
            try {
              await updateStage.mutateAsync({ loanId, stage: startStage })
            } catch (e) {
              toast.error(`${name} was added as a Lead, but couldn't be moved to ${stageLabel(startStage)}: ${(e as Error).message}`)
              return
            }
          }
          const where = startStage ? stageLabel(startStage) : 'Lead'
          if (pickMode === 'loa' && form.assignedLoId) writeLastLo(form.assignedLoId)
          // For another loan officer: theirs now (and in GHL), and out of your pipeline unless you're an admin or
          // their LO Assistant (then you stay on the file as its LO Assistant, Connor 2026-11-17).
          if (form.assignedLoId !== myId) {
            try {
              await addLeadForLo(loanId, form.assignedLoId, notifyLo)
            } catch (e) {
              toast.error(`${name} was added as your lead, but couldn't be handed over: ${(e as Error).message}`)
              return
            }
            await queryClient.invalidateQueries({ queryKey: keys.pipeline })
            await ghlAdd()
            const owner = members.data?.find((m) => m.id === form.assignedLoId)?.name ?? 'no one yet'
            if (thenIntake) {
              navigate(`/loans/${loanId}/intake`)
              toast.success(`${name} added to ${where} for ${owner}`)
              return
            }
            if (pickMode === 'loa') {
              toast.success(`${name} added to ${where} for ${owner}. You're on the file as LO Assistant.`, { action: { label: 'Open', onClick: () => navigate(`/loans/${loanId}`) } })
              return
            }
            toast.success(`${name} added to ${where} for ${owner}`)
            return
          }
          await ghlAdd()
          if (thenIntake) {
            navigate(`/loans/${loanId}/intake`)
            toast.success(`${name} added to ${where}`)
            return
          }
          if (startPrequal) {
            navigate(`/loans/${loanId}?tab=1003`)
            toast.success(`${name} added to ${where}`)
            return
          }
          toast.success(`${name} added to ${where}`, {
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
          <DialogDescription>
            {pickMode === 'loa' && "You're adding as LO Assistant. "}Starts in {startStage ? stageLabel(startStage) : 'the Lead stage'}. You can fill in the rest later.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4" noValidate>
          {pickMode === 'loa' && (
            <div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Loan officer on this file</p>
              <div className="mt-1.5 inline-flex flex-wrap rounded-lg border bg-muted/40 p-0.5" role="radiogroup" aria-label="Loan officer on this file">
                {[...assists, myId!].map((id) => (
                  <button
                    key={id}
                    type="button"
                    role="radio"
                    aria-checked={form.assignedLoId === id}
                    onClick={() => set('assignedLoId')(id)}
                    className={cn('rounded-md px-3 py-1 text-sm', form.assignedLoId === id ? 'bg-white font-medium text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground')}
                  >
                    {id === myId ? `Me (${firstOf(myId)})` : firstOf(id)}
                  </button>
                ))}
              </div>
              {forOther && (
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Lead lands in {firstOf(form.assignedLoId)}'s pipeline, owned by {firstOf(form.assignedLoId)} in GHL. You're attached as LO Assistant so you can keep working it.
                </p>
              )}
            </div>
          )}
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
              <p className="text-xs font-medium text-amber-900">Already in MPS HQ: add a new loan to this person instead of a duplicate?</p>
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
            {pickMode === 'all' && (
              <Select
                label="Assigned LO"
                value={form.assignedLoId}
                onChange={set('assignedLoId')}
                options={memberOptions}
                placeholder={members.isLoading ? 'Loading…' : 'Select…'}
                span={2}
              />
            )}
            <Input
              label="Referral source"
              value={form.referralSource}
              onChange={set('referralSource')}
              placeholder="e.g. Realtor Amy Lee, Zillow, past client"
              span={4}
            />
          </FormGrid>

          <div className="flex flex-wrap gap-2">
            <ToggleChip label="Start prequal call after saving" pressed={startPrequal} onChange={setStartPrequal} />
            {ghl.data?.ready && <ToggleChip label="Add to GoHighLevel after saving" pressed={addToGhl} onChange={setAddToGhl} />}
            {ghl.data?.ready && <ToggleChip label="Text application link after saving" pressed={sendApplication} onChange={setSendApplication} />}
          </div>
          {forOther && access.data?.ready && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-primary" checked={notifyLo} onChange={(e) => setNotifyLo(e.target.checked)} />
              Notify {firstOf(form.assignedLoId)} now (push + Today: "New lead added by {firstOf(myId)}")
            </label>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="outline" disabled={createLead.isPending} onClick={() => (intakeAfter.current = false)}>
              {createLead.isPending ? 'Saving…' : 'Save lead only'}
            </Button>
            <Button type="submit" disabled={createLead.isPending} onClick={() => (intakeAfter.current = true)}>
              Save &amp; start intake interview →
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
