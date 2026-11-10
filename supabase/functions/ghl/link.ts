// "Add to GoHighLevel" (build plan Phase 3): the checks before LOSuite links a
// borrower or partner to a GHL contact. Pure, with no imports, so the Edge
// Function (Deno) and its tests share it.
//
// Matching is GHL's own duplicate search by phone, then email; never by name.
// Anything that could link the wrong person stops for an admin instead:
//   - the phone finds one GHL contact and the email another (different people);
//   - someone else in LOSuite has the same email or phone (a shared email or line);
//   - the GHL contact is already linked to someone else in LOSuite.

export const NEEDS_MATCHING = 'Needs matching by an admin:'

/** GHL's phone and email matches, as one contact or the reason it can't be linked. */
export function pickGhlMatch(byPhone: string | null, byEmail: string | null): { id: string | null } | { problem: string } {
  if (byPhone && byEmail && byPhone !== byEmail) return { problem: `${NEEDS_MATCHING} the phone and the email belong to two different GHL contacts.` }
  return { id: byPhone ?? byEmail }
}

const emailKey = (e: string | null | undefined) => e?.trim().toLowerCase() || null
/** 10 digits, without a leading US 1. */
export const phone10 = (p: string | null | undefined) => {
  const d = (p ?? '').replace(/\D/g, '')
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d
  return ten.length === 10 ? ten : null
}

/** Why this person's email or phone is shared with someone else in LOSuite, or null. */
export function sharedDetails(self: { email: string | null; phone: string | null }, others: { email: string | null; phone: string | null }[]): string | null {
  const e = emailKey(self.email)
  const p = phone10(self.phone)
  if (e && others.some((o) => emailKey(o.email) === e)) return `${NEEDS_MATCHING} someone else in LOSuite has the same email.`
  if (p && others.some((o) => phone10(o.phone) === p)) return `${NEEDS_MATCHING} someone else in LOSuite has the same phone.`
  return null
}

/** A partner's one name field as GHL's first and last name ("Mary Ann Smith" → "Mary Ann" / "Smith"). */
export function splitName(name: string): { first: string; last: string | null } {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length <= 1) return { first: parts[0] ?? name.trim(), last: null }
  return { first: parts.slice(0, -1).join(' '), last: parts.at(-1)! }
}
