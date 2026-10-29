// Pipelines by loan type (Pipeline v2, docs/plans/pipeline-v2.md): which
// pipeline and column each file shows in, and the column totals. A pipeline is
// a view of loans.stage and loans.purpose; nothing about it is stored. Pure.

import type { LoanPurpose, PipelineStage } from './stages'

export type PipelineId = 'new_leads' | 'purchase' | 'refinance' | 'investment' | 'heloc' | 'in_process' | 'nurture' | 'lost'

export interface PipelineColumn {
  id: string
  label: string
  /** Stages shown in this column. */
  stages: PipelineStage[]
  /** The stage a card dropped here moves to; null = can't drop here. */
  dropStage: PipelineStage | null
}

export interface PipelineInfo {
  id: PipelineId
  label: string
  description: string
  columns: PipelineColumn[]
}

/** Closed files show in In Process this many days. */
export const CLOSED_SHOWN_DAYS = 30

const col = (id: string, label: string, stages: PipelineStage[], dropStage: PipelineStage | null = stages[0]): PipelineColumn => ({ id, label, stages, dropStage })

export const PIPELINES: readonly PipelineInfo[] = [
  { id: 'new_leads', label: 'New Leads', description: 'Every new lead, waiting to be contacted', columns: [col('lead', 'New', ['lead'])] },
  {
    id: 'purchase',
    label: 'Purchase',
    description: 'Homebuyers moving toward a purchase',
    columns: [col('contacted', 'Contacted', ['contacted']), col('pre_qualified', 'Pre-Qualified', ['pre_qualified']), col('pre_approved', 'Pre-Approved', ['pre_approved']), col('home_search', 'Home Search', ['home_search']), col('under_contract', 'Under Contract', ['under_contract'])],
  },
  {
    id: 'refinance',
    label: 'Refinance',
    description: 'Rate/term and cash-out refinances',
    columns: [col('contacted', 'Contacted', ['contacted']), col('pre_qualified', 'Pre-Qualified', ['pre_qualified', 'pre_approved', 'home_search']), col('application', 'Application', ['under_contract'])],
  },
  {
    id: 'investment',
    label: 'Investment',
    description: 'Investors buying or refinancing rentals',
    columns: [col('contacted', 'Contacted', ['contacted']), col('pre_qualified', 'Pre-Qualified', ['pre_qualified', 'pre_approved']), col('home_search', 'Home Search', ['home_search']), col('under_contract', 'Under Contract / Application', ['under_contract'])],
  },
  {
    id: 'heloc',
    label: 'HELOC / HELOAN',
    description: 'Home equity lines and second liens',
    columns: [col('contacted', 'Contacted', ['contacted']), col('pre_qualified', 'Pre-Qualified', ['pre_qualified', 'pre_approved', 'home_search']), col('application', 'Application', ['under_contract'])],
  },
  {
    id: 'in_process',
    label: 'In Process',
    description: 'Every loan type from submission to closing',
    columns: [col('processing', 'Submitted / Processing', ['processing']), col('clear_to_close', 'Approved / CTC', ['clear_to_close']), col('closed', `Closed (last ${CLOSED_SHOWN_DAYS} days)`, ['closed'])],
  },
  { id: 'nurture', label: 'Nurture', description: 'Not ready yet; keep in touch', columns: [col('nurture', 'Nurture', ['nurture'])] },
  { id: 'lost', label: 'Lost', description: 'Files marked lost, with the reason', columns: [col('lost', 'Lost', ['lost'])] },
]

export const pipelineInfo = (id: PipelineId) => PIPELINES.find((p) => p.id === id)!

/** The pipeline for each loan type while the file is active. */
export function purposePipeline(purpose: LoanPurpose): PipelineId {
  if (purpose === 'purchase') return 'purchase'
  if (purpose === 'investment_dscr') return 'investment'
  if (purpose === 'heloc' || purpose === 'heloan') return 'heloc'
  return 'refinance'
}

export interface PipelineFile {
  purpose: LoanPurpose
  stage: PipelineStage
  stageChangedAt: string
}

const DAY_MS = 24 * 60 * 60 * 1000
const daysIn = (f: PipelineFile, now: Date) => Math.max(0, Math.floor((now.getTime() - new Date(f.stageChangedAt).getTime()) / DAY_MS))

/** Where a file shows: New Leads, its loan type's pipeline, In Process, Nurture or Lost (as soon as it moves there). Null = nowhere (closed more than 30 days ago). */
export function pipelineFor(f: PipelineFile, now: Date = new Date()): PipelineId | null {
  if (f.stage === 'lead') return 'new_leads'
  if (f.stage === 'processing' || f.stage === 'clear_to_close') return 'in_process'
  if (f.stage === 'closed') return daysIn(f, now) <= CLOSED_SHOWN_DAYS ? 'in_process' : null
  if (f.stage === 'nurture' || f.stage === 'lost') return f.stage
  return purposePipeline(f.purpose)
}

/** The column a file shows in on its pipeline. */
export function columnFor(f: PipelineFile, pipeline: PipelineId): PipelineColumn | null {
  return pipelineInfo(pipeline).columns.find((c) => c.stages.includes(f.stage)) ?? null
}

/** How Under Contract reads for a file: refinances and HELOCs have no contract, so it's their Application stage. */
export function stageLabelFor(stage: PipelineStage, purpose: LoanPurpose, fallback: string): string {
  return stage === 'under_contract' && purpose !== 'purchase' && purpose !== 'investment_dscr' ? 'Application' : fallback
}

/** The amount on a card and in its column total: the loan amount, else the purchase price. */
export function cardAmount(f: { loanAmount: number | null; purchasePrice: number | null }): number | null {
  return f.loanAmount ?? f.purchasePrice ?? null
}

/** Count and dollar total for each column of a pipeline. */
export function columnTotals<F extends PipelineFile & { loanAmount: number | null; purchasePrice: number | null }>(files: F[], pipeline: PipelineId, now: Date = new Date()) {
  return pipelineInfo(pipeline).columns.map((c) => {
    const here = files.filter((f) => pipelineFor(f, now) === pipeline && c.stages.includes(f.stage))
    return { column: c.id, count: here.length, total: here.reduce((sum, f) => sum + (cardAmount(f) ?? 0), 0) }
  })
}
