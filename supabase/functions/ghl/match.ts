// Matching a GHL contact to a LOSuite person (Connor, 2026-10-29). Pure and
// import-free, like lead-intake's normalize.ts, so it's tested here and
// pasted with index.ts.
//
// Order: the GHL contact id already stored on a person, then email
// (lowercased, trimmed), then the 10-digit phone against contacts.phone_digits.
// Never by name. Anything ambiguous goes to "Needs matching" for an admin:
// two people share the email, two people share the phone (a household), or
// the email and the phone point to different people, or the person found is
// already linked to a different GHL contact (a duplicate in GHL). No match at
// all goes there too.

export interface GhlContactKeys {
  id: string
  email: string | null
  phone: string | null
}

/** A LOSuite person as the matcher sees them. */
export interface Candidate {
  id: string
  ghlContactId: string | null
  email: string | null
  /** contacts.phone_digits: every digit of the phone as typed. */
  phoneDigits: string | null
}

export type MatchedBy = 'ghl_id' | 'email' | 'phone'

export type MatchReason = 'shared_email' | 'shared_phone' | 'email_phone_differ' | 'linked_to_other_ghl' | 'no_match'

export type MatchResult =
  | { kind: 'matched'; contactId: string; by: MatchedBy }
  | { kind: 'needs_matching'; reason: MatchReason; candidateIds: string[] }

export const MATCH_REASON_LABELS: Record<MatchReason, string> = {
  shared_email: 'More than one person has this email',
  shared_phone: 'More than one person has this phone (shared number)',
  email_phone_differ: 'The email and the phone belong to different people',
  linked_to_other_ghl: 'This person is already linked to a different GHL contact',
  no_match: 'Nobody in LOSuite has this email or phone',
}

export function normalizeEmail(email: string | null | undefined): string | null {
  const e = (email ?? '').trim().toLowerCase()
  return e.includes('@') ? e : null
}

/** The last 10 digits of a US phone ("+1 (214) 555-0111" → "2145550111"); null if fewer than 10. */
export function phone10(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '')
  return digits.length >= 10 ? digits.slice(-10) : null
}

const unique = (ids: string[]) => [...new Set(ids)]

export function matchContact(ghl: GhlContactKeys, candidates: Candidate[]): MatchResult {
  const byId = unique(candidates.filter((c) => c.ghlContactId && c.ghlContactId === ghl.id).map((c) => c.id))
  // One company can't store the same GHL id twice (unique index), so this is the link.
  if (byId.length === 1) return { kind: 'matched', contactId: byId[0], by: 'ghl_id' }

  const email = normalizeEmail(ghl.email)
  const phone = phone10(ghl.phone)
  const byEmail = email ? unique(candidates.filter((c) => normalizeEmail(c.email) === email).map((c) => c.id)) : []
  const byPhone = phone ? unique(candidates.filter((c) => phone10(c.phoneDigits) === phone).map((c) => c.id)) : []

  // Found by email or phone, but already linked to another GHL contact: GHL has a duplicate.
  const found = (contactId: string, by: MatchedBy): MatchResult => {
    const linked = candidates.find((c) => c.id === contactId)?.ghlContactId
    return linked && linked !== ghl.id ? { kind: 'needs_matching', reason: 'linked_to_other_ghl', candidateIds: [contactId] } : { kind: 'matched', contactId, by }
  }

  if (byEmail.length > 1) return { kind: 'needs_matching', reason: 'shared_email', candidateIds: byEmail }
  if (byEmail.length === 1) {
    // A household phone that includes this person is fine; a phone that only points elsewhere is not.
    if (byPhone.length > 0 && !byPhone.includes(byEmail[0])) {
      return { kind: 'needs_matching', reason: 'email_phone_differ', candidateIds: unique([...byEmail, ...byPhone]) }
    }
    return found(byEmail[0], 'email')
  }
  if (byPhone.length > 1) return { kind: 'needs_matching', reason: 'shared_phone', candidateIds: byPhone }
  if (byPhone.length === 1) {
    // GHL has an email nobody in LOSuite has, and the phone's owner has a different one on file: maybe someone else on that phone.
    const onFile = normalizeEmail(candidates.find((c) => c.id === byPhone[0])?.email)
    if (email && onFile && onFile !== email) return { kind: 'needs_matching', reason: 'email_phone_differ', candidateIds: byPhone }
    return found(byPhone[0], 'phone')
  }
  return { kind: 'needs_matching', reason: 'no_match', candidateIds: [] }
}
