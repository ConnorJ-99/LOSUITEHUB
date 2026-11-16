// The "Next Action" tag on leads (Connor, 2026-11-16; plan
// docs/plans/lead-follow-ups.md). The database works out the value from the
// file (lead_next_action_for in 20270201000000_lead_next_action.sql) and keeps
// a pick Connor makes until the file's data changes; this file only has the
// names, colors and wording. Pure, tested.

export const LEAD_STAGES = ['lead', 'contacted', 'pre_qualified', 'pre_approved', 'home_search'] as const

export type NextActionId = 'waiting_application' | 'application_in_progress' | 'waiting_documents' | 'needs_lo_review' | 'ready_to_shop' | 'property_found' | 'waiting_borrower'

export interface NextActionInfo {
  id: NextActionId
  label: string
  /** Tailwind classes for the tag (the workspace palette). */
  className: string
  /** What it means, for the picker. */
  hint: string
}

export const NEXT_ACTIONS: readonly NextActionInfo[] = [
  { id: 'waiting_application', label: 'Waiting on Application', className: 'bg-amber-50 text-amber-900', hint: 'Prequalled, application not started' },
  { id: 'application_in_progress', label: 'Application In Progress', className: 'bg-blue-50 text-[#0f4f86]', hint: 'Started the application, not submitted' },
  { id: 'waiting_documents', label: 'Waiting on Documents', className: 'bg-red-50 text-[#a8352b]', hint: 'Items on the checklist still to come in' },
  { id: 'needs_lo_review', label: 'Needs LO Review', className: 'bg-[#D4483B] text-white', hint: 'Application and documents in: your move' },
  { id: 'ready_to_shop', label: 'Ready to Shop', className: 'bg-emerald-50 text-emerald-800', hint: 'Letter issued, home searching' },
  { id: 'property_found', label: 'Property Found', className: 'bg-[#1670BE] text-white', hint: 'Needs a letter or estimate for a home' },
  { id: 'waiting_borrower', label: 'Waiting on Borrower', className: 'bg-[#e5e9ef] text-[#374151]', hint: 'Waiting to hear back (set by hand)' },
]

export const isLeadStage = (stage: string) => (LEAD_STAGES as readonly string[]).includes(stage)

export function nextActionInfo(id: string | null | undefined): NextActionInfo | null {
  return NEXT_ACTIONS.find((a) => a.id === id) ?? null
}

const DAY = 86_400_000

/** Whole days since we last reached them (null = never). */
export function daysSinceContact(lastContactAt: string | null, now: Date): number | null {
  if (!lastContactAt) return null
  return Math.max(0, Math.floor((now.getTime() - new Date(lastContactAt).getTime()) / DAY))
}

/** "Contacted today", "Last contact 3d ago", "No contact yet". */
export function lastContactLabel(lastContactAt: string | null, now: Date): string {
  const d = daysSinceContact(lastContactAt, now)
  if (d === null) return 'No contact yet'
  if (d === 0) return 'Contacted today'
  return `Last contact ${d}d ago`
}

/** Seven days or more without contact (or none at all) shows in red. */
export const contactIsStale = (lastContactAt: string | null, now: Date) => {
  const d = daysSinceContact(lastContactAt, now)
  return d === null || d >= 7
}
