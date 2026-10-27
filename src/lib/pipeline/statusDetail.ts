// Status detail: where a file is inside its stage (Pipeline v2), shown as a
// dropdown on each card. Stored in loans.status_detail; the database clears it
// when the stage changes. The choices start from Connor's old app and can move
// to Settings later. Pure.

import type { LoanPurpose, PipelineStage } from './stages'

interface Choice {
  label: string
  /** Only for purchases (a refinance has no home search or option period). */
  purchaseOnly?: boolean
}

const CHOICES: Record<PipelineStage, Choice[]> = {
  lead: [{ label: 'Left voicemail' }, { label: 'Texted' }, { label: 'Emailed' }, { label: 'No answer yet' }],
  contacted: [{ label: 'Reviewing credit' }, { label: 'Waiting on documents' }, { label: 'Application sent' }, { label: 'Left voicemail' }, { label: 'Needs follow-up' }],
  pre_qualified: [{ label: 'Prequal letter sent', purchaseOnly: true }, { label: 'Waiting on documents' }, { label: 'Working on credit' }, { label: 'Saving for down payment', purchaseOnly: true }, { label: 'Reviewing options' }],
  pre_approved: [{ label: 'Pre-approval letter sent', purchaseOnly: true }, { label: 'Waiting on documents' }, { label: 'Ready to shop', purchaseOnly: true }],
  home_search: [{ label: 'Just started looking', purchaseOnly: true }, { label: 'Touring homes', purchaseOnly: true }, { label: 'Making offers', purchaseOnly: true }, { label: 'Offer accepted', purchaseOnly: true }],
  under_contract: [{ label: 'Option period', purchaseOnly: true }, { label: 'Application sent' }, { label: 'Disclosures sent' }, { label: 'Appraisal ordered' }, { label: 'Waiting on documents' }],
  processing: [{ label: 'Submitted' }, { label: 'In underwriting' }, { label: 'Conditions out' }, { label: 'Conditions submitted' }],
  clear_to_close: [{ label: 'Scheduling closing' }, { label: 'Closing scheduled' }, { label: 'Docs out' }],
  closed: [{ label: 'Waiting on funding' }, { label: 'Funded' }, { label: 'Review requested' }],
  nurture: [{ label: 'Working on credit' }, { label: 'Saving for down payment' }, { label: 'Waiting on lease or job' }, { label: 'Not ready yet' }],
  lost: [],
}

const forPurchase = (purpose: LoanPurpose) => purpose === 'purchase' || purpose === 'investment_dscr'

/** The choices for a stage and loan type, in the order shown. */
export function statusDetailChoices(stage: PipelineStage, purpose: LoanPurpose): string[] {
  return CHOICES[stage].filter((c) => !c.purchaseOnly || forPurchase(purpose)).map((c) => c.label)
}

/** The dropdown's options: the choices, plus the file's current detail if it isn't one of them (nothing is hidden). */
export function statusDetailOptions(stage: PipelineStage, purpose: LoanPurpose, current: string | null): string[] {
  const choices = statusDetailChoices(stage, purpose)
  return current && !choices.includes(current) ? [...choices, current] : choices
}
