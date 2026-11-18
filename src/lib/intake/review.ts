// The loan officer's review of an intake (LO Assistant step 5, Connor 2026-11-17).
// Everything here is worked out in code from the borrower-reported answers:
// key numbers, a rough DTI note (for the LO only, never a qualification),
// flags, missing docs, open questions, urgency and the breakdown. The AI
// only adds the plain-English paragraph (and may reword the headline); with
// no AI key this is the whole summary. Also: what Accept writes into the file
// (fill blanks only). Pure and tested.

import { INCOME_TYPE_LABEL, sectionOf, type Answers } from './sections'

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Obj[]) : [])
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(/[$,\s]/g, '')) : NaN
  return Number.isFinite(n) ? n : null
}
const usd = (n: number | null) => (n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`)

export interface Flag {
  severity: 'review' | 'info'
  text: string
}

export interface IntakeSummary {
  headline: string
  /** Plain English for the LO, from the AI; null without it. */
  summary_paragraph: string | null
  key_numbers: {
    price: number | null
    down_payment: number | null
    target_payment: number | null
    current_housing: number | null
    reported_score: number | null
    monthly_income_reported: number | null
    monthly_debts_reported: number | null
  }
  rough_dti_note: string
  breakdown: { goal_property: string; income: string[]; debts: string; assets_funds: string; credit_events: string; realtor_source: string; borrower_concerns: string }
  flags: Flag[]
  missing_docs: string[]
  open_questions: string[]
  urgency: { level: 'routine' | 'time_sensitive'; reason: string; date: string }
  /** 'ai' once the paragraph is written, else 'code'. */
  source?: 'ai' | 'code'
}

const GOAL: Record<string, string> = { purchase: 'Purchase', refinance: 'Refinance', equity: 'Equity / cash out', other: 'Other' }
const CONTRACT: Record<string, string> = { not_under_contract: 'not under contract', offer_submitted: 'offer submitted', under_contract: 'under contract', other: 'other' }
const PROPERTY: Record<string, string> = { sfr: 'SFR', townhome: 'townhome', condo: 'condo', multi: '2–4 units', manufactured: 'manufactured', land: 'land', other: 'other' }
const DEBT_TYPE: Record<string, string> = { auto: 'auto', card: 'card', student: 'student', personal: 'personal', mortgage: 'mortgage/HELOC', support: 'support', tax: 'tax plan', cosigned: 'co-signed', other: 'other' }

/** A month's income from one reported source; null when it can't be worked out from what was said. */
export function monthlyFromSource(s: Obj): number | null {
  const type = str(s.type)
  if (type === 'w2') {
    const pay = num(s.payAmount)
    if (pay == null) return null
    if (str(s.payType) === 'hourly') {
      const hours = num(s.hoursPerWeek)
      return hours == null ? null : (pay * hours * 52) / 12
    }
    return pay / 12
  }
  if (type === '1099') return num(s.grossMonthly)
  if (type === 'other') return num(s.monthlyAmount)
  return null // A business owner's income needs the returns.
}

const isDeferredStudent = (d: Obj) => str(d.type) === 'student' && (/defer|idr|income.?driven|forbear|\$?0\b/i.test(str(d.status)) || !num(d.monthly))

/** Months between a yyyy-mm-dd date and today (null if none). */
function monthsSince(date: string, today: Date): number | null {
  const m = /^(\d{4})-(\d{2})/.exec(date)
  if (!m) return null
  return (today.getFullYear() - Number(m[1])) * 12 + (today.getMonth() + 1 - Number(m[2]))
}
const daysUntil = (date: string, today: Date) => {
  const t = Date.parse(`${date}T12:00:00`)
  if (!Number.isFinite(t)) return null
  return Math.round((t - today.getTime()) / 86_400_000)
}

function incomeLine(s: Obj, i: number): string {
  const letter = String.fromCharCode(65 + i)
  const type = INCOME_TYPE_LABEL[str(s.type)] ?? 'Income'
  const who = str(s.employer) || str(s.payer) || str(s.name) || str(s.kind)
  const monthly = monthlyFromSource(s)
  const started = str(s.startDate) ? `since ${str(s.startDate).slice(0, 7)}` : ''
  const pay = str(s.type) === 'w2' && num(s.payAmount) != null ? `${str(s.payType) === 'hourly' ? `${usd(num(s.payAmount))}/hr` : `${usd(num(s.payAmount))}/yr`}` : monthly != null ? `~${usd(monthly)}/mo` : ''
  return [`${letter} · ${type}`, who, pay, started].filter(Boolean).join(', ')
}

/** The whole summary, worked out from the answers. */
export function summarizeIntake(a: Answers, today = new Date()): IntakeSummary {
  const call = sectionOf(a, 'call')
  const goal = sectionOf(a, 'goal')
  const credit = sectionOf(a, 'credit')
  const assets = sectionOf(a, 'assets')
  const income = sectionOf(a, 'income')
  const changes = sectionOf(a, 'changes')
  const handoff = sectionOf(a, 'handoff')

  const sources = arr(income.sources).filter((s) => str(s.type))
  const monthlyEach = sources.map(monthlyFromSource)
  const knownIncome = monthlyEach.filter((m): m is number => m != null)
  const monthlyIncome = knownIncome.length ? Math.round(knownIncome.reduce((t, m) => t + m, 0)) : null
  const debts = arr(credit.debts).filter((d) => str(d.creditor) || str(d.type) || num(d.monthly) != null)
  const monthlyDebts = debts.length ? Math.round(debts.reduce((t, d) => t + (num(d.monthly) ?? 0), 0)) : null
  const target = num(goal.targetPayment)

  // Rough DTI: reported numbers only, for the LO, never a qualification.
  const missingForDti: string[] = []
  if (debts.some(isDeferredStudent)) missingForDti.push('the deferred student loan payment')
  if (monthlyEach.some((m) => m == null)) missingForDti.push('income that needs documents to figure (business or incomplete)')
  let rough = 'Not enough reported numbers for a rough DTI.'
  if (monthlyIncome && target != null) {
    const pct = Math.round(((target + (monthlyDebts ?? 0)) / monthlyIncome) * 100)
    rough = `Rough DTI at the target payment using all reported income: ~${pct}%${missingForDti.length ? `, before ${missingForDti.join(' and ')}` : ''}. Borrower-reported numbers only, not a qualification.`
  }

  // Flags (Connor's list): factual, no approval language.
  const flags: Flag[] = []
  for (const d of debts.filter(isDeferredStudent)) flags.push({ severity: 'review', text: `Deferred or income-driven student loan${str(d.creditor) ? ` (${str(d.creditor)})` : ''}: a payment must be counted` })
  for (const s of sources.filter((x) => str(x.type) === '1099' || str(x.type) === 'business')) {
    const m = monthsSince(str(s.startDate), today)
    if (m != null && m < 24) flags.push({ severity: 'review', text: `${str(s.type) === '1099' ? '1099' : 'Self-employment'} income under 2 years (${m} months)` })
  }
  for (const h of arr(income.history).filter((x) => str(x.gaps))) flags.push({ severity: 'review', text: `Employment gap: ${str(h.gaps)}` })
  const gift = obj(obj(assets.funds).gift)
  if (str(gift.source) || num(gift.amount) != null) flags.push(num(gift.amount) == null || /unknown|tbd|maybe|possible|not sure/i.test(str(gift.source)) ? { severity: 'review', text: 'Gift funds unconfirmed' } : { severity: 'info', text: `Gift expected: ${usd(num(gift.amount))} (gift letter and transfer needed)` })
  const cash = num(obj(obj(assets.funds).cashOnHand).amount)
  if (cash != null && cash >= 5000) flags.push({ severity: 'review', text: `Large cash on hand reported (${usd(cash)}): it must be documented or deposited and seasoned` })
  const yes = (k: string) => str(obj(credit[k]).answer) === 'yes'
  const details = (k: string) => str(obj(credit[k]).details)
  if (yes('collections')) flags.push({ severity: 'info', text: `Collections / charge-offs reported${details('collections') ? `: ${details('collections')}` : ''}` })
  if (yes('bankruptcy')) flags.push({ severity: 'review', text: `Bankruptcy reported${details('bankruptcy') ? `: ${details('bankruptcy')}` : ''}` })
  if (yes('foreclosure')) flags.push({ severity: 'review', text: `Foreclosure reported${details('foreclosure') ? `: ${details('foreclosure')}` : ''}` })
  for (const d of debts.filter((x) => str(x.endsSoon) === 'yes')) flags.push({ severity: 'info', text: `Debt ending soon: ${str(d.creditor) || DEBT_TYPE[str(d.type)] || 'a debt'}${str(d.endsDetail) ? ` (${str(d.endsDetail)})` : ''}` })
  const deadline = str(handoff.urgencyDate)
  const dleft = deadline ? daysUntil(deadline, today) : null
  if (dleft != null && dleft >= 0 && dleft <= 7) flags.push({ severity: 'review', text: `Deadline within 7 days (${deadline})${str(handoff.urgencyReason) ? `: ${str(handoff.urgencyReason)}` : ''}` })

  const missingDocs = arr(changes.missingDocs).map((d) => str(d.item)).filter(Boolean)
  const openQuestions = [str(handoff.unresolvedQuestions), str(changes.concerns)]
    .flatMap((t) => t.split(/\n+/))
    .map((t) => t.trim())
    .filter((t, i, all) => t && all.indexOf(t) === i)

  const urgent = str(handoff.urgency) === 'time_sensitive' || str(goal.contractStatus) === 'offer_submitted' || str(goal.contractStatus) === 'under_contract'
  const goalLabel = GOAL[str(goal.goal)] ?? ''
  const price = num(goal.expectedPrice)
  const realtor = obj(call.realtor)

  const accounts = arr(assets.accounts).filter((x) => str(x.type) || num(x.balance) != null)
  const fundsRows = Object.entries(obj(assets.funds)).filter(([, r]) => num(obj(r).amount) != null || str(obj(r).source))
  const credits = (['latePayments', 'collections', 'bankruptcy', 'foreclosure', 'recentChanges'] as const).filter(yes)
  const name = str(call.preferredName) || str(call.borrowerName).split(/\s+/)[0] || 'Borrower'

  return {
    headline: [name, goalLabel, str(goal.location), price != null ? `~${usd(price)}` : '', CONTRACT[str(goal.contractStatus)] ?? ''].filter(Boolean).join(' · '),
    summary_paragraph: null,
    key_numbers: {
      price,
      down_payment: num(goal.downPayment),
      target_payment: target,
      current_housing: num(goal.currentHousing),
      reported_score: num(credit.scoreReported),
      monthly_income_reported: monthlyIncome,
      monthly_debts_reported: monthlyDebts,
    },
    rough_dti_note: rough,
    breakdown: {
      goal_property: [goalLabel, str(goal.location), PROPERTY[str(goal.propertyType)], CONTRACT[str(goal.contractStatus)], str(goal.keyDates), str(goal.timingDriver)].filter(Boolean).join(' · '),
      income: sources.map(incomeLine),
      debts: debts.map((d) => `${str(d.creditor) || DEBT_TYPE[str(d.type)] || 'Debt'} ${usd(num(d.balance))} / ${num(d.monthly) != null ? usd(num(d.monthly)) : 'no payment'}${str(d.status) ? ` (${str(d.status)})` : ''}`).join(' · '),
      assets_funds: [
        ...accounts.map((x) => `${str(x.type) || 'Account'} ~${usd(num(x.balance))}${str(x.owners) ? ` (${str(x.owners)})` : ''}`),
        ...fundsRows.map(([k, r]) => `${{ gift: 'gift', saleProceeds: 'sale proceeds', cashOnHand: 'cash on hand', downPayment: 'down payment funds', closingCosts: 'closing-cost funds', reserves: 'reserves' }[k] ?? k} ${num(obj(r).amount) != null ? usd(num(obj(r).amount)) : 'amount unknown'}${str(obj(r).source) ? ` (${str(obj(r).source)})` : ''}`),
      ].join(' · '),
      credit_events: credits.length ? credits.map((k) => `${{ latePayments: 'Late payments', collections: 'Collections', bankruptcy: 'Bankruptcy', foreclosure: 'Foreclosure', recentChanges: 'Recent credit changes' }[k]}${details(k) ? `: ${details(k)}` : ''}`).join(' · ') : 'None reported',
      realtor_source: [str(call.referralSource), str(realtor.name) && `realtor: ${str(realtor.name)}${str(realtor.phone) ? `, ${str(realtor.phone)}` : ''}`].filter(Boolean).join(' · '),
      borrower_concerns: str(changes.concerns),
    },
    flags,
    missing_docs: missingDocs,
    open_questions: openQuestions,
    urgency: { level: urgent ? 'time_sensitive' : 'routine', reason: str(handoff.urgencyReason), date: deadline },
    source: 'code',
  }
}

/** Words the AI paragraph may not use (it goes to the LO, but stays factual). */
export const APPROVAL_WORDS = /\b(approved?|approval|pre-?approved|qualif(y|ies|ied)|guarantee[ds]?|eligible|you will get|rate of)\b/i

// ---------------------------------------------------------------------------
// Accept: what goes into the file (fill blanks only, done by accept_intake())
// ---------------------------------------------------------------------------

const ASSET_KIND: Record<string, string> = { checking: 'checking', savings: 'savings', investments: 'stocks', retirement: 'retirement', other: 'other_liquid' }
const DEBT_KIND: Record<string, string | null> = { auto: 'installment', card: 'revolving', student: 'installment', personal: 'installment', mortgage: null, support: 'child_support', tax: 'other', cosigned: 'installment', other: 'other' }
const OTHER_KIND: Record<string, string> = { retirement: 'retirement', social_security: 'social_security', disability: 'disability', rental: 'other', support: 'child_support', investment: 'interest_and_dividends', other: 'other' }

export interface IntakeMapping {
  person: { email: string | null; phone: string | null }
  loan: { purchasePrice: number | null; estimatedScore: number | null }
  jobs: { employer: string; title: string | null; startDate: string | null; monthlyIncome: number | null; selfEmployed: boolean; ownershipPct: number | null }[]
  otherIncome: { kind: string; monthly: number }[]
  assets: { kind: string; amount: number; institution: string | null }[]
  debts: { kind: string; creditor: string | null; balance: number | null; monthlyPayment: number }[]
  realtor: { partnerId: string | null; name: string | null; phone: string | null } | null
}

/** The answers in the shape accept_intake() writes. Only what the borrower reported with a number goes in. */
export function intakeMapping(a: Answers): IntakeMapping {
  const call = sectionOf(a, 'call')
  const goal = sectionOf(a, 'goal')
  const credit = sectionOf(a, 'credit')
  const assets = sectionOf(a, 'assets')
  const income = sectionOf(a, 'income')
  const score = num(credit.scoreReported)
  const realtor = obj(call.realtor)
  const sources = arr(income.sources)
  const gift = num(obj(obj(assets.funds).gift).amount)
  return {
    person: { email: str(call.email) || null, phone: str(call.phone).replace(/\D/g, '').slice(-10) || null },
    loan: { purchasePrice: str(goal.goal) === 'purchase' ? num(goal.expectedPrice) : null, estimatedScore: score != null && score >= 300 && score <= 850 ? Math.round(score) : null },
    jobs: sources
      .filter((s) => ['w2', '1099', 'business'].includes(str(s.type)) && (str(s.employer) || str(s.payer) || str(s.name)))
      .map((s) => ({
        employer: (str(s.employer) || str(s.payer) || str(s.name)).slice(0, 200),
        title: str(s.type) === '1099' ? str(s.work) || null : null,
        startDate: /^\d{4}-\d{2}-\d{2}$/.test(str(s.startDate)) ? str(s.startDate) : null,
        monthlyIncome: monthlyFromSource(s) == null ? null : Math.round(monthlyFromSource(s)! * 100) / 100,
        selfEmployed: str(s.type) !== 'w2',
        ownershipPct: str(s.type) === 'business' ? num(s.ownershipPct) : null,
      })),
    otherIncome: sources
      .filter((s) => str(s.type) === 'other' && num(s.monthlyAmount) != null)
      .map((s) => ({ kind: OTHER_KIND[str(s.kind)] ?? 'other', monthly: num(s.monthlyAmount)! })),
    assets: [
      ...arr(assets.accounts)
        .filter((x) => num(x.balance) != null)
        .map((x) => ({ kind: ASSET_KIND[str(x.type)] ?? 'other_liquid', amount: num(x.balance)!, institution: null })),
      ...(gift != null ? [{ kind: 'gift_cash', amount: gift, institution: null }] : []),
    ],
    debts: arr(credit.debts)
      .filter((d) => num(d.monthly) != null && DEBT_KIND[str(d.type) || 'other'] !== null)
      .map((d) => ({ kind: DEBT_KIND[str(d.type) || 'other'] ?? 'other', creditor: str(d.creditor) || null, balance: num(d.balance), monthlyPayment: num(d.monthly)! })),
    realtor: str(realtor.partnerId) || str(realtor.name) ? { partnerId: str(realtor.partnerId) || null, name: str(realtor.name) || null, phone: str(realtor.phone) || null } : null,
  }
}
