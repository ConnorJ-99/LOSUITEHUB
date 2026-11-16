// Buyer Readiness Plans (Connor, 2026-11-16; plan docs/plans/buyer-nurture.md
// Step 4): the plan as the editor holds it, a starter plan built in code from
// the obstacles (no AI, or the AI's fallback), checks before saving or
// approving, and the shape save_readiness_draft() takes. Pure, tested.
import { addDays } from '@/lib/closed/keyDates'
import { obstacleLabel } from './obstacles'

export interface MilestoneDraft {
  key: string
  id?: string
  title: string
  measure: string
  targetDate: string | null
  followUpDate: string | null
  status?: 'outstanding' | 'done'
}

export interface ActionDraft {
  key: string
  obstacle: string | null
  title: string
  why: string
  steps: string[]
  docs: string[]
  status: 'not_started' | 'in_progress' | 'done'
  milestones: MilestoneDraft[]
}

export interface PlanDraft {
  intro: string
  goal: string
  reviewOn: string | null
  actions: ActionDraft[]
  /** Plan-wide milestones (the timeline, e.g. "Month 3: reassess"). */
  milestones: MilestoneDraft[]
}

let n = 0
export const newKey = () => `k${Date.now().toString(36)}${(n++).toString(36)}`

/** A check-in a few days before the target date (never before today). */
export function followUpFor(target: string | null, today: string): string | null {
  if (!target) return null
  const d = addDays(target, -3)
  return d < today ? today : d
}

interface Template {
  title: string
  why: string
  steps: string[]
  docs: string[]
  milestone: { title: string; measure: string; weeks: number }
}

// Plain English, no promises (no score, approval or date guarantees).
const TEMPLATES: Record<string, Template> = {
  credit_score_low: { title: 'Build your credit score', why: 'Loan programs have a minimum credit score, and a higher score can open more options.', steps: ['Pay every account on time, every month', 'Keep card balances low compared to their limits', 'Avoid opening new credit for now'], docs: ['Updated credit report when we reassess'], milestone: { title: 'Three months of on-time payments', measure: 'No late payments on any account', weeks: 12 } },
  credit_recent_lates: { title: 'Rebuild on-time payment history', why: 'Lenders look closely at the last 12 months of payment history.', steps: ['Set up automatic payments for every account', 'Bring any past-due account current'], docs: ['Statements showing accounts are current'], milestone: { title: 'All accounts current', measure: 'No past-due balances', weeks: 4 } },
  credit_collections: { title: 'Deal with collections and charge-offs', why: 'Some programs need collections paid or settled, and they can affect your score.', steps: ['List each collection with the creditor and amount', 'Talk with me before paying anything, so we pick the right order', 'Get any settlement in writing'], docs: ['Paid or settled letters from each creditor'], milestone: { title: 'Collections plan agreed', measure: 'We know which ones to handle first', weeks: 2 } },
  credit_utilization: { title: 'Lower your card balances', why: 'High balances compared to your limits can lower your score and raise your monthly debts.', steps: ['Pay down the cards closest to their limits first', 'Keep cards open after paying them down'], docs: ['Current card statements'], milestone: { title: 'Card balances lowered', measure: 'Each card well under its limit', weeks: 8 } },
  credit_limited_history: { title: 'Build credit history', why: 'Lenders need enough history to see how you handle credit.', steps: ['Keep any existing accounts open and in good standing', 'Ask me about adding a secured card or reporting rent'], docs: ['Rent payment history, if available'], milestone: { title: 'New account in good standing', measure: 'At least one account reporting on time', weeks: 12 } },
  credit_errors: { title: 'Fix credit report errors', why: 'Errors can hold your score down or show debts that aren’t yours.', steps: ['Pull your free reports and mark anything wrong', 'File disputes with the credit bureaus', 'Keep copies of everything you send'], docs: ['Dispute letters and the bureau responses'], milestone: { title: 'Disputes filed', measure: 'Each error disputed with the bureau', weeks: 3 } },
  debt_dti_high: { title: 'Lower your monthly debt payments', why: 'Lenders compare your monthly debts to your income; lower payments leave more room for a house payment.', steps: ['List every monthly payment', 'Focus on paying off the smallest balances first', 'Avoid new monthly payments'], docs: ['Statements for the accounts you pay down'], milestone: { title: 'One payment gone', measure: 'At least one monthly payment paid off', weeks: 8 } },
  debt_revolving: { title: 'Pay down revolving balances', why: 'Card balances add to your monthly debts and can affect your score.', steps: ['Pick one card to pay down first', 'Stop adding new charges to it'], docs: ['Current card statements'], milestone: { title: 'First card paid down', measure: 'Balance lowered on the card you picked', weeks: 8 } },
  debt_monthly: { title: 'Trim monthly obligations', why: 'Every monthly payment counts against what you can qualify for.', steps: ['Review each monthly payment with me', 'Avoid any new loans or leases'], docs: ['Statements for each monthly payment'], milestone: { title: 'Payments reviewed', measure: 'We know which payment to tackle first', weeks: 2 } },
  debt_student_loans: { title: 'Sort out student loan payments', why: 'How your student loan payment shows up changes how much of it counts.', steps: ['Log in to your servicer and check your payment plan', 'Send me the current statement showing the payment'], docs: ['Current student loan statement'], milestone: { title: 'Payment confirmed', measure: 'Statement shows the monthly payment', weeks: 3 } },
  debt_auto_loan: { title: 'Plan around the auto loan', why: 'A car payment counts against what you can qualify for.', steps: ['Keep the loan current', 'Avoid trading in or adding another car loan before buying'], docs: ['Current auto loan statement'], milestone: { title: 'Auto loan reviewed', measure: 'We know how it fits the plan', weeks: 2 } },
  income_insufficient: { title: 'Grow or document more income', why: 'Your income sets how big a payment you can qualify for.', steps: ['Tell me about any raises, overtime or side income', 'Keep records of any new income'], docs: ['Recent pay stubs'], milestone: { title: 'Income update', measure: 'New pay stubs showing current income', weeks: 8 } },
  income_short_history: { title: 'Build time on the job', why: 'Lenders usually look for steady income over time.', steps: ['Stay with your current employer', 'Keep your pay stubs as you go'], docs: ['Pay stubs', 'Offer letter, if new'], milestone: { title: 'More time on the job', measure: 'Pay stubs covering the added months', weeks: 12 } },
  income_self_employed_docs: { title: 'Get your business paperwork ready', why: 'Self-employed income is shown through tax returns and business records.', steps: ['Get your last two years of tax returns together', 'Keep a profit and loss statement for this year'], docs: ['Two years of personal and business tax returns', 'Year-to-date profit and loss'], milestone: { title: 'Returns gathered', measure: 'Both years of returns sent to me', weeks: 4 } },
  income_variable: { title: 'Show steady variable income', why: 'Overtime, bonus and commission usually need a track record.', steps: ['Keep your pay stubs and W-2s', 'Let me know if your hours or pay change'], docs: ['Pay stubs', 'W-2s for the last two years'], milestone: { title: 'Income history gathered', measure: 'Stubs and W-2s sent', weeks: 4 } },
  income_missing_docs: { title: 'Gather income documents', why: 'Every income we count has to be documented.', steps: ['Collect the documents on your list', 'Upload them through your portal'], docs: ['Pay stubs', 'W-2s', 'Award letters, if any'], milestone: { title: 'Income documents in', measure: 'Everything on the list uploaded', weeks: 2 } },
  assets_down_payment: { title: 'Save for the down payment', why: 'You need your down payment in an account you can document.', steps: ['Set a monthly savings amount', 'Keep the money in one account', 'Ask me about down payment help programs'], docs: ['Two months of statements for the savings account'], milestone: { title: 'Savings goal on track', measure: 'Statements show the savings growing', weeks: 8 } },
  assets_closing_funds: { title: 'Save for closing costs', why: 'Closing costs are paid at closing on top of the down payment.', steps: ['Add a set amount to savings each month', 'Ask me about seller credits when you shop'], docs: ['Two months of statements'], milestone: { title: 'Closing funds on track', measure: 'Statements show the savings growing', weeks: 8 } },
  assets_missing_docs: { title: 'Gather account statements', why: 'Lenders verify the money you’ll use with full statements.', steps: ['Download full statements with every page', 'Upload them through your portal'], docs: ['Two months of statements for each account'], milestone: { title: 'Statements in', measure: 'All pages of each statement uploaded', weeks: 2 } },
  assets_unverified_deposits: { title: 'Explain large deposits', why: 'Large deposits need a paper trail before that money can count.', steps: ['Note where each large deposit came from', 'Avoid cash deposits from here on'], docs: ['Paper trail for each large deposit'], milestone: { title: 'Deposits explained', measure: 'Each deposit sourced', weeks: 2 } },
  assets_reserves: { title: 'Build reserves', why: 'Some programs want savings left over after closing.', steps: ['Keep extra savings after the down payment and costs'], docs: ['Recent statements'], milestone: { title: 'Reserves building', measure: 'Statements show money left over', weeks: 12 } },
  other_lease: { title: 'Line up timing with your lease', why: 'Your lease end date shapes when it makes sense to buy.', steps: ['Send me your lease end date', 'Plan the purchase around it'], docs: ['Current lease'], milestone: { title: 'Timing planned', measure: 'Lease date and target date agreed', weeks: 2 } },
  other_buying_later: { title: 'Get ready ahead of your timeline', why: 'Starting early means fewer surprises when you are ready to buy.', steps: ['Keep your credit and savings steady', 'Check in with me before big purchases'], docs: [], milestone: { title: 'Check-in', measure: 'Quick update on your plans', weeks: 8 } },
  other_sell_home: { title: 'Plan the sale of your current home', why: 'Selling first can free up money and lower your monthly debts.', steps: ['Talk with a realtor about value and timing', 'Send me your current mortgage statement'], docs: ['Current mortgage statement'], milestone: { title: 'Sale plan in place', measure: 'Listing timeline set with your realtor', weeks: 4 } },
}

function templateFor(obstacle: string): Template {
  return (
    TEMPLATES[obstacle] ?? {
      title: obstacleLabel(obstacle),
      why: 'This is one of the things to sort out before you’re ready to buy.',
      steps: ['We’ll work out the next step together'],
      docs: [],
      milestone: { title: `${obstacleLabel(obstacle)}: progress check`, measure: 'Update on where this stands', weeks: 4 },
    }
  )
}

/** A starter plan from the obstacles: one action and milestone each, plus a 3-month reassessment. */
export function starterPlan(obstacles: string[], facts: { firstName: string; target: string | null }, today: string): PlanDraft {
  const actions: ActionDraft[] = obstacles.map((o) => {
    const t = templateFor(o)
    const target = addDays(today, t.milestone.weeks * 7)
    return {
      key: newKey(),
      obstacle: o,
      title: t.title,
      why: t.why,
      steps: [...t.steps],
      docs: [...t.docs],
      status: 'not_started',
      milestones: [{ key: newKey(), title: t.milestone.title, measure: t.milestone.measure, targetDate: target, followUpDate: followUpFor(target, today) }],
    }
  })
  const review = addDays(today, 90)
  return {
    intro: `${facts.firstName ? `${facts.firstName}, here` : 'Here'} is your plan to get ready to buy. We'll work through it together and check in along the way.`,
    goal: facts.target ? `Buy a home (${facts.target})` : 'Buy a home',
    reviewOn: review,
    actions,
    milestones: [{ key: newKey(), title: 'Reassess together', measure: 'Review progress and update the plan', targetDate: review, followUpDate: followUpFor(review, today) }],
  }
}

// What a plan the borrower sees must never say.
const BANNED: [RegExp, string][] = [
  [/guarantee/i, 'promises a guarantee'],
  [/\b(will|going to)\s+(be\s+)?(approved|qualify|qualified|eligible)/i, 'promises approval or eligibility'],
  [/\b(score|credit)\b[^.]{0,40}\b(will|going to)\s+(go up|increase|rise|improve|reach|hit)/i, 'promises a credit score change'],
  [/\b(raise|boost|increase)\s+your\s+(credit\s+)?score\s+(to|by)\s+\d/i, 'promises a credit score change'],
  [/\bapproved\s+by\b|\beligible\s+by\b|\bqualif(y|ied)\s+by\b/i, 'promises an approval date'],
]

/** Problems that keep a plan from being saved or approved (empty = fine). */
export function planProblems(plan: PlanDraft, forApproval = false): string[] {
  const out: string[] = []
  if (!plan.actions.length) out.push('Add at least one action.')
  plan.actions.forEach((a, i) => {
    if (!a.title.trim()) out.push(`Action ${i + 1} needs a title.`)
    a.milestones.forEach((m, j) => {
      if (!m.title.trim()) out.push(`Action ${i + 1}, milestone ${j + 1} needs a title.`)
    })
  })
  plan.milestones.forEach((m, j) => {
    if (!m.title.trim()) out.push(`Timeline milestone ${j + 1} needs a title.`)
  })
  const allMilestones = [...plan.actions.flatMap((a) => a.milestones), ...plan.milestones]
  if (forApproval && !allMilestones.length) out.push('Add at least one milestone.')
  if (forApproval && allMilestones.some((m) => !m.targetDate)) out.push('Every milestone needs a target date before approving.')
  const text = [plan.intro, plan.goal, ...plan.actions.flatMap((a) => [a.title, a.why, ...a.steps, ...a.milestones.flatMap((m) => [m.title, m.measure])]), ...plan.milestones.flatMap((m) => [m.title, m.measure])].join('\n')
  for (const [re, why] of BANNED) if (re.test(text)) out.push(`The plan ${why}. Reword it: no promises of approval, scores or dates.`)
  return [...new Set(out)]
}

/** The JSON save_readiness_draft() takes. */
export function planPayload(plan: PlanDraft) {
  const ms = (m: MilestoneDraft) => ({ title: m.title.trim(), measure: m.measure.trim(), targetDate: m.targetDate, followUpDate: m.followUpDate })
  return {
    intro: plan.intro.trim(),
    goal: plan.goal.trim(),
    reviewOn: plan.reviewOn,
    actions: plan.actions.map((a) => ({ obstacle: a.obstacle, title: a.title.trim(), why: a.why.trim(), steps: a.steps.filter((s) => s.trim()), docs: a.docs.filter((d) => d.trim()), status: a.status, milestones: a.milestones.map(ms) })),
    milestones: plan.milestones.map(ms),
  }
}

/** Outstanding, done, and overdue milestones in a plan. */
export function milestoneCounts(plan: PlanDraft, today: string) {
  const all = [...plan.actions.flatMap((a) => a.milestones), ...plan.milestones]
  const done = all.filter((m) => m.status === 'done').length
  const overdue = all.filter((m) => m.status !== 'done' && m.targetDate && m.targetDate < today).length
  return { total: all.length, done, outstanding: all.length - done, overdue }
}
