// The Leads home page (Pipeline v2 step 2): Priority Leads and a tile per
// pipeline with its count and dollar total. Pure.

import { cardAmount, pipelineFor, PIPELINES, type PipelineFile, type PipelineId } from './pipelines'

type HomeFile = PipelineFile & { priority: boolean; loanAmount: number | null; purchasePrice: number | null }

/** Starred files still being worked (not closed or lost), most recently moved first, each with the pipeline it shows in. */
export function priorityLeads<F extends HomeFile>(files: F[], now: Date = new Date()): { file: F; pipeline: PipelineId | null }[] {
  return files
    .filter((f) => f.priority && f.stage !== 'closed' && f.stage !== 'lost')
    .sort((a, b) => b.stageChangedAt.localeCompare(a.stageChangedAt))
    .map((file) => ({ file, pipeline: pipelineFor(file, now) }))
}

export interface PipelineTile {
  id: PipelineId
  count: number
  /** Loan amounts (else purchase prices) of the files in it. */
  total: number
}

/** Each pipeline's count and dollar total, in tile order. */
export function pipelineTiles(files: HomeFile[], now: Date = new Date()): PipelineTile[] {
  return PIPELINES.map((p) => {
    const here = files.filter((f) => pipelineFor(f, now) === p.id)
    return { id: p.id, count: here.length, total: here.reduce((sum, f) => sum + (cardAmount(f) ?? 0), 0) }
  })
}
