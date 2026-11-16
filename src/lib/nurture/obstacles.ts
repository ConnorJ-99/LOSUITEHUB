// Buyer Recovery & Nurture (Connor, 2026-11-16; plan docs/plans/buyer-nurture.md):
// the readiness obstacles and the nurture stages. Keys match the database
// (nurture_obstacle_ok and loans_nurture_stage_check in
// 20270205000000_nurture.sql). Pure, tested.

export interface ObstacleGroup {
  id: 'credit' | 'debt' | 'income' | 'assets' | 'other'
  label: string
  items: { key: string; label: string }[]
}

export const OBSTACLE_GROUPS: readonly ObstacleGroup[] = [
  {
    id: 'credit',
    label: 'Credit',
    items: [
      { key: 'credit_score_low', label: 'Score below program minimum' },
      { key: 'credit_recent_lates', label: 'Recent late payments' },
      { key: 'credit_collections', label: 'Collections or charge-offs' },
      { key: 'credit_utilization', label: 'High card utilization' },
      { key: 'credit_limited_history', label: 'Limited credit history' },
      { key: 'credit_errors', label: 'Report errors or disputes' },
    ],
  },
  {
    id: 'debt',
    label: 'Debt',
    items: [
      { key: 'debt_dti_high', label: 'DTI too high' },
      { key: 'debt_revolving', label: 'High revolving balances' },
      { key: 'debt_monthly', label: 'High monthly obligations' },
      { key: 'debt_student_loans', label: 'Student loan payment issues' },
      { key: 'debt_auto_loan', label: 'Auto loan' },
    ],
  },
  {
    id: 'income',
    label: 'Income / employment',
    items: [
      { key: 'income_insufficient', label: 'Not enough income' },
      { key: 'income_short_history', label: 'Short job history' },
      { key: 'income_self_employed_docs', label: 'Self-employment documents' },
      { key: 'income_variable', label: 'Variable income' },
      { key: 'income_missing_docs', label: 'Missing income documents' },
    ],
  },
  {
    id: 'assets',
    label: 'Assets',
    items: [
      { key: 'assets_down_payment', label: 'Not enough for the down payment' },
      { key: 'assets_closing_funds', label: 'Not enough for closing costs' },
      { key: 'assets_missing_docs', label: 'Missing asset documents' },
      { key: 'assets_unverified_deposits', label: 'Unverified deposits' },
      { key: 'assets_reserves', label: 'Reserves' },
    ],
  },
  {
    id: 'other',
    label: 'Other',
    items: [
      { key: 'other_lease', label: 'Lease expiring' },
      { key: 'other_buying_later', label: 'Buying later' },
      { key: 'other_sell_home', label: 'Needs to sell current home' },
    ],
  },
]

const LABELS = new Map(OBSTACLE_GROUPS.flatMap((g) => g.items.map((i) => [i.key, i.label] as const)))
const GROUP_OF = new Map(OBSTACLE_GROUPS.flatMap((g) => g.items.map((i) => [i.key, g.id] as const)))

export const CUSTOM_PREFIX = 'custom:'
export const isCustom = (key: string) => key.startsWith(CUSTOM_PREFIX)
/** A typed obstacle as stored ("custom:<words>"); null when blank. */
export function customObstacle(words: string): string | null {
  const w = words.trim().replace(/\s+/g, ' ').slice(0, 120)
  return w ? `${CUSTOM_PREFIX}${w}` : null
}

/** Plain words for an obstacle key (a custom one shows its own words). */
export function obstacleLabel(key: string): string {
  if (isCustom(key)) return key.slice(CUSTOM_PREFIX.length)
  return LABELS.get(key) ?? key
}

/** Which group an obstacle is in (custom = Other). */
export const obstacleGroup = (key: string): ObstacleGroup['id'] => GROUP_OF.get(key) ?? 'other'

/** "Score below program minimum, DTI too high". */
export const obstacleSummary = (keys: string[]) => keys.map(obstacleLabel).join(', ')

export type NurtureStage = 'initial_review' | 'plan_needed' | 'plan_generated' | 'plan_delivered' | 'working' | 'waiting_milestone' | 'ready_reassess' | 'ready_prequal' | 'paused'

export const NURTURE_STAGES: readonly { id: NurtureStage; label: string }[] = [
  { id: 'initial_review', label: 'Initial Review' },
  { id: 'plan_needed', label: 'Buyer Readiness Plan Needed' },
  { id: 'plan_generated', label: 'Plan Generated' },
  { id: 'plan_delivered', label: 'Plan Delivered' },
  { id: 'working', label: 'Actively Working on Plan' },
  { id: 'waiting_milestone', label: 'Waiting for Milestone' },
  { id: 'ready_reassess', label: 'Ready for Reassessment' },
  { id: 'ready_prequal', label: 'Ready for Prequalification' },
  { id: 'paused', label: 'Paused / Unresponsive' },
]

export const nurtureStageLabel = (id: string | null | undefined) => NURTURE_STAGES.find((s) => s.id === id)?.label ?? 'Initial Review'

/** Whole days since the file entered Nurture. */
export function daysInNurture(enteredAt: string | null, now: Date): number | null {
  if (!enteredAt) return null
  return Math.max(0, Math.floor((now.getTime() - new Date(enteredAt).getTime()) / 86_400_000))
}

/** A follow-up date that has passed. */
export const followUpOverdue = (date: string | null, today: string) => !!date && date < today
