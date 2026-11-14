// Partners (realtors, title, builders, referral partners): the same
// matching rules the database uses (find_or_create_partner in
// 20261210000000_partners.sql), so screens can say "already saved" before
// anything is saved. Email first (lowercased, trimmed), then the 10-digit
// phone, never the name. Pure, no imports.

export type PartnerKind = 'realtor' | 'title' | 'insurance' | 'builder' | 'referral' | 'other'

export const PARTNER_KINDS: readonly { value: PartnerKind; label: string; plural: string }[] = [
  { value: 'realtor', label: 'Realtor', plural: 'Realtors' },
  { value: 'title', label: 'Title / escrow', plural: 'Title' },
  { value: 'insurance', label: 'Insurance agent', plural: 'Insurance' },
  { value: 'builder', label: 'Builder', plural: 'Builders' },
  { value: 'referral', label: 'Referral partner', plural: 'Referral partners' },
  { value: 'other', label: 'Other', plural: 'Other' },
]

export const partnerKindLabel = (kind: PartnerKind) => PARTNER_KINDS.find((k) => k.value === kind)?.label ?? kind

/** Lowercased and trimmed; null when empty. Two partners can't share one. */
export function emailKey(email: string | null | undefined): string | null {
  const t = (email ?? '').trim().toLowerCase()
  return t || null
}

/** Ten digits without a leading US 1; null when it isn't a 10-digit number. */
export function phone10(phone: string | null | undefined): string | null {
  let d = (phone ?? '').replace(/\D/g, '')
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1)
  return d.length === 10 ? d : null
}

export const looksLikeEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

/** Team roles that are partners. Processors are company users, and lender AEs belong to the Lenders page. */
export function partnerKindForRole(role: string): PartnerKind | null {
  if (role === 'buyer_agent' || role === 'listing_agent') return 'realtor'
  if (role === 'title' || role === 'escrow_officer') return 'title'
  if (role === 'insurance_agent') return 'insurance'
  return null
}

export interface MatchablePartner {
  id: string
  email: string | null
  phone: string | null
}

export type PartnerMatch<P extends MatchablePartner> =
  | { by: 'email' | 'phone'; partner: P }
  /** Several partners share the phone and there's no email to tell them apart. */
  | { by: 'shared_phone'; partners: P[] }
  /** No one has this email or phone: a new partner. */
  | { by: 'none' }
  /** No email or phone to match by. */
  | { by: 'nothing' }

/**
 * Who this email and phone belong to. A phone only matches when one side has
 * no email, so two coworkers on an office line stay two partners.
 * `exceptId` leaves out the partner being edited.
 */
export function matchPartner<P extends MatchablePartner>(who: { email: string | null; phone: string | null }, partners: readonly P[], exceptId?: string): PartnerMatch<P> {
  const email = emailKey(who.email)
  const phone = phone10(who.phone)
  if (!email && !phone) return { by: 'nothing' }
  const others = exceptId ? partners.filter((p) => p.id !== exceptId) : partners
  if (email) {
    const byEmail = others.find((p) => emailKey(p.email) === email)
    if (byEmail) return { by: 'email', partner: byEmail }
  }
  if (phone) {
    const byPhone = others.filter((p) => phone10(p.phone) === phone && (!email || !emailKey(p.email)))
    if (byPhone.length === 1) return { by: 'phone', partner: byPhone[0] }
    if (byPhone.length > 1) return { by: 'shared_phone', partners: byPhone }
  }
  return { by: 'none' }
}

/** Search by name, company, email or phone digits. */
export function searchPartners<P extends { name: string; company: string | null; email: string | null; phone: string | null }>(partners: readonly P[], query: string): P[] {
  const words = query.toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...partners]
  return partners.filter((p) => {
    const text = `${p.name} ${p.company ?? ''} ${p.email ?? ''}`.toLowerCase()
    const digits = (p.phone ?? '').replace(/\D/g, '')
    // A word of only digits and phone punctuation, like "555-0101", searches the phone.
    const phonePart = (w: string) => /^[\d().+-]+$/.test(w) && w.replace(/\D/g, '').length >= 3
    return words.every((w) => text.includes(w) || (phonePart(w) && digits.includes(w.replace(/\D/g, ''))))
  })
}

export interface PartnerFile {
  loanId: string
  role: string
  stage: string
  borrowerName: string
  closingDate: string | null
}

/** A partner's files: open ones (soonest closing first), then closed and lost ones (latest first). */
export function splitFiles<F extends PartnerFile>(files: readonly F[]): { open: F[]; closed: F[] } {
  const done = (f: F) => f.stage === 'closed' || f.stage === 'lost'
  const byDate = (a: F, b: F) => (a.closingDate ?? '9999').localeCompare(b.closingDate ?? '9999') || a.borrowerName.localeCompare(b.borrowerName)
  return {
    open: files.filter((f) => !done(f)).sort(byDate),
    closed: files.filter(done).sort((a, b) => byDate(b, a)),
  }
}
