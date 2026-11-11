// Custom document requests (UI pass Part 3; plan
// docs/plans/document-requests.md). Pure: which checklist rows a request
// adds or reuses, the draft text and email with the upload link, overdue
// reminders and when a condition's items are all accepted. The rows are the
// Documents tab checklist (document_requests); nothing here sends.

import type { DocumentKind } from '@/lib/api/documents'
import { stillNeeded, type ItemStatus } from '../../../supabase/functions/document-upload/rules'

export type CatalogCategory = 'income' | 'assets' | 'credit' | 'property' | 'other'

export const CATEGORY_LABEL: Record<CatalogCategory, string> = {
  income: 'Income',
  assets: 'Assets',
  credit: 'Credit & identity',
  property: 'Property',
  other: 'Other',
}

export interface CatalogItem {
  id: string
  key: string
  category: CatalogCategory
  label: string
  instructions: string
  period: string | null
  kind: DocumentKind
  sortOrder: number
  active: boolean
  builtIn: boolean
}

/** One item in the builder: from the catalog (key) or typed. */
export interface PickedItem {
  /** The catalog / checklist key; null for a typed item. */
  key: string | null
  label: string
  instructions: string
  kind: DocumentKind
  conditionId: string | null
}

export interface ExistingItem {
  id: string
  contactId: string | null
  ruleKey: string
  status: ItemStatus
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || 'item'

/** The checklist key for a picked item: the catalog key, or custom_<words> for a typed one. */
export const ruleKeyOf = (p: Pick<PickedItem, 'key' | 'label'>) => p.key ?? `custom_${slug(p.label)}`

export interface RequestPlan {
  /** New checklist rows. */
  add: (PickedItem & { ruleKey: string })[]
  /** Rows already on the file that go out again on this link (asked again, or a rejected one). */
  reuse: { id: string; item: PickedItem & { ruleKey: string } }[]
  /** Already in or accepted: not asked again. */
  skip: { label: string; why: string }[]
}

/**
 * What a request does to the file's checklist for one borrower. The same
 * document for the same person is one row: a row still waiting, rejected or
 * waived goes out again on the new link; one already received or accepted
 * isn't asked again.
 */
export function planRequest(existing: ExistingItem[], picked: PickedItem[], contactId: string): RequestPlan {
  const plan: RequestPlan = { add: [], reuse: [], skip: [] }
  const seen = new Set<string>()
  for (const p of picked) {
    const ruleKey = ruleKeyOf(p)
    if (seen.has(ruleKey)) continue
    seen.add(ruleKey)
    const row = existing.find((e) => e.ruleKey === ruleKey && e.contactId === contactId)
    if (!row) plan.add.push({ ...p, ruleKey })
    else if (row.status === 'received' || row.status === 'reviewed') plan.skip.push({ label: p.label, why: row.status === 'reviewed' ? 'already accepted' : 'already received, waiting for your review' })
    else plan.reuse.push({ id: row.id, item: { ...p, ruleKey } })
  }
  return plan
}

export const uploadUrl = (origin: string, token: string) => `${origin.replace(/\/$/, '')}/u/${token}`

/** A new link token: 64 random hex characters (only its hash is saved). */
export function newToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

const shortDate = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** The draft text and email with the link. Links in texts are allowed for upload links (Connor, 2026-11-11). */
export function uploadMessages(v: { firstName: string; loName: string; url: string; items: { label: string; instructions: string }[]; dueOn: string | null; reminder?: boolean }) {
  const me = v.loName.split(/\s+/)[0] || v.loName
  const due = v.dueOn ? ` by ${shortDate(v.dueOn)}` : ''
  const lead = v.reminder ? `Hi ${v.firstName}, a quick reminder: I still need a few documents${due}.` : `Hi ${v.firstName}, here's a secure link to upload the documents I need${due}.`
  const text = `${lead} ${v.url} You'll confirm your email to open it. Photos or PDFs are fine. - ${me}`
  const subject = v.reminder ? 'Reminder: documents for your loan' : 'Documents for your loan'
  const email = [
    `Hi ${v.firstName},`,
    '',
    v.reminder ? `A quick reminder: I still need the documents below${due}.` : `Here's a secure link to upload the documents I need${due}:`,
    v.url,
    '',
    ...v.items.map((i) => `• ${i.label}${i.instructions ? `: ${i.instructions}` : ''}`),
    '',
    "You'll confirm your email to open the page. Photos from your phone or PDFs are fine, up to 10 MB each.",
    '',
    'Thanks,',
    v.loName,
  ].join('\n')
  return { text, subject, email }
}

export interface LinkForReminder {
  id: string
  dueOn: string | null
  expiresAt: string
  revokedAt: string | null
}

const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000)

/**
 * Overdue links that get a reminder draft today: past the due date, still
 * open, with something still needed. One every 3 days at most: the key
 * changes only every third day past due, so a draft already made (or
 * dismissed) isn't made again in between.
 */
export function remindersDue(links: LinkForReminder[], items: { linkId: string | null; status: ItemStatus }[], today: string): { linkId: string; sourceKey: string }[] {
  return links.flatMap((l) => {
    if (!l.dueOn || l.revokedAt || Date.parse(l.expiresAt) <= Date.parse(`${today}T12:00:00Z`)) return []
    const late = dayNumber(today) - dayNumber(l.dueOn)
    if (late < 1) return []
    if (!items.some((i) => i.linkId === l.id && stillNeeded(i.status))) return []
    return [{ linkId: l.id, sourceKey: `upload-reminder:${l.id}:${Math.floor((late - 1) / 3)}` }]
  })
}

/** Every item linked to the condition is accepted (and there's at least one): time to ask about clearing it. */
export function conditionReady(items: { conditionId: string | null; status: ItemStatus }[], conditionId: string): boolean {
  const linked = items.filter((i) => i.conditionId === conditionId && i.status !== 'waived')
  return linked.length > 0 && linked.every((i) => i.status === 'reviewed')
}
