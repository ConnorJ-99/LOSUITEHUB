// "Your Roadmap to Homeownership" (Connor, 2026-11-16; plan
// docs/plans/buyer-nurture.md Step 5): what the 3–5 page PDF says, worked out
// from the APPROVED Buyer Readiness Plan only. The PDF component lays it out.
// Pure, tested. No rates, payments or loan amounts.
import { formatIsoDate } from '@/lib/dates'
import { obstacleLabel, obstacleGroup } from '@/lib/nurture/obstacles'
import type { PlanDraft } from '@/lib/nurture/plan'

export const ROADMAP_TEMPLATE = 'readiness-roadmap v1'

export const ROADMAP_DISCLOSURE =
  'This roadmap is an educational planning tool only. It is not a loan approval, a commitment to lend, a guarantee of any credit outcome, or a guarantee of future eligibility for any loan program. Loan approval depends on a full application, verification of your information, and the lender’s underwriting guidelines at that time. Program guidelines change.'

const GROUP_WORDS: Record<ReturnType<typeof obstacleGroup>, string> = {
  credit: 'Credit',
  debt: 'Debt',
  income: 'Income and employment',
  assets: 'Savings and assets',
  other: 'Timing and other',
}

export interface RoadmapInput {
  borrowerName: string
  firstName: string
  loName: string
  loPhone: string | null
  loEmail: string | null
  preparedOn: string
  version: number
  timeframe: string | null
  plan: PlanDraft
  obstacles: string[]
}

export interface RoadmapView {
  borrower: string
  preparedOn: string
  version: number
  goal: string
  timeframe: string
  intro: string
  readiness: { group: string; items: string[] }[]
  actions: { n: number; title: string; why: string; steps: string[]; check: string[] }[]
  timeline: { date: string; title: string; measure: string; done: boolean }[]
  outstanding: string[]
  reviewOn: string | null
  contact: string
  howToUpdate: string
  reassessment: string
  disclosure: string
}

/** The roadmap's contents (titles, words and dates from the approved plan). */
export function roadmapView(i: RoadmapInput): RoadmapView {
  const groups = new Map<string, string[]>()
  for (const o of i.obstacles) {
    const g = GROUP_WORDS[obstacleGroup(o)]
    groups.set(g, [...(groups.get(g) ?? []), obstacleLabel(o)])
  }
  const all = [...i.plan.actions.flatMap((a) => a.milestones.map((m) => ({ ...m, action: a.title }))), ...i.plan.milestones.map((m) => ({ ...m, action: null as string | null }))]
  const timeline = all
    .filter((m) => m.title.trim())
    .sort((a, b) => (a.targetDate ?? '9999').localeCompare(b.targetDate ?? '9999'))
    .map((m) => ({ date: m.targetDate ? formatIsoDate(m.targetDate) : 'To be set', title: m.title, measure: m.measure, done: m.status === 'done' }))
  return {
    borrower: i.borrowerName,
    preparedOn: formatIsoDate(i.preparedOn),
    version: i.version,
    goal: i.plan.goal || 'Buy a home',
    timeframe: i.timeframe || 'As you’re ready',
    intro: i.plan.intro || `${i.firstName ? `${i.firstName}, this` : 'This'} roadmap lays out the steps we agreed on to get you ready to buy.`,
    readiness: [...groups.entries()].map(([group, items]) => ({ group, items })),
    actions: i.plan.actions.map((a, n) => ({
      n: n + 1,
      title: a.title,
      why: a.why,
      steps: a.steps.filter((s) => s.trim()),
      check: [...a.milestones.map((m) => (m.measure ? `${m.title}: ${m.measure}` : m.title)), ...(a.docs.length ? [`Documents: ${a.docs.join(', ')}`] : [])],
    })),
    timeline,
    outstanding: all.filter((m) => m.status !== 'done' && m.title.trim()).map((m) => (m.targetDate ? `${m.title} (by ${formatIsoDate(m.targetDate)})` : m.title)),
    reviewOn: i.plan.reviewOn ? formatIsoDate(i.plan.reviewOn) : null,
    contact: [i.loName, i.loPhone, i.loEmail].filter(Boolean).join(' · '),
    howToUpdate: 'Text or email me when you finish a step, and send the documents listed through your borrower portal or by email. I’ll check them and update your plan.',
    reassessment: 'When the main milestones are done, we’ll review your updated information together to see whether you’re ready to move forward with a prequalification. Finishing every step does not by itself mean you are approved.',
    disclosure: ROADMAP_DISCLOSURE,
  }
}

/** Words the roadmap must never contain (it goes to the borrower). */
export function roadmapProblems(v: RoadmapView): string[] {
  const text = JSON.stringify(v).replace(ROADMAP_DISCLOSURE, '').replace(v.reassessment, '')
  const out: string[] = []
  if (/guarantee/i.test(text)) out.push('The roadmap promises a guarantee. Edit the plan first.')
  if (/\b(will|going to)\s+(be\s+)?(approved|qualify|eligible)/i.test(text)) out.push('The roadmap promises approval. Edit the plan first.')
  if (!v.actions.length) out.push('The plan has no actions.')
  return out
}
