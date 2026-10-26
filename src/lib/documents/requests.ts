// The document checklist on a file: which uploads satisfy which requests,
// how many are in, and what's not tracked yet. Pure functions.

import type { DocumentRequest } from '@/lib/api/documentRules'
import type { DocumentKind, LoanDocument } from '@/lib/api/documents'
import type { DocGroup } from '@/lib/prequal/nextStep'

/**
 * An uploaded document that looks like it satisfies a request: the same
 * type, for the same person (any person for file-wide items), not already
 * used for another request. The newest one wins.
 */
export function matchingDocument(request: DocumentRequest, docs: LoanDocument[], requests: DocumentRequest[]): LoanDocument | null {
  const used = new Set(requests.filter((r) => r.id !== request.id && r.documentId).map((r) => r.documentId))
  return (
    docs
      .filter((d) => d.kind === request.kind && request.kind !== 'other' && !used.has(d.id) && (request.contactId === null || d.contactId === request.contactId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
  )
}

/** "3 of 7 in": received or reviewed, out of everything not waived. */
export function requestProgress(requests: DocumentRequest[]): { done: number; total: number; reviewed: number } {
  const counted = requests.filter((r) => r.status !== 'waived')
  return {
    done: counted.filter((r) => r.status === 'received' || r.status === 'reviewed').length,
    reviewed: counted.filter((r) => r.status === 'reviewed').length,
    total: counted.length,
  }
}

export interface UntrackedItem {
  contactId: string | null
  who: string
  key: string
  label: string
  kind: DocumentKind
}

/** Checklist items for this file that aren't being tracked yet. */
export function untrackedItems(checklist: DocGroup[], requests: DocumentRequest[]): UntrackedItem[] {
  const have = new Set(requests.map((r) => `${r.contactId ?? ''}:${r.ruleKey}`))
  return checklist.flatMap((g) =>
    g.items.filter((i) => !have.has(`${g.contactId ?? ''}:${i.key}`)).map((i) => ({ contactId: g.contactId, who: g.title, key: i.key, label: i.full, kind: i.kind })),
  )
}
