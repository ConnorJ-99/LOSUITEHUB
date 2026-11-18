// Merge tags in the message box (LO Assistant step 3, Connor 2026-11-17).
// A message is written with tags like {{lo.application_link}}; they are filled
// in when it's sent, RELATIVE TO THE FILE: "lo" is always the file's loan
// officer (even when their assistant sends), "sender" is whoever presses Send,
// "file" is this file. A tag that can't be filled blocks Send ("Missing: LO
// booking link"); nothing is ever sent with a raw {{tag}} in it.

export type TagKey =
  | 'borrower.first_name'
  | 'sender.first_name'
  | 'sender.title'
  | 'lo.first_name'
  | 'lo.full_name'
  | 'lo.nmls'
  | 'lo.application_link'
  | 'lo.booking_link'
  | 'lo.bio_link'
  | 'file.document_upload_link'

export interface TagInfo {
  key: TagKey
  /** On the chip in the editor. */
  label: string
  /** In "Missing: …". */
  missing: string
  link?: boolean
}

export const TAGS: TagInfo[] = [
  { key: 'borrower.first_name', label: 'Borrower first name', missing: 'borrower first name' },
  { key: 'sender.first_name', label: 'My first name', missing: 'your first name' },
  { key: 'sender.title', label: 'My title', missing: 'your title (Settings → My profile)' },
  { key: 'lo.first_name', label: 'LO first name', missing: 'LO first name' },
  { key: 'lo.full_name', label: 'LO full name', missing: 'LO full name' },
  { key: 'lo.nmls', label: 'LO · NMLS #', missing: 'LO NMLS #' },
  { key: 'lo.application_link', label: 'LO · Application link', missing: 'LO application link', link: true },
  { key: 'lo.booking_link', label: 'LO · Booking link', missing: 'LO booking link', link: true },
  { key: 'lo.bio_link', label: 'LO · Bio / NMLS link', missing: 'LO bio link', link: true },
  { key: 'file.document_upload_link', label: 'Document upload (this file)', missing: 'document upload link (make the borrower portal link on the Overview)', link: true },
]

export const tagInfo = (key: string): TagInfo | undefined => TAGS.find((t) => t.key === key)

/** The insert-link bar's buttons, in order; the rest are under "More fields…". */
export const LINK_BAR: { key: TagKey; label: string }[] = [
  { key: 'lo.application_link', label: 'LO application' },
  { key: 'lo.booking_link', label: 'LO booking' },
  { key: 'file.document_upload_link', label: 'Document upload (this file)' },
  { key: 'lo.bio_link', label: 'LO bio / NMLS' },
]

export const tagText = (key: TagKey) => `{{${key}}}`

const TAG_RE = /\{\{\s*([a-z_]+\.[a-z_]+)\s*\}\}/g

/** The tags used in a message, each once, in order. Unknown {{words}} are listed too (as missing). */
export function tagsIn(body: string): string[] {
  const seen: string[] = []
  for (const m of body.matchAll(TAG_RE)) if (!seen.includes(m[1])) seen.push(m[1])
  return seen
}

export type TagValues = Partial<Record<TagKey, string | null | undefined>>

/**
 * Fills every tag. `missing` lists what couldn't be filled ("LO booking link"),
 * in which case the message must not be sent.
 */
export function resolveTags(body: string, values: TagValues): { text: string; missing: string[] } {
  const missing: string[] = []
  const text = body.replace(TAG_RE, (raw, key: string) => {
    const info = tagInfo(key)
    const v = info ? values[info.key]?.trim() : null
    if (v) return v
    const why = info?.missing ?? `unknown field ${raw}`
    if (!missing.includes(why)) missing.push(why)
    return raw
  })
  return { text, missing }
}

const first = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || null

export interface TagPerson {
  displayName?: string | null
  fullName?: string | null
  title?: string | null
  nmls?: string | null
  applicationLink?: string | null
  bookingUrl?: string | null
  bioUrl?: string | null
}

/** The values for one message: the borrower, the person sending, the file's loan officer and the file's portal link. */
export function tagValues(o: { borrowerFirst: string | null; sender: TagPerson | null; lo: TagPerson | null; documentUploadLink: string | null }): TagValues {
  return {
    'borrower.first_name': first(o.borrowerFirst),
    'sender.first_name': first(o.sender?.displayName) ?? first(o.sender?.fullName),
    'sender.title': o.sender?.title ?? null,
    'lo.first_name': first(o.lo?.displayName) ?? first(o.lo?.fullName),
    'lo.full_name': o.lo?.fullName?.trim() || null,
    'lo.nmls': o.lo?.nmls?.trim() || null,
    'lo.application_link': o.lo?.applicationLink ?? null,
    'lo.booking_link': o.lo?.bookingUrl ?? null,
    'lo.bio_link': o.lo?.bioUrl ?? null,
    'file.document_upload_link': o.documentUploadLink,
  }
}

/** Splits a message into text and tag pieces, for drawing chips. */
export function tagPieces(body: string): ({ text: string } | { tag: string })[] {
  const out: ({ text: string } | { tag: string })[] = []
  let at = 0
  for (const m of body.matchAll(TAG_RE)) {
    if (m.index! > at) out.push({ text: body.slice(at, m.index) })
    out.push({ tag: m[1] })
    at = m.index! + m[0].length
  }
  if (at < body.length) out.push({ text: body.slice(at) })
  return out
}
