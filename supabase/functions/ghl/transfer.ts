// Reassigning a file moves its GoHighLevel ownership too (Connor, 2026-11-16).
// After LOSuite hands a file to another loan officer (reassign_loan), the ghl
// function's transfer_owner task sets the new loan officer's GHL user as the
// owner of every borrower's GHL contact on the file and of the primary
// borrower's opportunity. Who may ask, and what is skipped, is decided here.
// Pure and import-free, tested.

export interface TransferAsk {
  /** The caller's role in the company. */
  role: string
  callerId: string
  /** The loan officer the file was handed to (from the request). */
  toLoId: string | null
  /** Who the file belongs to now (read with the service role). */
  assignedNow: string | null
  /** The latest change of the file's loan officer: who made it, to whom, when. */
  lastChange: { changedBy: string | null; newValue: string | null; changedAt: string } | null
  now: Date
}

/** Minutes after a reassignment in which the person who made it may move GHL. */
export const TRANSFER_WINDOW_MINUTES = 15

/** Why the caller can't move GHL ownership for this file (null = they can). */
export function transferRefusal(a: TransferAsk): string | null {
  if (!a.toLoId) return 'The file has no loan officer now, so GHL ownership stays as it is.'
  if (a.assignedNow !== a.toLoId) return 'The file isn\'t assigned to that loan officer in LOSuite, so GHL wasn\'t changed.'
  if (a.role === 'owner' || a.role === 'admin') return null
  // A loan officer who just handed their own file over (they can't see it any more).
  const c = a.lastChange
  if (c && c.changedBy === a.callerId && c.newValue === a.toLoId && a.now.getTime() - Date.parse(c.changedAt) <= TRANSFER_WINDOW_MINUTES * 60_000) return null
  return 'Only an owner or admin, or the person who just reassigned the file, can move its GHL ownership.'
}

export interface TransferPerson {
  id: string
  firstName: string | null
  lastName: string | null
  ghlContactId: string | null
  ghlOpportunityId: string | null
  primary: boolean
}

export interface TransferPlan {
  contacts: { personId: string; ghlContactId: string }[]
  opportunities: string[]
  /** People left alone, with why. */
  notes: string[]
}

/** Which GHL contacts and opportunities to hand over (test mode: TEST names only). */
export function planTransfer(people: TransferPerson[], testOnly: boolean, isTest: (first: string | null, last: string | null) => boolean): TransferPlan {
  const out: TransferPlan = { contacts: [], opportunities: [], notes: [] }
  for (const p of people) {
    const name = [p.firstName, p.lastName].filter(Boolean).join(' ') || 'A borrower'
    if (testOnly && !isTest(p.firstName, p.lastName)) {
      out.notes.push(`${name}: test mode only changes GHL for people with TEST in their name.`)
      continue
    }
    if (!p.ghlContactId) {
      out.notes.push(`${name} isn't in GHL yet; they'll be added under the new loan officer when they are.`)
      continue
    }
    out.contacts.push({ personId: p.id, ghlContactId: p.ghlContactId })
    if (p.primary && p.ghlOpportunityId && !out.opportunities.includes(p.ghlOpportunityId)) out.opportunities.push(p.ghlOpportunityId)
  }
  return out
}
