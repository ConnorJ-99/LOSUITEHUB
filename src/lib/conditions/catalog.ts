// Docs & Conditions is conditions only (Connor, 2026-11-17). Conditions are
// added by ticking items from the document catalog (Settings → Document
// catalog), and ticked conditions become the items on an upload link. Pure:
// the keys, the wording, and what a link asks for.

import type { DocumentKind } from '@/lib/api/documents'
import type { CatalogItem, PickedItem } from '@/lib/documents/uploadRequests'

type RequestStatus = 'requested' | 'received' | 'reviewed' | 'rejected' | 'waived'

/** A condition added from the catalog remembers the item and the person: cat_<key>:<contact or "file">. */
export const catalogConditionKey = (key: string, contactId: string | null) => `cat_${key}:${contactId ?? 'file'}`

export const isCatalogKey = (sourceKey: string) => sourceKey.startsWith('cat_')

export function parseCatalogKey(sourceKey: string | null | undefined): { key: string; contactId: string | null } | null {
  if (!sourceKey || !isCatalogKey(sourceKey)) return null
  const rest = sourceKey.slice(4)
  const at = rest.lastIndexOf(':')
  if (at <= 0) return null
  const who = rest.slice(at + 1)
  return { key: rest.slice(0, at), contactId: who === 'file' ? null : who }
}

/** The condition's words: the item, plus the first name when the file has more than one borrower (as the database does). */
export const catalogConditionBody = (label: string, firstName: string | null) => (firstName?.trim() ? `${label.trim()} (${firstName.trim()})` : label.trim())

export interface LinkCondition {
  id: string
  body: string
  notes: string | null
  sourceKey?: string | null
  documentRequestId?: string | null
}

export interface LinkRequest {
  id: string
  conditionId?: string | null
  contactId: string | null
  ruleKey: string
  label: string
  instructions?: string | null
  kind: DocumentKind
  status: RequestStatus
}

/** The document requests under a condition: tied to it, or the one a suggestion linked. */
export const requestsUnder = <R extends Pick<LinkRequest, 'id' | 'conditionId'>>(c: Pick<LinkCondition, 'id' | 'documentRequestId'>, requests: R[]): R[] =>
  requests.filter((r) => r.conditionId === c.id || (!r.conditionId && r.id === c.documentRequestId))

const plain = (s: string) => s.toLowerCase().replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+/g, ' ').trim()

/**
 * What an upload link for these conditions asks for, each item tied to its
 * condition: the documents already asked for under it (asked again on the new
 * link), else its catalog item (by key, or when the words are a catalog
 * item's), else the condition's own words. Also the borrower it's most likely
 * for (the first person named), so the window can start on them.
 */
export function linkItemsFor(conditions: LinkCondition[], requests: LinkRequest[], catalog: CatalogItem[]): { items: PickedItem[]; contactId: string | null } {
  const items: PickedItem[] = []
  let contactId: string | null = null
  const byKey = (key: string) => catalog.find((c) => c.key === key && c.active)
  const fromCatalog = (c: CatalogItem, conditionId: string): PickedItem => ({ key: c.key, label: c.label, instructions: c.instructions, kind: c.kind, conditionId })
  for (const c of conditions) {
    const under = requestsUnder(c, requests)
    if (under.length) {
      for (const r of under) {
        const cat = byKey(r.ruleKey)
        items.push({ key: r.ruleKey.startsWith('custom_') ? null : r.ruleKey, label: r.label, instructions: r.instructions ?? cat?.instructions ?? '', kind: r.kind, conditionId: c.id })
        contactId ??= r.contactId
      }
      continue
    }
    const parsed = parseCatalogKey(c.sourceKey)
    const cat = (parsed && byKey(parsed.key)) || catalog.find((x) => x.active && plain(x.label) === plain(c.body))
    if (parsed) contactId ??= parsed.contactId
    items.push(cat ? fromCatalog(cat, c.id) : { key: null, label: c.body.trim(), instructions: c.notes?.trim() ?? '', kind: 'other', conditionId: c.id })
  }
  return { items, contactId }
}
