// The assistant's outbound tools (Loan Officer Assistant, Phase 3, Connor
// 2026-11-03). They NEVER send: a tool only prepares a pending action
// (assistant_actions status "pending") and a preview card. The message goes
// out only when the person taps Send on the card, through the same approval
// send path as every other send in MPS HQ (useSendMessage: approve_send, then
// the ghl function, from the file's loan officer's own GHL number or email,
// with every check). Documents go by email only; a heads-up text never has a
// link (decision 3).

import { db, unwrap } from '@/lib/api/client'
import { fetchEstimates } from '@/lib/api/estimates'
import { fetchLoanProfile, fetchPipeline } from '@/lib/api/loans'
import { bulkAudience, EXCLUDE_LABEL, SEGMENT_LABEL, withOptOut, type BulkPerson, type ExcludeReason, type Segment } from './filters'
import { fullName } from '@/lib/pipeline/helpers'
import type { ChangeOutput } from './changeTools'

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** Links aren't allowed in texts (decision 3): Fee Estimates go by email with the PDF. */
export const hasLink = (text: string) => /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|io|co|us|mortgage)\b/i.test(text)

export async function draftMessage(input: Record<string, unknown>): Promise<ChangeOutput> {
  const loan = typeof input.loan_id === 'string' ? await fetchLoanProfile(input.loan_id) : null
  if (!loan) throw new Error('That file was not found, or it is not yours.')
  const people = unwrap<{ contact_id: string; role: string; contact: { first_name: string; last_name: string } | null }[]>(
    await db().from('loan_borrowers').select('contact_id, role, contact:contacts!loan_borrowers_contact_id_fkey ( first_name, last_name )').eq('loan_id', loan.id),
  )
  const wanted = str(input.contact_id)
  const to = (wanted ? people.find((p) => p.contact_id === wanted) : null) ?? people.find((p) => p.role === 'primary') ?? people[0]
  if (!to?.contact) throw new Error('This file has no borrower to write to.')
  const channel = input.channel === 'email' ? 'email' : input.channel === 'text' ? 'text' : null
  if (!channel) throw new Error('Text or email?')
  const body = str(input.body)
  if (!body) throw new Error('What should the message say?')
  const subject = channel === 'email' ? (str(input.subject) ?? 'From your loan officer') : null
  const estimateIds = Array.isArray(input.estimate_ids) ? input.estimate_ids.filter((x): x is string => typeof x === 'string') : []
  if (estimateIds.length && channel !== 'email') throw new Error('Fee Estimates go by email with the PDF attached, never by text. Draft an email (and a short heads-up text with no link, if wanted).')
  if (estimateIds.length > 3) throw new Error('At most 3 Fee Estimates on one email.')
  if (channel === 'text' && hasLink(body)) throw new Error('Texts never carry links. Leave the link out (send documents by email).')
  const headsUp = channel === 'email' ? str(input.heads_up_text) : null
  if (headsUp && hasLink(headsUp)) throw new Error('The heads-up text can\'t have a link.')
  let estimates: { id: string; name: string }[] = []
  if (estimateIds.length) {
    const list = await fetchEstimates(loan.id)
    estimates = estimateIds.map((id) => {
      const e = list.find((x) => x.id === id)
      if (!e) throw new Error('A Fee Estimate to attach is not on this file.')
      return { id: e.id, name: e.name }
    })
  }
  const name = fullName({ firstName: to.contact.first_name, lastName: to.contact.last_name })
  return {
    result: `Draft ready for ${name}. Nothing was sent: it goes only when the loan officer taps Send on the card.`,
    card: { type: 'message', loanId: loan.id, contactId: to.contact_id, name, channel, subject, body, estimates, headsUp },
    pending: true,
  }
}

/** Consent and GHL facts for these people, in chunks the database takes. */
async function bulkPeople(ids: string[]): Promise<Map<string, BulkPerson>> {
  const out = new Map<string, BulkPerson>()
  for (let i = 0; i < ids.length; i += 200) {
    const rows = unwrap<
      { id: string; first_name: string; last_name: string; phone: string | null; email: string | null; sms_consent: boolean | null; email_consent: boolean | null; sms_opted_out_at: string | null; email_opted_out_at: string | null; ghl_contact_id: string | null }[]
    >(await db().from('contacts').select('id, first_name, last_name, phone, email, sms_consent, email_consent, sms_opted_out_at, email_opted_out_at, ghl_contact_id').in('id', ids.slice(i, i + 200)))
    for (const r of rows)
      out.set(r.id, { id: r.id, firstName: r.first_name, lastName: r.last_name, phone: r.phone, email: r.email, smsConsent: r.sms_consent, emailConsent: r.email_consent, smsOptedOutAt: r.sms_opted_out_at, emailOptedOutAt: r.email_opted_out_at, ghlContactId: r.ghl_contact_id })
  }
  return out
}

const SEGMENTS = Object.keys(SEGMENT_LABEL) as Segment[]

/**
 * A message to many of this loan officer's clients at once (decision 4):
 * only their own files, only people with a GHL contact and recorded consent,
 * opt-outs left out, texts with "Reply STOP to opt out". It only builds the
 * preview (who, who's left out and why, the words); Send on the card
 * schedules one approval per person, 20 a minute, within the daily cap.
 */
export async function draftBulkMessage(input: Record<string, unknown>): Promise<ChangeOutput> {
  const segment = SEGMENTS.includes(input.segment as Segment) ? (input.segment as Segment) : null
  if (!segment) throw new Error(`Which group? One of: ${SEGMENTS.join(', ')}.`)
  const year = typeof input.year === 'number' ? input.year : null
  if (segment === 'closed_in_year' && !year) throw new Error('Which year?')
  const channel = input.channel === 'email' ? 'email' : input.channel === 'text' ? 'text' : null
  if (!channel) throw new Error('Text or email?')
  const raw = str(input.body)
  if (!raw) throw new Error('What should the message say?')
  if (channel === 'text' && hasLink(raw)) throw new Error('Texts never carry links.')
  const subject = channel === 'email' ? (str(input.subject) ?? 'A note from your loan officer') : null
  const body = channel === 'text' ? withOptOut(raw) : raw
  const me = (await db().auth.getUser()).data.user?.id
  if (!me) throw new Error('Sign in again.')
  const loans = await fetchPipeline()
  const ids = [...new Set(loans.filter((l) => l.assignedLo?.id === me && l.borrower).map((l) => l.borrower!.id))]
  const { recipients, excluded } = bulkAudience(loans, await bulkPeople(ids), { segment, year, channel, me })
  const label = segment === 'closed_in_year' ? `${SEGMENT_LABEL[segment]} ${year}` : SEGMENT_LABEL[segment]
  const counts = Object.fromEntries((Object.keys(EXCLUDE_LABEL) as ExcludeReason[]).map((r) => [r, excluded.filter((x) => x.reason === r).length]))
  return {
    result: `Bulk ${channel} drafted for ${recipients.length} ${label.toLowerCase()} (${excluded.length} left out: ${Object.entries(counts).filter(([, n]) => n).map(([r, n]) => `${n} ${EXCLUDE_LABEL[r as ExcludeReason]}`).join(', ') || 'none'}). Nothing was sent: it goes only when the loan officer taps Send on the card.`,
    card: { type: 'bulk', channel, segmentLabel: label, subject, body, recipients, excluded },
    pending: true,
  }
}

export const SEND_TOOL_RUNNERS: Record<string, (input: Record<string, unknown>) => Promise<ChangeOutput>> = {
  draft_message: draftMessage,
  draft_bulk_message: draftBulkMessage,
}
