import { useEffect } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { addDays } from '@/lib/closed/keyDates'
import { todayIso } from '@/lib/dates'
import { draftContactId, planConditionDrafts, planKeyDateDrafts, type AutomatedLoan, type ConditionLoan, type DraftPerson, type ExistingDraft } from '@/lib/queue/drafts'
import { db, keys, unwrap } from './client'
import { makeUploadReminderDrafts } from './uploadRequests'

// The drafting engine's data side: loads what the plan needs, saves the drafts
// it returns. Row Level Security limits everything to the files you can see.

interface PersonRow {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  email: string | null
  date_of_birth: string | null
  sms_consent: boolean | null
  email_consent: boolean | null
  sms_opted_out_at: string | null
  email_opted_out_at: string | null
  automate_reminders: boolean
}

interface BorrowerRow {
  role: 'primary' | 'co_borrower'
  contact: PersonRow | null
}

const PERSON = 'id, first_name, last_name, phone, email, date_of_birth, sms_consent, email_consent, sms_opted_out_at, email_opted_out_at, automate_reminders'
const BORROWERS = `borrowers:loan_borrowers ( role, contact:contacts!loan_borrowers_contact_id_fkey ( ${PERSON} ) )`
const LO = 'lo:profiles!loans_assigned_lo_id_fkey ( full_name )'

const toPerson = (r: PersonRow): DraftPerson => ({
  contactId: r.id,
  firstName: r.first_name,
  lastName: r.last_name,
  phone: r.phone,
  email: r.email,
  smsConsent: r.sms_consent,
  emailConsent: r.email_consent,
  smsOptedOut: r.sms_opted_out_at !== null,
  emailOptedOut: r.email_opted_out_at !== null,
})

const primaryOf = (borrowers: BorrowerRow[]) => borrowers.find((b) => b.role === 'primary')?.contact ?? null

interface ClosedRow {
  id: string
  organization_id: string
  closing_date: string | null
  first_payment_date: string | null
  occupancy: string | null
  lo: { full_name: string | null } | null
  borrowers: BorrowerRow[]
  home: { address_line: string; insurance_renewal_date: string | null; homestead_filed: boolean | null } | null
}

interface ConditionRow {
  loan_id: string
  body: string
  status: 'outstanding' | 'requested'
  status_changed_at: string
  loan: { organization_id: string; stage: string; lo: { full_name: string | null } | null; borrowers: BorrowerRow[] } | null
}

const DONE_STAGES = new Set(['closed', 'nurture', 'lost'])

/** Works out today's reminder drafts and saves the missing ones; returns how many were added. */
export async function makeReminderDrafts(today: string): Promise<number> {
  const [closedRows, conditionRows, existingRows] = await Promise.all([
    db()
      .from('loans')
      .select(`id, organization_id, closing_date, first_payment_date, occupancy, ${LO}, ${BORROWERS}, home:properties!loans_subject_property_id_fkey ( address_line, insurance_renewal_date, homestead_filed )`)
      .eq('stage', 'closed'),
    db()
      .from('loan_conditions')
      .select(`loan_id, body, status, status_changed_at, loan:loans!loan_conditions_loan_id_fkey ( organization_id, stage, ${LO}, ${BORROWERS} )`)
      .eq('party', 'borrower')
      .in('status', ['outstanding', 'requested']),
    db()
      .from('action_items')
      .select('loan_id, source_key, status, due_on, payload')
      .not('source_key', 'is', null)
      .gte('due_on', addDays(today, -14)),
  ])

  const automated: AutomatedLoan[] = unwrap<ClosedRow[]>(closedRows).flatMap((r) => {
    const p = primaryOf(r.borrowers)
    if (!p?.automate_reminders) return []
    return [
      {
        loanId: r.id,
        organizationId: r.organization_id,
        closingDate: r.closing_date,
        firstPaymentDate: r.first_payment_date,
        insuranceRenewalDate: r.home?.insurance_renewal_date ?? null,
        homesteadFiled: r.home?.homestead_filed ?? null,
        occupancy: r.occupancy,
        street: r.home?.address_line ?? null,
        loName: r.lo?.full_name ?? null,
        borrower: { ...toPerson(p), birthday: p.date_of_birth },
      },
    ]
  })

  const byLoan = new Map<string, ConditionLoan>()
  for (const r of unwrap<ConditionRow[]>(conditionRows)) {
    if (!r.loan || DONE_STAGES.has(r.loan.stage)) continue
    let loan = byLoan.get(r.loan_id)
    if (!loan) {
      const p = primaryOf(r.loan.borrowers)
      loan = { loanId: r.loan_id, organizationId: r.loan.organization_id, loName: r.loan.lo?.full_name ?? null, borrower: p ? toPerson(p) : null, conditions: [] }
      byLoan.set(r.loan_id, loan)
    }
    loan.conditions.push({ body: r.body, status: r.status, since: todayIso(new Date(r.status_changed_at)) })
  }

  const existing: ExistingDraft[] = unwrap<{ loan_id: string; source_key: string; status: ExistingDraft['status']; due_on: string | null; payload: unknown }[]>(existingRows).map((r) => ({
    loanId: r.loan_id,
    sourceKey: r.source_key,
    status: r.status,
    dueOn: r.due_on,
    contactId: draftContactId(r.payload),
  }))

  const drafts = [...planKeyDateDrafts(automated, existing, today), ...planConditionDrafts([...byLoan.values()], existing, today)]
  if (drafts.length === 0) return 0
  const saved = unwrap<{ id: string }[]>(
    await db()
      .from('action_items')
      .upsert(
        drafts.map((d) => ({ organization_id: d.organizationId, loan_id: d.loanId, kind: 'draft_message', title: d.title, payload: d.payload, sources: [], confidence: null, due_on: d.dueOn, ai_run_id: null, source_key: d.sourceKey })),
        { onConflict: 'organization_id,source_key', ignoreDuplicates: true },
      )
      .select('id'),
  )
  return saved.length
}

// Once per day per open tab is plenty; the source keys stop duplicates across tabs and people.
let lastRun: string | null = null

/** Makes today's reminder drafts when the Today page opens, then refreshes it. */
export function useReminderDrafts(enabled: boolean) {
  const queryClient = useQueryClient()
  useEffect(() => {
    const today = todayIso()
    if (!enabled || lastRun === today) return
    lastRun = today
    // Upload-link reminders (UI pass Part 3) ride along; they never block the others.
    Promise.all([makeReminderDrafts(today), makeUploadReminderDrafts(today).catch(() => 0)])
      .then(([a, b]) => a + b)
      .then((added) => {
        if (added > 0) queryClient.invalidateQueries({ queryKey: keys.today })
      })
      .catch((e: unknown) => {
        // Drafts are a convenience: a failure here must not break Today. Try again next time it opens.
        lastRun = null
        console.error('Reminder drafts were not made:', e)
      })
  }, [enabled, queryClient])
}

/** Turns a client's "Automate reminders" switch on or off. */
export function useSetAutomateReminders() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ contactId, on }: { contactId: string; on: boolean }) => {
      unwrap(await db().from('contacts').update({ automate_reminders: on }).eq('id', contactId).select('id'))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.closedLoans }),
  })
}
