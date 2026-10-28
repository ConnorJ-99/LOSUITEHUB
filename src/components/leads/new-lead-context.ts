import { createContext, useContext } from 'react'
import type { LoanPurpose, PipelineStage } from '@/lib/pipeline/stages'

/** Where a lead added from a pipeline column starts: that board's loan type and that column's stage. */
export interface NewLeadPreset {
  purpose?: LoanPurpose
  stage?: PipelineStage
}

/** Lets any screen (sidebar, pipeline header, empty states, pipeline columns) open the New Lead form. */
export const NewLeadContext = createContext<{ openNewLead: (preset?: NewLeadPreset) => void }>({ openNewLead: () => {} })

export const useNewLead = () => useContext(NewLeadContext)
