import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db, keys, unwrap } from './client'

export type SubmissionOutcome = 'new_lead' | 'existing_open_loan' | 'new_loan_existing_person' | 'partner_inquiry'

/** One form submission from the website, as received (sensitive fields already removed). */
export interface WebForm {
  id: string
  loanId: string | null
  formType: string | null
  source: string | null
  tracking: Record<string, string>
  answers: Record<string, unknown>
  outcome: SubmissionOutcome
  receivedAt: string
}

interface WebFormRow {
  id: string
  loan_id: string | null
  form_type: string | null
  source: string | null
  tracking: Record<string, string> | null
  answers: Record<string, unknown> | null
  outcome: SubmissionOutcome
  received_at: string
}

/** Web forms from this person (any of their files), newest first. */
export function useWebForms(loanId: string, contactId: string | null) {
  return useQuery({
    queryKey: keys.webForms(loanId),
    queryFn: async () => {
      const filter = contactId ? `loan_id.eq.${loanId},contact_id.eq.${contactId}` : `loan_id.eq.${loanId}`
      return unwrap<WebFormRow[]>(
        await db().from('lead_submissions').select('id, loan_id, form_type, source, tracking, answers, outcome, received_at').or(filter).order('received_at', { ascending: false }).limit(20),
      ).map(
        (r): WebForm => ({ id: r.id, loanId: r.loan_id, formType: r.form_type, source: r.source, tracking: r.tracking ?? {}, answers: r.answers ?? {}, outcome: r.outcome, receivedAt: r.received_at }),
      )
    },
  })
}

/** "purchase_price" → "Purchase price", "homeValue" → "Home value". */
export function fieldLabel(key: string): string {
  const words = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase()
  return words ? words[0].toUpperCase() + words.slice(1) : key
}

/** Answers as label/value lines, skipping empty ones, contact details already on the file, and tracking (shown separately). */
export function answerLines(answers: Record<string, unknown>): { label: string; value: string }[] {
  const skip = new Set(['first_name', 'firstname', 'last_name', 'lastname', 'name', 'full_name', 'fullname', 'email', 'phone', 'phone_number', 'form_type', 'formtype', 'external_id', 'externalid', 'submission_id', 'referrer', 'landing_page', 'gclid', 'fbclid'])
  return Object.entries(answers).flatMap(([k, v]) => {
    if (skip.has(k.toLowerCase()) || k.toLowerCase().startsWith('utm_') || v === null || v === undefined || v === '') return []
    const value = typeof v === 'object' ? JSON.stringify(v) : String(v)
    return [{ label: fieldLabel(k), value: value.length > 300 ? `${value.slice(0, 300)}…` : value }]
  })
}

// ---------------------------------------------------------------------------
// Today: web forms nobody has handled yet
// ---------------------------------------------------------------------------

export interface OpenWebForm extends WebForm {
  kind: 'lead' | 'partner'
  /** Who sent it: the contact's name, or what the form says for partner inquiries. */
  name: string
  /** For partner inquiries (no file): email, phone and company from the form. */
  contactLine: string | null
}

interface OpenRow extends WebFormRow {
  kind: 'lead' | 'partner'
  contact: { first_name: string; last_name: string } | null
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')

/** Name and contact details from a form's answers (partner inquiries have no contact record). */
export function personFromAnswers(a: Record<string, unknown>): { name: string; contactLine: string | null } {
  const name = [str(a.first_name ?? a.firstName), str(a.last_name ?? a.lastName)].filter(Boolean).join(' ') || str(a.name ?? a.full_name) || str(a.email) || 'Someone'
  const company = str(a.brokerage ?? a.company ?? a.builder ?? a.business)
  const line = [str(a.email), str(a.phone ?? a.phone_number), company].filter(Boolean).join(' · ')
  return { name, contactLine: line || null }
}

export function useOpenWebForms() {
  return useQuery({
    queryKey: keys.openWebForms,
    queryFn: async () =>
      unwrap<OpenRow[]>(
        await db()
          .from('lead_submissions')
          .select('id, loan_id, kind, form_type, source, tracking, answers, outcome, received_at, contact:contacts!lead_submissions_contact_id_fkey ( first_name, last_name )')
          .is('handled_at', null)
          .order('received_at', { ascending: false })
          .limit(30),
      ).map((r): OpenWebForm => {
        const fromForm = personFromAnswers(r.answers ?? {})
        return {
          id: r.id,
          loanId: r.loan_id,
          kind: r.kind,
          formType: r.form_type,
          source: r.source,
          tracking: r.tracking ?? {},
          answers: r.answers ?? {},
          outcome: r.outcome,
          receivedAt: r.received_at,
          name: r.contact ? `${r.contact.first_name} ${r.contact.last_name}`.trim() : fromForm.name,
          contactLine: r.loan_id ? null : fromForm.contactLine,
        }
      }),
  })
}

export function useMarkHandled() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, handled }: { id: string; handled: boolean }) => {
      const ok = unwrap<boolean>(await db().rpc('mark_submission_handled', { p_id: id, p_handled: handled }))
      if (!ok) throw new Error('This form was not found, or you do not have access.')
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: keys.openWebForms }),
  })
}
