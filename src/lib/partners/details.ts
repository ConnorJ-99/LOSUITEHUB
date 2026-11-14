// Insurance agents and title partners (Connor, 2026-11-13): the extra fields,
// the "Email via Gmail" default and the company email domain. Mirrors
// 20270125000000_loan_numbers_partners_clauses.sql. Pure, no imports.

export const INSURANCE_LINES = [
  { value: 'home', label: 'Home' },
  { value: 'auto', label: 'Auto' },
  { value: 'flood', label: 'Flood' },
  { value: 'umbrella', label: 'Umbrella' },
] as const
export type InsuranceLine = (typeof INSURANCE_LINES)[number]['value']

/** Public mailboxes: never used to match a company by its email domain. */
export const PUBLIC_EMAIL_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'ymail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'protonmail.com', 'att.net', 'sbcglobal.net', 'comcast.net'])

/** The company domain of an email ("lonestartitle.com"); null for a public mailbox or no email. */
export function emailDomain(email: string | null | undefined): string | null {
  const d = (email ?? '').trim().toLowerCase().split('@')[1] ?? ''
  return d && !PUBLIC_EMAIL_DOMAINS.has(d) ? d : null
}

/** Title and insurance email through Gmail unless turned off; everyone else through GoHighLevel. */
export const defaultViaGmail = (kind: string) => kind === 'title' || kind === 'insurance'

/** "a@x.com, b@x.com; c@x.com" → three lowercased emails (blank and repeats dropped). */
export function splitEmails(text: string): string[] {
  const out: string[] = []
  for (const e of text.split(/[,;\s]+/)) {
    const t = e.trim().toLowerCase()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

export interface PartnerDetails {
  role: string | null
  extraEmails: string[]
  officeAddress: string | null
  preferred: boolean
  emailViaGmail: boolean
  emailDomain: string | null
  agency: string | null
  carriers: string[]
  licenseNumber: string | null
  insuranceLines: InsuranceLine[]
  escrowOfficerName: string | null
  escrowOfficerEmail: string | null
  processorName: string | null
  processorEmail: string | null
  titleUnderwriter: string | null
  wireVerifyPhone: string | null
  lastWireInstructionsDocId: string | null
}
