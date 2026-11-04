// Pure helpers behind the assistant's read tools: finding a person by name,
// phone or email, and filtering files. Tested in filters.test.ts.

import type { ProgramListItem } from '@/lib/api/estimates'
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

export interface ProgramPick {
  id: string
  name: string
  family: ProgramListItem['family']
  lenderId: string
  lenderName: string
}

/**
 * The catalog program a person means: by id, or by words like "UWM
 * conventional 30" (every word must be in the lender or program name). One
 * clear match, or an error naming the choices so the assistant can ask.
 */
export function matchProgram(catalog: ProgramListItem[], id: string | null, words: string | null): { program: ProgramPick } | { error: string } {
  const pick = (p: ProgramListItem): ProgramPick => ({ id: p.id, name: p.name, family: p.family, lenderId: p.lenderId, lenderName: p.lenderName })
  if (id) {
    const p = catalog.find((x) => x.id === id)
    return p ? { program: pick(p) } : { error: 'That program is not in the catalog.' }
  }
  const q = (words ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 1)
  if (!q.length) return { error: 'Which lender and program?' }
  const hay = (p: ProgramListItem) => `${p.lenderName} ${p.name} ${p.family}`.toLowerCase().replace(/_/g, ' ')
  const found = catalog.filter((p) => q.every((w) => hay(p).includes(w)))
  if (found.length === 1) return { program: pick(found[0]) }
  // "Pennymac conventional": the program literally named "Conventional" beats HomeReady and the rest.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 1)
  const exact = found.filter((p) => {
    const lender = new Set(norm(p.lenderName))
    const said = q.filter((w) => !lender.has(w)).join(' ')
    return said.length > 0 && norm(p.name).join(' ') === said
  })
  if (exact.length === 1) return { program: pick(exact[0]) }
  if (!found.length) {
    const near = catalog.filter((p) => q.some((w) => hay(p).includes(w))).slice(0, 6)
    return { error: `No program matches "${words}".${near.length ? ` Close ones: ${near.map((p) => `${p.lenderName} ${p.name}`).join('; ')}.` : ''}` }
  }
  return { error: `More than one program matches "${words}": ${found.slice(0, 8).map((p) => `${p.lenderName} ${p.name}`).join('; ')}. Which one?` }
}
