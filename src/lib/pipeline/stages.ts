// Pipeline stages and loan purposes. Values match the Postgres enums in
// supabase/migrations/20261025000000_contacts_pipeline.sql (Home Search added in
// 20261120000000_pipeline_v2.sql).

export type PipelineStage =
  | 'lead'
  | 'contacted'
  | 'pre_qualified'
  | 'pre_approved'
  | 'home_search'
  | 'under_contract'
  | 'processing'
  | 'clear_to_close'
  | 'closed'
  | 'nurture'
  | 'lost'

export type LoanPurpose =
  | 'purchase'
  | 'refinance_rate_term'
  | 'refinance_cash_out'
  | 'heloc'
  | 'heloan'
  | 'investment_dscr'

export interface StageInfo {
  value: PipelineStage
  label: string
  /** Main stages run left to right; side stages sit outside the main flow. */
  kind: 'main' | 'side'
}

export const STAGES: readonly StageInfo[] = [
  { value: 'lead', label: 'Lead', kind: 'main' },
  { value: 'contacted', label: 'Contacted', kind: 'main' },
  { value: 'pre_qualified', label: 'Pre-Qualified', kind: 'main' },
  { value: 'pre_approved', label: 'Pre-Approved', kind: 'main' },
  { value: 'home_search', label: 'Home Search', kind: 'main' },
  { value: 'under_contract', label: 'Under Contract', kind: 'main' },
  { value: 'processing', label: 'Submitted / Processing', kind: 'main' },
  { value: 'clear_to_close', label: 'Approved / CTC', kind: 'main' },
  { value: 'closed', label: 'Closed', kind: 'main' },
  { value: 'nurture', label: 'Nurture', kind: 'side' },
  { value: 'lost', label: 'Lost', kind: 'side' },
]

export const PURPOSES: readonly { value: LoanPurpose; label: string }[] = [
  { value: 'purchase', label: 'Purchase' },
  { value: 'refinance_rate_term', label: 'Rate/Term Refi' },
  { value: 'refinance_cash_out', label: 'Cash-Out Refi' },
  { value: 'heloc', label: 'HELOC' },
  { value: 'heloan', label: 'HELOAN' },
  { value: 'investment_dscr', label: 'Investment / DSCR' },
]

const stageLabels = Object.fromEntries(STAGES.map((s) => [s.value, s.label])) as Record<PipelineStage, string>
const purposeLabels = Object.fromEntries(PURPOSES.map((p) => [p.value, p.label])) as Record<LoanPurpose, string>

export const stageLabel = (stage: PipelineStage) => stageLabels[stage]
export const purposeLabel = (purpose: LoanPurpose) => purposeLabels[purpose]

/** Common reasons offered as one-click chips when marking a loan Lost. */
export const LOST_REASONS = [
  'Went with another lender',
  'Did not qualify',
  'Stopped responding',
  'Decided not to buy / refi',
  'Rate or fees too high',
] as const
