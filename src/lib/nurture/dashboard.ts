// The Nurture dashboard's numbers (Connor, 2026-11-16; plan
// docs/plans/buyer-nurture.md Step 9). Worked out from the files you can see
// (a loan officer sees their own, the admin login sees every file); nothing
// is stored. Pure, tested.
import { obstacleGroup, obstacleLabel, type NurtureStage } from './obstacles'

export interface DashFile {
  loanId: string
  borrower: string
  loId: string | null
  stage: NurtureStage | null
  enteredAt: string | null
  obstacles: string[]
  nextFollowUp: string | null
}

export interface DashMilestone {
  loanId: string
  /** On an action (the plan's real steps), not a plan-wide timeline line. */
  onAction: boolean
  done: boolean
  targetDate: string | null
}

export interface DashPlan {
  loanId: string
  status: 'draft' | 'approved' | 'superseded'
}

/** A nurture check-in that was sent (or approved), and whether they wrote back. */
export interface DashCheckIn {
  loanId: string
  kind: string
  sentAt: string
}

export interface DashExit {
  loanId: string
  loId: string | null
  /** When it went into Nurture (the latest move in before this exit), if known. */
  enteredAt: string | null
  leftAt: string
  toStage: string
  /** Where the file is today. */
  stageNow: string
}

export interface DashInput {
  today: string
  files: DashFile[]
  plans: DashPlan[]
  milestones: DashMilestone[]
  /** Loans whose roadmap went out (stage log or a later stage). */
  delivered: Set<string>
  /** Open (unverified or unread) updates per loan. */
  openUpdates: Map<string, number>
  checkIns: DashCheckIn[]
  /** When each borrower wrote in, per loan (ISO times). */
  inbound: Map<string, string[]>
  exits: DashExit[]
  loId: string | null
}

export interface AttentionRow {
  loanId: string
  borrower: string
  reasons: string[]
  /** Higher sorts first. */
  weight: number
}

export interface CloseRow {
  loanId: string
  borrower: string
  why: string
  done: number
  total: number
}

const DAY = 86_400_000
const days = (from: string, to: string) => Math.max(0, Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY))
const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null)
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : null)
const LATER_THAN_DELIVERED: (NurtureStage | null)[] = ['plan_delivered', 'working', 'waiting_milestone', 'ready_reassess', 'ready_prequal']
/** A reply counts when it comes within this many days of a check-in. */
export const RESPONSE_DAYS = 7
/** Check-ins counted for the response rate. */
export const RESPONSE_WINDOW_DAYS = 90

export function nurtureDashboard(i: DashInput) {
  const files = i.files.filter((f) => !i.loId || f.loId === i.loId)
  const ids = new Set(files.map((f) => f.loanId))
  const approved = new Set(i.plans.filter((p) => p.status === 'approved' && ids.has(p.loanId)).map((p) => p.loanId))
  const delivered = files.filter((f) => i.delivered.has(f.loanId) || LATER_THAN_DELIVERED.includes(f.stage)).length

  // By obstacle group, and the most common single obstacles.
  const byGroup = new Map<string, number>()
  const byObstacle = new Map<string, number>()
  for (const f of files) {
    for (const g of new Set(f.obstacles.map(obstacleGroup))) byGroup.set(g, (byGroup.get(g) ?? 0) + 1)
    for (const o of f.obstacles) byObstacle.set(o, (byObstacle.get(o) ?? 0) + 1)
  }
  const byStage = new Map<string, number>()
  for (const f of files) byStage.set(f.stage ?? 'initial_review', (byStage.get(f.stage ?? 'initial_review') ?? 0) + 1)

  // Milestones on the approved plans of files in Nurture now.
  const ms = i.milestones.filter((m) => ids.has(m.loanId) && approved.has(m.loanId))
  const outstanding = ms.filter((m) => !m.done)
  const overdue = outstanding.filter((m) => m.targetDate && m.targetDate < i.today)

  // Response rate: check-ins in the last 90 days answered within 7 days.
  const since = new Date(Date.parse(i.today) - RESPONSE_WINDOW_DAYS * DAY).toISOString()
  const recent = i.checkIns.filter((c) => c.sentAt >= since && (!i.loId || files.some((f) => f.loanId === c.loanId) || i.exits.some((e) => e.loanId === c.loanId && e.loId === i.loId)))
  const answered = recent.filter((c) => (i.inbound.get(c.loanId) ?? []).some((t) => t > c.sentAt && Date.parse(t) - Date.parse(c.sentAt) <= RESPONSE_DAYS * DAY))
  const reassessAsks = recent.filter((c) => c.kind === 'reassess').length

  // Files that left Nurture (each file once, its latest exit).
  const latest = new Map<string, DashExit>()
  for (const e of i.exits) if (!i.loId || e.loId === i.loId) if (!latest.get(e.loanId) || latest.get(e.loanId)!.leftAt < e.leftAt) latest.set(e.loanId, e)
  const exits = [...latest.values()]
  const toActive = exits.filter((e) => e.toStage !== 'lost')
  const funded = exits.filter((e) => e.stageNow === 'closed')

  // Needs attention / getting close.
  const attention: AttentionRow[] = []
  const close: CloseRow[] = []
  for (const f of files) {
    const mine = ms.filter((m) => m.loanId === f.loanId)
    const late = mine.filter((m) => !m.done && m.targetDate && m.targetDate < i.today).length
    const updates = i.openUpdates.get(f.loanId) ?? 0
    const reasons: string[] = []
    let weight = 0
    if (updates) (reasons.push(`${updates} update${updates === 1 ? '' : 's'} to verify`), (weight += 4))
    if (late) (reasons.push(`${late} milestone${late === 1 ? '' : 's'} overdue`), (weight += 3))
    if (f.nextFollowUp && f.nextFollowUp < i.today) (reasons.push(`Follow-up was due ${f.nextFollowUp}`), (weight += 2))
    if ((f.stage === 'initial_review' || f.stage === 'plan_needed' || !f.stage) && !approved.has(f.loanId) && f.enteredAt && days(f.enteredAt, i.today) >= 7) {
      reasons.push(`No plan yet, ${days(f.enteredAt, i.today)} days in Nurture`)
      weight += 1
    }
    if (reasons.length) attention.push({ loanId: f.loanId, borrower: f.borrower, reasons, weight })
    const steps = mine.filter((m) => m.onAction)
    const done = steps.filter((m) => m.done).length
    if (f.stage === 'ready_reassess' || f.stage === 'ready_prequal') close.push({ loanId: f.loanId, borrower: f.borrower, why: f.stage === 'ready_prequal' ? 'Ready for prequal' : 'Ready for reassessment', done, total: steps.length })
    else if (steps.length && done / steps.length >= 0.75) close.push({ loanId: f.loanId, borrower: f.borrower, why: `${done} of ${steps.length} milestones done`, done, total: steps.length })
  }
  attention.sort((a, b) => b.weight - a.weight || a.borrower.localeCompare(b.borrower))
  close.sort((a, b) => (b.total ? b.done / b.total : 1) - (a.total ? a.done / a.total : 1) || a.borrower.localeCompare(b.borrower))

  return {
    active: files.length,
    byGroup: [...byGroup.entries()].sort((a, b) => b[1] - a[1]),
    topObstacles: [...byObstacle.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([key, n]) => ({ key, label: obstacleLabel(key), n })),
    byStage,
    plansApproved: approved.size,
    plansDelivered: delivered,
    milestonesOutstanding: outstanding.length,
    milestonesOverdue: overdue.length,
    checkInsSent: recent.length,
    checkInsAnswered: answered.length,
    responsePct: pct(answered.length, recent.length),
    reassessAsks,
    readyToReassess: files.filter((f) => f.stage === 'ready_reassess').length,
    leftNurture: exits.length,
    toActive: toActive.length,
    funded: funded.length,
    toActivePct: pct(toActive.length, exits.length),
    fundedPct: pct(funded.length, exits.length),
    avgDaysNow: avg(files.filter((f) => f.enteredAt).map((f) => days(f.enteredAt!, i.today))),
    avgDaysToLeave: avg(exits.filter((e) => e.enteredAt).map((e) => days(e.enteredAt!, e.leftAt))),
    attention,
    close,
  }
}

export type NurtureDashboard = ReturnType<typeof nurtureDashboard>

/**
 * Stage history → exits: each move out of Nurture, with the move in before
 * it. Rows are { loanId, from, to, at }, any order.
 */
export function exitsFrom(history: { loanId: string; from: string | null; to: string; at: string }[], loans: Map<string, { loId: string | null; stageNow: string }>): DashExit[] {
  const out: DashExit[] = []
  const byLoan = new Map<string, typeof history>()
  for (const h of history) byLoan.set(h.loanId, [...(byLoan.get(h.loanId) ?? []), h])
  for (const [loanId, rows] of byLoan) {
    const sorted = [...rows].sort((a, b) => a.at.localeCompare(b.at))
    let enteredAt: string | null = null
    for (const r of sorted) {
      if (r.to === 'nurture') enteredAt = r.at
      else if (r.from === 'nurture') {
        const l = loans.get(loanId)
        out.push({ loanId, loId: l?.loId ?? null, enteredAt, leftAt: r.at, toStage: r.to, stageNow: l?.stageNow ?? r.to })
        enteredAt = null
      }
    }
  }
  return out
}
