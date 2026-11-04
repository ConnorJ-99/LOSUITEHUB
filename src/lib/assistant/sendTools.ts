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
import { fetchLoanProfile } from '@/lib/api/loans'
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

export const SEND_TOOL_RUNNERS: Record<string, (input: Record<string, unknown>) => Promise<ChangeOutput>> = {
  draft_message: draftMessage,
}
