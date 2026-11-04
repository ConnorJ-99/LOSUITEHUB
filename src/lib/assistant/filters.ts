// Pure helpers behind the assistant's read tools: finding a person by name,
// phone or email, and filtering files. Tested in filters.test.ts.

import type { ContactSummary, PipelineLoan } from '@/lib/api/types'

const digits = (s: string | null | undefined) => (s ?? '').replace(/\D/g, '')

/** People whose name, email or phone matches what was said; the closest first. Never by a single letter. */
export function borrowerMatches(people: ContactSummary[], query: string): ContactSummary[] {
  const q = query.trim().toLowerCase()
  if (q.length < 2) return []
  const qd = digits(q)
  const words = q.split(/\s+/).filter(Boolean)
  const scored = people.flatMap((p) => {
    const full = `${p.firstName} ${p.lastName}`.toLowerCase()
    const email = (p.email ?? '').toLowerCase()
    let score = 0
    if (full === q) score = 100
    else if (email && email === q) score = 95
    else if (qd.length >= 7 && digits(p.phone).endsWith(qd.slice(-10))) score = 90
    else if (words.every((w) => full.includes(w))) score = 60 + (full.startsWith(words[0]) ? 10 : 0)
    else if (email.includes(q)) score = 40
    return score ? [{ p, score }] : []
  })
  return scored.sort((a, b) => b.score - a.score).map((s) => s.p)
}

export interface ListFilters {
  stages?: string[]
  purposes?: string[]
  closingFrom?: string
  closingTo?: string
  noContactDays?: number
  lender?: string
  limit?: number
}

export interface ListRow {
  loan: PipelineLoan
  lastContact: string | null
}

/** Files that pass every filter given, newest activity first, and how many there are in all. */
export function filterBorrowers(
  loans: PipelineLoan[],
  f: ListFilters,
  extra: { lastContact: Map<string, string>; lenders: Map<string, string | null>; now: Date },
): { rows: ListRow[]; total: number } {
  const cutoff = f.noContactDays ? new Date(extra.now.getTime() - f.noContactDays * 86400e3).toISOString() : null
  const lender = f.lender?.trim().toLowerCase()
  const all = loans.flatMap((loan) => {
    if (f.stages?.length && !f.stages.includes(loan.stage)) return []
    if (f.purposes?.length && !f.purposes.includes(loan.purpose)) return []
    if (f.closingFrom && (!loan.closingDate || loan.closingDate < f.closingFrom)) return []
    if (f.closingTo && (!loan.closingDate || loan.closingDate > f.closingTo)) return []
    if (lender && !(extra.lenders.get(loan.id) ?? '').toLowerCase().includes(lender)) return []
    const last = loan.borrower ? (extra.lastContact.get(loan.borrower.id) ?? null) : null
    if (cutoff && last && last >= cutoff) return []
    return [{ loan, lastContact: last }]
  })
  const limit = Math.min(Math.max(f.limit ?? 50, 1), 200)
  return { rows: all.slice(0, limit), total: all.length }
}
