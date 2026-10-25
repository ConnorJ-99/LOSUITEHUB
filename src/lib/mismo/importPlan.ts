import type { ApplicationBorrower, PersonDetails } from '@/lib/api/urla'
import { phoneDigits } from '@/lib/pipeline/helpers'
import type { ImportedBorrower } from './parse'

// Pure decisions for applying a MISMO import: who maps to whom, which
// properties are the same, and which person fields to write.

export type BorrowerTarget = { kind: 'update'; contactId: string } | { kind: 'new' } | { kind: 'skip' }

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase()
const sameName = (a: PersonDetails, b: PersonDetails) => !!norm(a.firstName) && norm(a.firstName) === norm(b.firstName) && norm(a.lastName) === norm(b.lastName)
const sameEmail = (a: PersonDetails, b: PersonDetails) => !!norm(a.email) && norm(a.email) === norm(b.email)
const samePhone = (a: PersonDetails, b: PersonDetails) => {
  const x = phoneDigits(a.phone) ?? phoneDigits(a.homePhone)
  return !!x && (x === phoneDigits(b.phone) || x === phoneDigits(b.homePhone))
}

/**
 * Default target for each borrower in the file: an existing borrower with the
 * same email, phone or name first; otherwise the file's primary updates the
 * loan's primary and co-borrowers fill existing co-borrowers in order; anyone
 * left over is added as a new co-borrower.
 */
export function defaultTargets(imported: ImportedBorrower[], existing: ApplicationBorrower[]): BorrowerTarget[] {
  const used = new Set<string>()
  const targets: (BorrowerTarget | null)[] = imported.map((b) => {
    const match =
      existing.find((e) => !used.has(e.contactId) && sameEmail(b.person, e.person)) ??
      existing.find((e) => !used.has(e.contactId) && samePhone(b.person, e.person)) ??
      existing.find((e) => !used.has(e.contactId) && sameName(b.person, e.person))
    if (!match) return null
    used.add(match.contactId)
    return { kind: 'update', contactId: match.contactId }
  })
  return targets.map((t, i) => {
    if (t) return t
    const wantsPrimary = imported[i].isPrimary
    const fallback = existing.find((e) => !used.has(e.contactId) && (e.role === 'primary') === wantsPrimary)
    if (fallback) {
      used.add(fallback.contactId)
      return { kind: 'update', contactId: fallback.contactId }
    }
    return { kind: 'new' }
  })
}

/** True when a target would write over someone whose name differs from the file. */
export function nameMismatch(imported: ImportedBorrower, existing: ApplicationBorrower | undefined): boolean {
  return !!existing && !sameName(imported.person, existing.person)
}

/** Person fields worth writing: values present in the file, so an import never blanks out what's already entered. */
export function personChanges(person: PersonDetails): Partial<PersonDetails> {
  const militaryKnown = person.militaryService !== null
  const out: Partial<PersonDetails> = {}
  for (const [key, value] of Object.entries(person) as [keyof PersonDetails, PersonDetails[keyof PersonDetails]][]) {
    const isMilitaryFlag = key === 'militaryActiveDuty' || key === 'militaryRetired' || key === 'militaryReserveOnly' || key === 'militarySurvivingSpouse'
    if (isMilitaryFlag) {
      if (militaryKnown || value === true) (out as Record<string, unknown>)[key] = value
      continue
    }
    if (value !== null && value !== '') (out as Record<string, unknown>)[key] = value
  }
  return out
}

/** Normalized street address for matching properties ("123 Test Ln." == "123 test ln"). */
export function addressKey(addressLine: string | null | undefined, zip?: string | null): string {
  const street = norm(addressLine).replace(/[.,#]/g, ' ').replace(/\s+/g, ' ').trim()
  return street ? `${street}|${norm(zip).slice(0, 5)}` : ''
}

/** Same street address, ignoring case and punctuation; ZIP must agree when both have one. */
export function sameAddress(a: { addressLine: string | null; zip?: string | null }, b: { addressLine: string | null; zip?: string | null }): boolean {
  const [streetA, zipA] = addressKey(a.addressLine, a.zip).split('|')
  const [streetB, zipB] = addressKey(b.addressLine, b.zip).split('|')
  return !!streetA && streetA === streetB && (!zipA || !zipB || zipA === zipB)
}
