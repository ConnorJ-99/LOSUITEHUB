// Secondary roles and the per-person link profile (Loan Officer Assistant
// step 1, Connor 2026-11-17; 20270214000000_loa_roles.sql). A person keeps their
// primary company role and can also be an LO Assistant (assists the loan
// officers in loa_assignments) or a Processor (can be put in a file's
// Processor slot). Owners and admins change them in Settings → Team.

import type { OrgRole } from '@/lib/auth/context'
import { applicationLink } from '@/lib/messaging/updates'
import { cleanBookingUrl } from '@/lib/quickquote/quote'

export type SecondaryRole = 'loa' | 'processor'

export const SECONDARY_ROLES: { value: SecondaryRole; label: string; short: string; description: string }[] = [
  { value: 'loa', label: 'Loan Officer Assistant', short: 'LO Assistant', description: "Add leads to another LO's pipeline, run intake interviews, text borrowers on their behalf." },
  { value: 'processor', label: 'Processor', short: 'Processor (per file)', description: 'Can be attached to files as processor (still per file).' },
]

export const secondaryLabel = (r: SecondaryRole) => SECONDARY_ROLES.find((s) => s.value === r)?.short ?? r

export interface TeamPerson {
  id: string
  role: OrgRole
  /** Undefined before the LO assistant roles script has run. */
  secondaryRoles?: SecondaryRole[]
}

/**
 * Who may be put in a file's Processor slot: a primary Processor or anyone with
 * the Processor secondary role. Before the script runs (no secondary roles
 * loaded) everyone may, as before.
 */
export function canProcess(p: TeamPerson): boolean {
  if (!p.secondaryRoles) return true
  return p.role === 'processor' || p.secondaryRoles.includes('processor')
}

export const isLoa = (p: TeamPerson | null | undefined) => !!p?.secondaryRoles?.includes('loa')

/** The loan officers this person assists, from the company's assignments. */
export function assistsFor(userId: string, assignments: { loaUserId: string; loUserId: string }[]): string[] {
  return assignments.filter((a) => a.loaUserId === userId).map((a) => a.loUserId)
}

export interface LinkProfile {
  displayName: string | null
  title: string | null
  nmls: string | null
  applicationUrl: string | null
  bookingUrl: string | null
  bioUrl: string | null
}

export const LINK_FIELDS: { key: keyof LinkProfile; label: string; hint?: string; url?: boolean }[] = [
  { key: 'displayName', label: 'Display name', hint: 'How borrowers see the name, e.g. "Jamie". Blank = first name.' },
  { key: 'title', label: 'Title', hint: 'e.g. Loan Officer Assistant' },
  { key: 'nmls', label: 'NMLS #' },
  { key: 'applicationUrl', label: 'Application link', hint: 'Blank = the 1003 app link with the NMLS #.', url: true },
  { key: 'bookingUrl', label: 'Booking link', hint: 'A calendar link.', url: true },
  { key: 'bioUrl', label: 'Bio / NMLS page link', url: true },
]

/** Web addresses cleaned to https://…; a bad one is reported by field. */
export function cleanLinks(p: LinkProfile): { links: LinkProfile; problems: Partial<Record<keyof LinkProfile, string>> } {
  const links = { ...p }
  const problems: Partial<Record<keyof LinkProfile, string>> = {}
  for (const f of LINK_FIELDS) {
    const v = (links[f.key] ?? '').trim()
    if (!f.url) {
      links[f.key] = v || null
      continue
    }
    const c = cleanBookingUrl(v)
    if (c === 'invalid') problems[f.key] = "That doesn't look like a web address."
    else links[f.key] = c
  }
  return { links, problems }
}

/** The application link used for this person: their own, else the 1003 app link from their NMLS #. */
export function applicationLinkFor(p: Pick<LinkProfile, 'applicationUrl' | 'nmls'>): string | null {
  return p.applicationUrl?.trim() || applicationLink(p.nmls)
}

/** First name for borrower messages: the display name, else the first word of the full name. */
export function firstNameFor(p: { displayName?: string | null; fullName?: string | null; email?: string | null }): string {
  const d = p.displayName?.trim()
  if (d) return d.split(/\s+/)[0]
  const f = p.fullName?.trim()
  if (f) return f.split(/\s+/)[0]
  return (p.email ?? '').split('@')[0]
}
