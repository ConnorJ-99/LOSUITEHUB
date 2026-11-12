// On hold: a file waiting for a known reason (a refi waiting on a lease,
// rates, seasoning...) stays in its stage and shows in "On Hold Leads". The
// reason is picked from this list or typed. Pure.

export const HOLD_REASONS = [
  'Waiting on a lease or tenant',
  'Waiting on rates',
  'Title seasoning',
  'Repairs or appraisal',
  'Selling another home',
  'Job start or offer letter',
  'Divorce or legal paperwork',
  'Credit fixes',
] as const

interface HoldFile {
  stage: string
  onHoldAt: string | null
  stageChangedAt: string
}

/** Files on hold that are still open (not closed or lost), longest on hold first. */
export function onHoldLeads<F extends HoldFile>(files: F[]): F[] {
  return files.filter((f) => f.onHoldAt && f.stage !== 'closed' && f.stage !== 'lost').sort((a, b) => a.onHoldAt!.localeCompare(b.onHoldAt!))
}
