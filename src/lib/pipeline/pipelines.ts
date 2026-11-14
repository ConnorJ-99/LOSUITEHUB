// The pipelines (Pipeline redesign, Connor 2026-11-13; replaces Pipeline v2's
// loan-type boards). Purchase, Refinance and HELOC each have ordered stages,
// and each stage ordered steps. A stage is a column on the board and covers
// one or more database stages (loans.stage); a file's step is
// loans.current_step (1 = the first; the database resets it when the stage
// changes) and its days in stage come from loans.stage_changed_at. Closed,
// Nurture and Lost keep their own pages. Investment isn't a pipeline any more:
// it's the occupancy. This is the one place stages and steps are set. Pure.

import type { LoanPurpose, PipelineStage } from './stages'

export type BoardId = 'purchase' | 'refinance' | 'heloc'
export type PipelineId = BoardId | 'closed' | 'nurture' | 'lost'

export interface PipelineColumn {
  id: string
  label: string
  /** Database stages shown in this column. */
  stages: PipelineStage[]
  /** The stage a card dropped here moves to; null = can't drop here. */
  dropStage: PipelineStage | null
  /** The steps inside this stage, in order. */
  steps: string[]
}

export interface PipelineInfo {
  id: PipelineId
  label: string
  description: string
  columns: PipelineColumn[]
}

const STEPS = {
  newLead: ['Contacted', 'Discovery call', 'Credit pulled'],
  prequal: ['Docs requested', 'Income reviewed', 'Prequal letter sent'],
  preApproved: ['AUS approved', 'Letter issued', 'Shopping with agent'],
  underContract: ['Contract received', 'Intent to proceed', 'Appraisal ordered', 'Submitted to lender'],
  processing: ['Conditions requested', 'Conditions submitted', 'Appraisal received'],
  underwriting: ['Initial UW review', 'Conditions cleared', 'Final review'],
  clearToClose: ['CD sent', 'CD signed', 'Funded'],
}

const col = (id: string, label: string, stages: PipelineStage[], steps: string[], dropStage: PipelineStage | null = stages[0]): PipelineColumn => ({ id, label, stages, dropStage, steps })
const NEW_LEAD = col('new_lead', 'New lead', ['lead', 'contacted'], STEPS.newLead)

export const PIPELINES: readonly PipelineInfo[] = [
  {
    id: 'purchase',
    label: 'Purchase',
    description: 'Homebuyers, from new lead to clear to close',
    columns: [
      NEW_LEAD,
      col('prequal', 'Prequal', ['pre_qualified'], STEPS.prequal),
      col('pre_approved', 'Pre-approved', ['pre_approved', 'home_search'], STEPS.preApproved),
      col('under_contract', 'Under contract', ['under_contract'], STEPS.underContract),
      col('processing', 'Processing', ['processing'], STEPS.processing),
      col('underwriting', 'Underwriting', ['underwriting'], STEPS.underwriting),
      col('clear_to_close', 'Clear to close', ['clear_to_close'], STEPS.clearToClose),
    ],
  },
  {
    id: 'refinance',
    label: 'Refinance',
    description: 'Rate/term and cash-out refinances',
    columns: [
      NEW_LEAD,
      col('quoted', 'Quoted', ['pre_qualified', 'pre_approved', 'home_search'], STEPS.prequal),
      col('application', 'Application', ['under_contract'], STEPS.underContract),
      col('processing', 'Processing', ['processing'], STEPS.processing),
      col('underwriting', 'Underwriting', ['underwriting'], STEPS.underwriting),
      col('clear_to_close', 'Clear to close', ['clear_to_close'], STEPS.clearToClose),
    ],
  },
  {
    id: 'heloc',
    label: 'HELOC',
    description: 'Home equity lines and second liens',
    columns: [
      NEW_LEAD,
      col('quoted', 'Quoted', ['pre_qualified', 'pre_approved', 'home_search'], STEPS.prequal),
      col('application', 'Application', ['under_contract'], STEPS.underContract),
      col('underwriting', 'Underwriting', ['processing', 'underwriting'], STEPS.underwriting, 'underwriting'),
      col('closing', 'Closing', ['clear_to_close'], STEPS.clearToClose),
    ],
  },
  { id: 'closed', label: 'Closed', description: 'Closed loans', columns: [col('closed', 'Closed', ['closed'], [], null)] },
  { id: 'nurture', label: 'Nurture', description: 'Not ready yet; keep in touch', columns: [col('nurture', 'Nurture', ['nurture'], [])] },
  { id: 'lost', label: 'Lost', description: 'Files marked lost, with the reason', columns: [col('lost', 'Lost', ['lost'], [])] },
]

export const BOARDS: readonly BoardId[] = ['purchase', 'refinance', 'heloc']
export const isBoard = (id: string): id is BoardId => (BOARDS as readonly string[]).includes(id)
export const pipelineInfo = (id: PipelineId) => PIPELINES.find((p) => p.id === id)!

/** The board for each loan purpose (an old Investment / DSCR purpose reads as Purchase). */
export function purposePipeline(purpose: LoanPurpose): BoardId {
  if (purpose === 'heloc' || purpose === 'heloan') return 'heloc'
  if (purpose === 'refinance_rate_term' || purpose === 'refinance_cash_out') return 'refinance'
  return 'purchase'
}

export interface PipelineFile {
  purpose: LoanPurpose
  stage: PipelineStage
  stageChangedAt: string
}

/** Where a file shows: its loan type's board while active, else Closed, Nurture or Lost. */
export function pipelineFor(f: Pick<PipelineFile, 'purpose' | 'stage'>, _now: Date = new Date()): PipelineId {
  if (f.stage === 'closed' || f.stage === 'nurture' || f.stage === 'lost') return f.stage
  return purposePipeline(f.purpose)
}

/** The column a file shows in on a pipeline. */
export function columnFor(f: Pick<PipelineFile, 'stage'>, pipeline: PipelineId): PipelineColumn | null {
  return pipelineInfo(pipeline).columns.find((c) => c.stages.includes(f.stage)) ?? null
}

/** A file's stage name on its own pipeline ("Quoted" for a refinance at Pre-Qualified). */
export function stageLabelFor(stage: PipelineStage, purpose: LoanPurpose, fallback: string): string {
  return columnFor({ stage }, pipelineFor({ stage, purpose }))?.label ?? fallback
}

/** The amount on a card and in its column total: the loan amount, else the purchase price. */
export function cardAmount(f: { loanAmount: number | null; purchasePrice: number | null }): number | null {
  return f.loanAmount ?? f.purchasePrice ?? null
}

/** Count and dollar total for each column of a pipeline. */
export function columnTotals<F extends PipelineFile & { loanAmount: number | null; purchasePrice: number | null }>(files: F[], pipeline: PipelineId) {
  return pipelineInfo(pipeline).columns.map((c) => {
    const here = files.filter((f) => pipelineFor(f) === pipeline && c.stages.includes(f.stage))
    return { column: c.id, count: here.length, total: here.reduce((sum, f) => sum + (cardAmount(f) ?? 0), 0) }
  })
}
