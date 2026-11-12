// The borrower portal (docs/plans/borrower-portal.md): its steps, the
// borrower's words for document and home-request statuses, and the shapes the
// document-upload Edge Function returns. Pure, with no imports, so the
// function (Deno), the public page, MPS-HQ's Settings and the tests share it.
// (No imports at all: the paste builder needs that. ItemStatus matches rules.ts.)

type ItemStatus = 'requested' | 'received' | 'reviewed' | 'rejected' | 'waived'

export const PORTAL_LINK_DAYS = 90

// ---------------------------------------------------------------------------
// Status stepper
// ---------------------------------------------------------------------------

export type PortalStep = 'application_received' | 'in_review' | 'submitted' | 'conditions' | 'clear_to_close' | 'closed'

export const PORTAL_STEPS: readonly { id: PortalStep; label: string; message: string }[] = [
  { id: 'application_received', label: 'Application received', message: "We have your information and we're getting your file started." },
  { id: 'in_review', label: 'In review', message: "We're reviewing your file and documents." },
  { id: 'submitted', label: 'Submitted to underwriting', message: 'Your file is with the underwriter for review.' },
  { id: 'conditions', label: 'Conditions', message: 'The underwriter approved your loan with a few conditions. Please upload anything still needed below.' },
  { id: 'clear_to_close', label: 'Clear to close', message: "You're clear to close! We'll confirm your closing date and time." },
  { id: 'closed', label: 'Closed', message: 'Congratulations, your loan has closed!' },
]

/** Pipeline stages and processing milestones, as the database names them. */
export type PortalStage = 'lead' | 'contacted' | 'pre_qualified' | 'pre_approved' | 'home_search' | 'under_contract' | 'processing' | 'clear_to_close' | 'closed' | 'nurture' | 'lost'
export type PortalMilestone = 'application' | 'disclosures_sent' | 'submitted' | 'in_underwriting' | 'approved_conditions' | 'conditions_submitted' | 'clear_to_close' | 'docs_out' | 'closed' | 'funded'

const IN_REVIEW_STAGES: PortalStage[] = ['pre_qualified', 'pre_approved', 'home_search', 'under_contract']

/** The borrower's current step: the furthest one the stage or a reached milestone shows. */
export function portalStep(stage: PortalStage, milestones: PortalMilestone[]): PortalStep {
  const has = (...m: PortalMilestone[]) => m.some((x) => milestones.includes(x))
  if (stage === 'closed' || has('closed', 'funded')) return 'closed'
  if (stage === 'clear_to_close' || has('clear_to_close', 'docs_out')) return 'clear_to_close'
  if (has('approved_conditions', 'conditions_submitted')) return 'conditions'
  if (stage === 'processing' || has('submitted', 'in_underwriting')) return 'submitted'
  if (IN_REVIEW_STAGES.includes(stage) || has('application', 'disclosures_sent')) return 'in_review'
  return 'application_received'
}

/** The line under the current step: Connor's wording from Settings, else the default. */
export function stepMessage(step: PortalStep, custom: Record<string, unknown> | null | undefined): string {
  const typed = custom?.[step]
  return typeof typed === 'string' && typed.trim() ? typed.trim() : PORTAL_STEPS.find((s) => s.id === step)!.message
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export type BorrowerDocStatus = 'Needed' | 'Under review' | 'Accepted' | 'Needs replacement'

export function borrowerDocStatus(s: ItemStatus): BorrowerDocStatus | null {
  switch (s) {
    case 'requested':
      return 'Needed'
    case 'received':
      return 'Under review'
    case 'reviewed':
      return 'Accepted'
    case 'rejected':
      return 'Needs replacement'
    default:
      return null
  }
}

/** Progress: items in (under review or accepted) out of all items asked for. */
export function docProgress(items: { status: ItemStatus }[]): { done: number; total: number; pct: number } {
  const asked = items.filter((i) => i.status !== 'waived')
  const done = asked.filter((i) => i.status === 'received' || i.status === 'reviewed').length
  return { done, total: asked.length, pct: asked.length ? Math.round((done / asked.length) * 100) : 0 }
}

// ---------------------------------------------------------------------------
// Letters, estimates and home requests
// ---------------------------------------------------------------------------

export type PublishedKind = 'preapproval_letter' | 'fee_worksheet' | 'loan_comparison'
export const PUBLISHED_KIND_LABEL: Record<PublishedKind, string> = { preapproval_letter: 'Pre-approval letter', fee_worksheet: 'Payment estimate', loan_comparison: 'Loan options' }

export interface PortalDoc {
  id: string
  kind: PublishedKind
  name: string
  propertyId: string | null
  publishedAt: string
}

export type RequestStatus = 'requested' | 'in_progress' | 'ready' | 'closed'
export const REQUEST_STATUS_LABEL: Record<RequestStatus, string> = { requested: 'Requested', in_progress: 'In progress', ready: 'Ready', closed: 'Closed' }

export interface PortalHome {
  /** The home on the file (null for a request whose home was removed). */
  propertyId: string | null
  address: string
  price: number | null
  /** Set when the borrower asked for numbers on it. */
  request: { id: string; status: RequestStatus; wantsLetter: boolean; wantsEstimate: boolean; createdAt: string } | null
  docs: PortalDoc[]
}

/** Published documents grouped by home (homes with a request or a document); documents with no home go last under "General". */
export function groupByHome(
  homes: { id: string; address: string; price: number | null }[],
  requests: { id: string; propertyId: string | null; address: string; price: number; status: RequestStatus; wantsLetter: boolean; wantsEstimate: boolean; createdAt: string }[],
  docs: PortalDoc[],
): PortalHome[] {
  const out: PortalHome[] = []
  for (const h of homes) {
    const req = requests.filter((r) => r.propertyId === h.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
    const mine = docs.filter((d) => d.propertyId === h.id)
    if (!req && mine.length === 0) continue
    out.push({ propertyId: h.id, address: h.address, price: req?.price ?? h.price, request: req && { id: req.id, status: req.status, wantsLetter: req.wantsLetter, wantsEstimate: req.wantsEstimate, createdAt: req.createdAt }, docs: mine })
  }
  for (const r of requests.filter((x) => !x.propertyId)) out.push({ propertyId: null, address: r.address, price: r.price, request: { id: r.id, status: r.status, wantsLetter: r.wantsLetter, wantsEstimate: r.wantsEstimate, createdAt: r.createdAt }, docs: [] })
  const general = docs.filter((d) => !d.propertyId || !homes.some((h) => h.id === d.propertyId))
  if (general.length) out.push({ propertyId: null, address: 'General', price: null, request: null, docs: general })
  return out
}

export interface HomeRequestInput {
  address: string
  city: string
  state: string
  zip: string
  price: number | null
  downMode: 'amount' | 'percent'
  down: number | null
  wantsLetter: boolean
  wantsEstimate: boolean
  notes: string
}

/** What's wrong with a home request before it's sent (null = fine). */
export function homeRequestProblem(r: HomeRequestInput): string | null {
  if (!r.address.trim()) return 'Enter the address.'
  if (r.state.trim() && !/^[A-Za-z]{2}$/.test(r.state.trim())) return 'Use the two-letter state, like TX.'
  if (r.zip.trim() && !/^\d{5}$/.test(r.zip.trim())) return 'Use a 5-digit ZIP code.'
  if (!r.price || r.price <= 0) return 'Enter the price.'
  if (r.down != null && r.down < 0) return "The down payment can't be negative."
  if (r.downMode === 'percent' && r.down != null && r.down > 100) return 'The down payment percent must be 100 or less.'
  if (r.downMode === 'amount' && r.down != null && r.down > r.price) return "The down payment can't be more than the price."
  if (!r.wantsLetter && !r.wantsEstimate) return 'Pick a pre-approval letter, a payment estimate, or both.'
  if (r.notes.length > 1000) return 'Keep the notes under 1,000 characters.'
  return null
}

/** The portal's sections beyond the document items and the loan officer's card (which the reply carries as for any link). */
export interface PortalView {
  borrowerFirstName: string
  step: PortalStep
  stepMessage: string
  homes: PortalHome[]
  isPurchase: boolean
}
