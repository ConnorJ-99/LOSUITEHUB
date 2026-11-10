// Realtor relationship stages (build plan Phase 4): the stage list, counts per
// stage, referred and closed file counts (worked out, never stored), the
// follow-up state and the Partners page filters. Pure, tested.

export type PartnerStage = 'identified' | 'contacted' | 'meeting_scheduled' | 'meeting_completed' | 'active' | 'nurture'

export const PARTNER_STAGES: readonly { value: PartnerStage; label: string }[] = [
  { value: 'identified', label: 'Identified' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'meeting_scheduled', label: 'Meeting scheduled' },
  { value: 'meeting_completed', label: 'Meeting completed' },
  { value: 'active', label: 'Active' },
  { value: 'nurture', label: 'Nurture' },
]

export const partnerStageLabel = (s: PartnerStage) => PARTNER_STAGES.find((x) => x.value === s)?.label ?? s

/** How many partners are in each stage, in the stage order (zeros included). */
export function stageCounts(partners: { stage: PartnerStage }[]): { stage: PartnerStage; label: string; count: number }[] {
  return PARTNER_STAGES.map((s) => ({ stage: s.value, label: s.label, count: partners.filter((p) => p.stage === s.value).length }))
}

/** Files they're on (each file once, whatever their role on it) and how many of those closed. */
export function fileCounts(files: { loanId: string; stage: string }[]): { referred: number; closed: number } {
  const byLoan = new Map(files.map((f) => [f.loanId, f.stage]))
  return { referred: byLoan.size, closed: [...byLoan.values()].filter((s) => s === 'closed').length }
}

export type FollowUp = { tone: 'overdue' | 'today' | 'soon' | 'later'; days: number }

/** Where the next follow-up stands: overdue, today, within a week, or later. Null without a date. */
export function followUpState(nextOn: string | null, today: string): FollowUp | null {
  if (!nextOn) return null
  const days = Math.round((Date.parse(`${nextOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
  return { days, tone: days < 0 ? 'overdue' : days === 0 ? 'today' : days <= 7 ? 'soon' : 'later' }
}

export interface PartnerFilters {
  stage: PartnerStage | null
  /** Only partners assigned to this person ("My partners"); null = everyone. */
  mineOf: string | null
}

export function filterByStage<T extends { stage: PartnerStage; assignedLoId: string | null }>(partners: T[], f: PartnerFilters): T[] {
  return partners.filter((p) => (!f.stage || p.stage === f.stage) && (!f.mineOf || p.assignedLoId === f.mineOf))
}

/** Soonest follow-up first (overdue at the top); partners without one keep their order after them. */
export function byFollowUp<T extends { nextFollowUpOn: string | null }>(partners: T[]): T[] {
  return [...partners].sort((a, b) => (a.nextFollowUpOn ?? '9999').localeCompare(b.nextFollowUpOn ?? '9999'))
}
