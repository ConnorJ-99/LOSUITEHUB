import type { StepStatus } from './display'

// The Workflow on a loan file: which steps are done, ready or blocked, and
// what to do next. Templates come from Settings (step_templates); what was
// marked comes from loan_steps; everything else is worked out here.

export type StepGroupId = 'origination' | 'disclosure_setup' | 'underwriting' | 'closing_funding'
export type StepOwner = 'loan_officer' | 'processor' | 'borrower' | 'lender' | 'title'
export type Milestone =
  | 'application'
  | 'disclosures_sent'
  | 'submitted'
  | 'in_underwriting'
  | 'approved_conditions'
  | 'conditions_submitted'
  | 'clear_to_close'
  | 'docs_out'
  | 'closed'
  | 'funded'

export const GROUPS: readonly { id: StepGroupId; label: string }[] = [
  { id: 'origination', label: 'Origination' },
  { id: 'disclosure_setup', label: 'Disclosure & Setup' },
  { id: 'underwriting', label: 'Underwriting' },
  { id: 'closing_funding', label: 'Closing & Funding' },
]

export const OWNER_LABEL: Record<StepOwner, string> = {
  loan_officer: 'Loan Officer',
  processor: 'Processor',
  borrower: 'Borrower',
  lender: 'Lender',
  title: 'Title',
}

export const MILESTONES: readonly { id: Milestone; label: string }[] = [
  { id: 'application', label: 'Application' },
  { id: 'disclosures_sent', label: 'Disclosures sent' },
  { id: 'submitted', label: 'Submitted' },
  { id: 'in_underwriting', label: 'In underwriting' },
  { id: 'approved_conditions', label: 'Approved w/ conditions' },
  { id: 'conditions_submitted', label: 'Conditions submitted' },
  { id: 'clear_to_close', label: 'Clear to close' },
  { id: 'docs_out', label: 'Docs out' },
  { id: 'closed', label: 'Closed' },
  { id: 'funded', label: 'Funded' },
]

export interface StepTemplate {
  key: string
  name: string
  group: StepGroupId
  owner: StepOwner
  /** Loan purposes it applies to; null = all. */
  purposes: string[] | null
  sortOrder: number
  requires: string[]
  ruleKey: string | null
  milestone: Milestone | null
  actionLabel: string | null
  /** A file section to open, e.g. "1003"; null = the button marks the step done. */
  actionTarget: string | null
}

export interface StepMark {
  stepKey: string
  status: 'done' | 'na'
  doneOn: string | null
}

/** Facts about the file that rules read. */
export interface WorkflowFacts {
  purpose: string
  /** Credit score, income and a housing payment are all known. */
  prequalReady: boolean
  urlaMissing: number
  urlaStarted: boolean
  hasContract: boolean
  hasLoanAmount: boolean
  hasRate: boolean
  /** A lender and program were chosen on Loan · Pricing (undefined = not known, e.g. older callers). */
  hasProgram?: boolean
  /** A pre-approval letter was issued (undefined = not known). */
  hasPreapprovalLetter?: boolean
  /** When the file entered its current stage (YYYY-MM-DD), for days at step. */
  stageSince: string
}

export interface StepResult extends StepTemplate {
  status: StepStatus
  /** Why it's blocked, or a short note (e.g. "2 fields missing"). */
  reason: string | null
  /** Done by the file's data rather than marked by hand. */
  auto: boolean
  doneOn: string | null
}

interface RuleResult {
  done?: boolean
  blocked?: string
  note?: string
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** Rules that complete or block steps from the file's data. Keys match step_templates.rule_key. */
const RULES: Record<string, (f: WorkflowFacts) => RuleResult> = {
  prequal: (f) => (f.prequalReady ? { done: true } : { note: 'Needs credit score, income and a payment' }),
  urla_complete: (f) => (f.urlaStarted && f.urlaMissing === 0 ? { done: true } : { note: f.urlaMissing ? `${plural(f.urlaMissing, 'required field')} missing` : 'Not started' }),
  contract: (f) => (f.hasContract ? { done: true } : {}),
  preapproval_letter: (f) => (f.hasPreapprovalLetter ? { done: true } : { note: 'Set the approved maximum and issue a letter on Letters' }),
  program_chosen: (f) => (f.hasProgram ? { done: true } : { note: 'Compare quotes on Loan · Pricing and choose one' }),
  ready_to_submit: (f) => {
    if (f.hasProgram === false) return { blocked: "Can't submit: no lender/program selected." }
    if (f.urlaMissing > 0) return { blocked: `Can't submit: the 1003 is missing ${plural(f.urlaMissing, 'required field')}.` }
    if (!f.hasLoanAmount || !f.hasRate) return { blocked: "Can't submit: the file needs a loan amount and rate." }
    return {}
  },
}

export interface Workflow {
  steps: StepResult[]
  groups: { id: StepGroupId; label: string; steps: StepResult[]; current: boolean }[]
  currentGroup: StepGroupId | null
  /** The single most important ready step. */
  next: StepResult | null
  /** Other ready steps (up to 4). */
  alsoReady: StepResult[]
  doneCount: number
  totalCount: number
}

/** Builds the Workflow: each applicable step's status, the current group, and what's next. */
export function buildWorkflow(templates: StepTemplate[], marks: StepMark[], facts: WorkflowFacts): Workflow {
  const applicable = templates
    .filter((t) => !t.purposes || t.purposes.includes(facts.purpose))
    .sort((a, b) => GROUPS.findIndex((g) => g.id === a.group) - GROUPS.findIndex((g) => g.id === b.group) || a.sortOrder - b.sortOrder)
  const markByKey = new Map(marks.map((m) => [m.stepKey, m]))

  // First pass: marks and rules. Second pass: "ready" once required steps are finished.
  const first = applicable.map((t) => {
    const mark = markByKey.get(t.key)
    const rule = t.ruleKey && RULES[t.ruleKey] ? RULES[t.ruleKey](facts) : {}
    if (mark?.status === 'na') return { t, status: 'na' as StepStatus, reason: null, auto: false, doneOn: null }
    if (mark?.status === 'done') return { t, status: 'done' as StepStatus, reason: null, auto: false, doneOn: mark.doneOn }
    if (rule.done) return { t, status: 'done' as StepStatus, reason: null, auto: true, doneOn: null }
    if (rule.blocked) return { t, status: 'blocked' as StepStatus, reason: rule.blocked, auto: false, doneOn: null }
    return { t, status: null, reason: rule.note ?? null, auto: false, doneOn: null }
  })
  const finished = new Set(first.filter((s) => s.status === 'done' || s.status === 'na').map((s) => s.t.key))
  // Required steps that don't apply to this file don't hold anything up.
  const known = new Set(applicable.map((t) => t.key))
  const steps: StepResult[] = first.map(({ t, status, reason, auto, doneOn }) => ({
    ...t,
    status: status ?? (t.requires.every((k) => finished.has(k) || !known.has(k)) ? 'ready' : 'not_started'),
    reason,
    auto,
    doneOn,
  }))

  const open = (s: StepResult) => s.status !== 'done' && s.status !== 'na'
  const currentGroup = GROUPS.find((g) => steps.some((s) => s.group === g.id && open(s)))?.id ?? null
  const ready = steps.filter((s) => s.status === 'ready')
  const next = ready.find((s) => s.group === currentGroup) ?? ready[0] ?? null
  const countable = steps.filter((s) => s.status !== 'na')
  return {
    steps,
    groups: GROUPS.map((g) => ({ ...g, steps: steps.filter((s) => s.group === g.id), current: g.id === currentGroup })).filter((g) => g.steps.length > 0),
    currentGroup,
    next,
    alsoReady: ready.filter((s) => s !== next).slice(0, 4),
    doneCount: countable.filter((s) => s.status === 'done').length,
    totalCount: countable.length,
  }
}

const dayNumber = (iso: string) => Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000)

/** Whole days the file has waited at its current step: since the last step was done, or since it entered its stage. */
export function daysWaiting(marks: StepMark[], stageSince: string, today: string): number {
  const lastDone = marks
    .map((m) => m.doneOn)
    .filter((d): d is string => !!d)
    .sort()
    .at(-1)
  const since = lastDone && lastDone > stageSince ? lastDone : stageSince
  return Math.max(0, dayNumber(today) - dayNumber(since))
}

export interface MilestoneView {
  id: Milestone
  label: string
  state: 'done' | 'current' | 'future'
  date: string | null
}

/**
 * The stepper: reached milestones are done with their dates; earlier ones
 * that were skipped count as passed (no date); the next one is current.
 */
export function milestoneView(reached: { milestone: Milestone; reachedOn: string }[]): MilestoneView[] {
  const byId = new Map(reached.map((r) => [r.milestone, r.reachedOn]))
  const lastReached = MILESTONES.reduce((last, m, i) => (byId.has(m.id) ? i : last), -1)
  return MILESTONES.map((m, i) => ({
    id: m.id,
    label: m.label,
    state: byId.has(m.id) || i < lastReached ? 'done' : i === lastReached + 1 ? 'current' : 'future',
    date: byId.get(m.id) ?? null,
  }))
}
