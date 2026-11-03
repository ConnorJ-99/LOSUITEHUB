// The email (and optional heads-up text) that goes with an estimate or a
// pre-approval letter sent from LOSuite (plan step B, Connor 2026-10-30).
// Built in code, no AI; the loan officer can edit both before sending.

export const SENDABLE_KINDS = ['fee_worksheet', 'loan_comparison', 'preapproval_letter'] as const
export type SendableKind = (typeof SENDABLE_KINDS)[number]

export const isSendableKind = (kind: string): kind is SendableKind => (SENDABLE_KINDS as readonly string[]).includes(kind)

const WHAT: Record<SendableKind, { noun: string; subject: string }> = {
  fee_worksheet: { noun: 'Fee Worksheet', subject: 'Your Fee Worksheet' },
  loan_comparison: { noun: 'loan options comparison', subject: 'Your loan options' },
  preapproval_letter: { noun: 'pre-approval letter', subject: 'Your pre-approval letter' },
}

export interface DocumentMessage {
  subject: string
  body: string
  /** The optional heads-up text: never the document or a link, just that it was emailed. */
  text: string
}

export function documentMessage(kind: SendableKind, firstName: string | null, loName: string | null, companyName = 'MPS Mortgage'): DocumentMessage {
  const w = WHAT[kind]
  const hi = firstName?.trim() ? `Hi ${firstName.trim()},` : 'Hi,'
  const sign = [loName?.trim(), companyName].filter(Boolean).join('\n')
  const lines: Record<SendableKind, string> = {
    fee_worksheet: `Attached is your Fee Worksheet with the estimated costs and payment we talked about. It's an estimate, not your official Loan Estimate, which comes separately.`,
    loan_comparison: 'Attached are the loan options we talked about, side by side.',
    preapproval_letter: 'Attached is your pre-approval letter. When you find a home and make an offer, send me the address and I can update the letter to match.',
  }
  return {
    subject: `${w.subject} — ${companyName}`,
    body: `${hi}\n\n${lines[kind]} Let me know if you have any questions.\n\n${sign}`,
    text: `${hi} I just emailed your ${w.noun}. Let me know if you have any questions!`,
  }
}
