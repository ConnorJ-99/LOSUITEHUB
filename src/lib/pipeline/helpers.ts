import type { LoanPurpose, PipelineStage } from './stages'

const DAY_MS = 24 * 60 * 60 * 1000

/** Whole days since a timestamp (0 on the same day it happened). */
export function daysSince(isoTimestamp: string, now: Date = new Date()): number {
  const elapsed = now.getTime() - new Date(isoTimestamp).getTime()
  return Math.max(0, Math.floor(elapsed / DAY_MS))
}

/** "Today", "1 day", "12 days". */
export function formatDaysInStage(days: number): string {
  if (days === 0) return 'Today'
  return days === 1 ? '1 day' : `${days} days`
}

/** Digits only, so "(214) 555-0100" and "214.555.0100" match. Mirrors contacts.phone_digits. */
export function phoneDigits(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '')
  return digits === '' ? null : digits
}

/** Show a US 10-digit number as (214) 555-0100; leave anything else as typed. */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return ''
  const digits = phoneDigits(phone) ?? ''
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : phone
}

export interface PersonName {
  firstName: string
  lastName: string
}

export function fullName(person: PersonName | null | undefined): string {
  if (!person) return 'No borrower'
  return `${person.firstName} ${person.lastName}`.trim()
}

/** Closed and Lost loans drop off the board after this many days (the list view keeps them). */
export const BOARD_ARCHIVE_DAYS = 30

export function isOnBoard(stage: PipelineStage, stageChangedAt: string, now: Date = new Date()): boolean {
  if (stage !== 'closed' && stage !== 'lost') return true
  return daysSince(stageChangedAt, now) <= BOARD_ARCHIVE_DAYS
}

export interface SearchableLoan {
  stage: PipelineStage
  purpose: LoanPurpose
  assignedLoId: string | null
  borrower: (PersonName & { email: string | null; phone: string | null }) | null
  referralSource: string | null
}

export interface PipelineFilters {
  search: string
  stage: PipelineStage | 'all'
  purpose: LoanPurpose | 'all'
  assignedLoId: string | 'all'
}

export const emptyFilters: PipelineFilters = { search: '', stage: 'all', purpose: 'all', assignedLoId: 'all' }

/** Matches name, email, phone (any format) or referral source, plus the dropdown filters. */
export function matchesFilters(loan: SearchableLoan, filters: PipelineFilters): boolean {
  if (filters.stage !== 'all' && loan.stage !== filters.stage) return false
  if (filters.purpose !== 'all' && loan.purpose !== filters.purpose) return false
  if (filters.assignedLoId !== 'all' && loan.assignedLoId !== filters.assignedLoId) return false

  const query = filters.search.trim().toLowerCase()
  if (!query) return true

  const b = loan.borrower
  const haystack = [b ? fullName(b) : '', b?.email ?? '', loan.referralSource ?? ''].join(' ').toLowerCase()
  if (query.split(/\s+/).every((word) => haystack.includes(word))) return true

  const queryDigits = phoneDigits(query)
  return queryDigits !== null && queryDigits.length >= 3 && (phoneDigits(b?.phone) ?? '').includes(queryDigits)
}
