// Nurture check-ins and reported updates (Connor, 2026-11-16; plan
// docs/plans/buyer-nurture.md Steps 6–8). The database drafts the check-ins
// (draft_nurture_followup in 20270207000000_nurture_followups.sql) and turns
// a Nurture borrower's reply into an unverified update; this file reads what
// they carry. Pure, tested.

export type NurtureFollowupKind = 'roadmap' | 'check_in' | 'due' | 'overdue' | 'reassess'

export const NURTURE_KIND_LABEL: Record<NurtureFollowupKind, string> = {
  roadmap: 'Roadmap check-in',
  check_in: 'Milestone check-in',
  due: 'Milestone due',
  overdue: 'Milestone overdue',
  reassess: 'Ready for review',
}

/** What a nurture check-in draft knows (payload.nurture). */
export interface NurtureContext {
  kind: NurtureFollowupKind
  planVersion: number | null
  goal: string | null
  milestoneTitle: string | null
  measure: string | null
  targetDate: string | null
  actionTitle: string | null
  lastContactAt: string | null
  reason: string
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)

export function readNurtureContext(payload: unknown): NurtureContext | null {
  if (!isObject(payload) || !isObject(payload.nurture)) return null
  const n = payload.nurture
  const kind = (Object.keys(NURTURE_KIND_LABEL) as NurtureFollowupKind[]).find((k) => k === n.kind)
  if (!kind) return null
  return {
    kind,
    planVersion: typeof n.planVersion === 'number' ? n.planVersion : null,
    goal: str(n.goal),
    milestoneTitle: str(n.milestoneTitle),
    measure: str(n.measure),
    targetDate: str(n.targetDate),
    actionTitle: str(n.actionTitle),
    lastContactAt: str(n.lastContactAt),
    reason: str(n.reason) ?? '',
  }
}

/** Settings → Nurture check-ins (on the lead follow-ups row). */
export interface NurtureFollowupSettings {
  enabled: boolean
  roadmapDays: number
  overdueDays: number
  quietDays: number
}

export const DEFAULT_NURTURE_SETTINGS: NurtureFollowupSettings = { enabled: false, roadmapDays: 3, overdueDays: 3, quietDays: 4 }

export const NURTURE_SETTING_COLUMNS = {
  enabled: 'nurture_enabled',
  roadmapDays: 'nurture_roadmap_days',
  overdueDays: 'nurture_overdue_days',
  quietDays: 'nurture_quiet_days',
} as const satisfies Record<keyof NurtureFollowupSettings, string>

/** The settings from the lead follow-ups row; null when the nurture script hasn't run. */
export function nurtureSettingsFrom(row: Record<string, unknown> | null): NurtureFollowupSettings | null {
  if (!row) return DEFAULT_NURTURE_SETTINGS
  if (!(NURTURE_SETTING_COLUMNS.enabled in row)) return null
  const n = (k: Exclude<keyof NurtureFollowupSettings, 'enabled'>) => {
    const v = Number(row[NURTURE_SETTING_COLUMNS[k]])
    return Number.isFinite(v) ? v : DEFAULT_NURTURE_SETTINGS[k]
  }
  return { enabled: row.nurture_enabled === true, roadmapDays: n('roadmapDays'), overdueDays: n('overdueDays'), quietDays: n('quietDays') }
}

/** Why the settings can't be saved (null = fine). */
export function nurtureSettingsProblem(s: NurtureFollowupSettings): string | null {
  const ok = (v: number, min: number) => Number.isInteger(v) && v >= min && v <= 30
  if (!ok(s.roadmapDays, 1)) return 'Roadmap check-in: use whole days from 1 to 30.'
  if (!ok(s.overdueDays, 1)) return 'Overdue: use whole days from 1 to 30.'
  if (!ok(s.quietDays, 0)) return 'Quiet days: use whole days from 0 to 30.'
  return null
}

// ---------------------------------------------------------------------------
// Reported updates
// ---------------------------------------------------------------------------

export type UpdateStatus = 'queued' | 'unverified' | 'verified' | 'dismissed'
export type UpdateKind = 'progress' | 'reported_done' | 'question' | 'setback' | 'other'

export const UPDATE_KIND_LABEL: Record<UpdateKind, string> = {
  progress: 'Progress',
  reported_done: 'Says it’s done',
  question: 'Question',
  setback: 'Setback',
  other: 'Update',
}

export interface NurtureUpdate {
  id: string
  status: UpdateStatus
  source: 'reply' | 'typed' | 'myhome'
  kind: UpdateKind | null
  summary: string | null
  suggestedNext: string | null
  confidence: 'high' | 'medium' | 'low' | null
  milestoneId: string | null
  messageId: string | null
  createdAt: string
  verifiedAt: string | null
}

/** Waiting for the loan officer: not verified or dismissed yet. */
export const isOpenUpdate = (u: Pick<NurtureUpdate, 'status'>) => u.status === 'queued' || u.status === 'unverified'

/** Milestones with a reported (open) update: shown as "Reported" on the plan. */
export function reportedMilestones(updates: Pick<NurtureUpdate, 'status' | 'milestoneId'>[]): Set<string> {
  return new Set(updates.filter((u) => isOpenUpdate(u) && u.milestoneId).map((u) => u.milestoneId!))
}
