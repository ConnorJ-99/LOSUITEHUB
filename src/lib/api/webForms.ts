import { useQuery } from '@tanstack/react-query'
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
