// The intake interview (LO Assistant step 4, Connor 2026-11-17), from the
// Borrower Interview script: seven sections of fields, the spoken "Say this"
// prompts, the live summary for the loan officer, and the hand-off prefill.
// Fact-gathering only: nothing here decides eligibility, pricing or approval,
// and nothing here goes to the borrower. Answers are saved by section
// (intake_interviews.answers): { call: {...}, goal: {...}, ..., meta: { done } }.

export type SectionId = 'call' | 'goal' | 'credit' | 'assets' | 'income' | 'changes' | 'handoff'

export type Option = { value: string; label: string }

export type Field =
  | { key: string; label: string; kind: 'text' | 'textarea' | 'money' | 'number' | 'date' | 'datetime' | 'check'; hint?: string; wide?: boolean }
  | { key: string; label: string; kind: 'select'; options: Option[]; hint?: string; wide?: boolean }
  /** No / Yes, with details when Yes. Value: { answer: 'yes' | 'no' | null, details }. */
  | { key: string; label: string; kind: 'yesno'; hint?: string; wide?: boolean }
  /** A realtor partner (picked from the Partner center) or a typed name and phone. Value: { partnerId, name, phone }. */
  | { key: string; label: string; kind: 'realtor'; hint?: string; wide?: boolean }
  /** Rows of the same fields; `byType` swaps the fields by the row's type. Value: rows. */
  | { key: string; label: string; kind: 'repeater'; itemLabel: string; fields: Field[]; byType?: { key: string; label: string; options: Option[]; fields: Record<string, Field[]> }; hint?: string; wide?: boolean }
  /** A fixed table of rows with an amount and a source/timing. Value: { [row]: { amount, source } }. */
  | { key: string; label: string; kind: 'funds'; rows: Option[]; hint?: string; wide?: boolean }
  /** A line of guidance, no value. */
  | { key: string; label: string; kind: 'hint'; wide?: boolean }

export interface Section {
  id: SectionId
  title: string
  /** The spoken prompt; {LO} is the file's loan officer's first name. */
  prompt: string
  fields: Field[]
}

const NOTES: Field = { key: 'notes', label: "Notes / borrower's own words", kind: 'textarea', wide: true }
const opts = (...pairs: [string, string][]): Option[] => pairs.map(([value, label]) => ({ value, label }))
const DAYS = opts(['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday'], ['any', 'Any day'])
const METHODS = opts(['call', 'Call'], ['text', 'Text'], ['email', 'Email'])

const INCOME_FIELDS: Record<string, Field[]> = {
  w2: [
    { key: 'employer', label: 'Employer & role', kind: 'text', wide: true },
    { key: 'startDate', label: 'Start date', kind: 'date' },
    { key: 'priorChanges', label: 'Prior changes (role, pay, hours)', kind: 'text' },
    { key: 'payType', label: 'Paid by', kind: 'select', options: opts(['salary', 'Salary'], ['hourly', 'Hourly']) },
    { key: 'payAmount', label: 'Salary a year or hourly rate', kind: 'money' },
    { key: 'hours', label: 'Hours', kind: 'select', options: opts(['fixed', 'Fixed'], ['variable', 'Variable']) },
    { key: 'hoursPerWeek', label: 'Hours a week', kind: 'number' },
    { key: 'extraType', label: 'OT / bonus / commission / tips', kind: 'text', hint: 'Which ones' },
    { key: 'extraAmount', label: 'Extra amount', kind: 'money' },
    { key: 'extraFrequency', label: 'How often', kind: 'text' },
    { key: 'extraHistory', label: 'History of the extra pay', kind: 'text' },
    { key: 'records', label: 'Records available (stubs, W-2s)', kind: 'text', wide: true },
  ],
  '1099': [
    { key: 'payer', label: 'Payer', kind: 'text' },
    { key: 'work', label: 'Work done', kind: 'text' },
    { key: 'startDate', label: 'Start date', kind: 'date' },
    { key: 'grossMonthly', label: 'Gross a month (approx.)', kind: 'money' },
    { key: 'variability', label: 'How much it varies', kind: 'text' },
    { key: 'expenses', label: 'Expenses', kind: 'text' },
    { key: 'entityRecords', label: 'Entity & tax records', kind: 'text', wide: true },
  ],
  business: [
    { key: 'name', label: 'Business name', kind: 'text' },
    { key: 'ownershipPct', label: 'Ownership %', kind: 'number' },
    { key: 'startDate', label: 'Start date', kind: 'date' },
    { key: 'structure', label: 'Structure (LLC, S-corp…)', kind: 'text' },
    { key: 'revenueExpenses', label: 'Revenue / expenses', kind: 'text' },
    { key: 'wagesDistributions', label: 'Wages / distributions', kind: 'text' },
    { key: 'returns', label: 'Returns available', kind: 'text', wide: true },
  ],
  other: [
    { key: 'kind', label: 'Kind', kind: 'select', options: opts(['retirement', 'Retirement'], ['social_security', 'Social Security'], ['disability', 'Disability'], ['rental', 'Rental'], ['support', 'Support'], ['investment', 'Investment'], ['other', 'Other']) },
    { key: 'monthlyAmount', label: 'Amount a month', kind: 'money' },
    { key: 'rentExpenses', label: 'Rent & expenses (rental)', kind: 'text' },
    { key: 'duration', label: 'How long it continues', kind: 'text' },
    { key: 'notes', label: 'Notes', kind: 'text', wide: true },
  ],
}

export const SECTIONS: Section[] = [
  {
    id: 'call',
    title: 'Call details & opening',
    prompt: "Hi, I'm calling from MPS Mortgage. I'm working with {LO} and gathering information for their review. Is now still a good time to talk?",
    fields: [
      { key: 'borrowerName', label: 'Borrower name', kind: 'text' },
      { key: 'preferredName', label: 'Preferred name', kind: 'text' },
      { key: 'phone', label: 'Phone', kind: 'text' },
      { key: 'email', label: 'Email', kind: 'text' },
      { key: 'referralSource', label: 'Referral source', kind: 'text' },
      { key: 'realtor', label: 'Realtor', kind: 'realtor' },
      { key: 'callAt', label: 'Call date & time', kind: 'datetime' },
      { key: 'otherParticipants', label: 'Other participants', kind: 'text' },
      { key: 'followUpDay', label: 'Best follow-up day', kind: 'select', options: DAYS },
      { key: 'followUpTime', label: 'Best time', kind: 'text' },
      { key: 'followUpMethod', label: 'Best way', kind: 'select', options: METHODS },
      { key: 'confirmedGoodTime', label: 'Confirmed it is a good time', kind: 'check', wide: true },
      { key: 'understandsReview', label: "Understands this is information-gathering for the loan officer's review", kind: 'check', wide: true },
      { key: 'toldSecurePortal', label: 'Told sensitive information goes through the secure portal', kind: 'check', wide: true },
      NOTES,
    ],
  },
  {
    id: 'goal',
    title: 'Loan goal & property',
    prompt: 'What are you hoping to do, and tell me about the home: where, what kind, the price you have in mind and where things stand?',
    fields: [
      { key: 'goal', label: 'Goal', kind: 'select', options: opts(['purchase', 'Purchase'], ['refinance', 'Refinance'], ['equity', 'Equity / cash out'], ['other', 'Other']) },
      { key: 'desiredOutcome', label: 'Desired outcome', kind: 'text' },
      { key: 'location', label: 'Property location', kind: 'text' },
      { key: 'propertyType', label: 'Property type', kind: 'select', options: opts(['sfr', 'Single family'], ['townhome', 'Townhome'], ['condo', 'Condo'], ['multi', '2–4 units'], ['manufactured', 'Manufactured'], ['land', 'Land'], ['other', 'Other']) },
      { key: 'expectedPrice', label: 'Expected price', kind: 'money' },
      { key: 'contractStatus', label: 'Contract status', kind: 'select', options: opts(['not_under_contract', 'Not under contract'], ['offer_submitted', 'Offer submitted'], ['under_contract', 'Under contract'], ['other', 'Other']) },
      { key: 'keyDates', label: 'Key dates / timeline', kind: 'text', wide: true },
      { key: 'livingSituation', label: 'Current living situation', kind: 'text' },
      { key: 'currentHousing', label: 'Current rent / housing payment', kind: 'money' },
      { key: 'targetPayment', label: 'Comfortable target payment', kind: 'money' },
      { key: 'downPayment', label: 'Intended down payment', kind: 'money' },
      { key: 'downPaymentSource', label: 'Down payment source', kind: 'text' },
      { key: 'otherProperty', label: 'Other property', kind: 'select', options: opts(['none', 'None'], ['sell', 'Selling'], ['keep', 'Keeping']) },
      { key: 'otherPropertyDetails', label: 'Other property details', kind: 'text' },
      { key: 'timingDriver', label: "What's driving the timing", kind: 'text', wide: true },
      NOTES,
    ],
  },
  {
    id: 'credit',
    title: 'Credit & debts',
    prompt: "About what do you believe your credit score is, and when was it last checked? I'm recording what you report, not applying a score cutoff or predicting an outcome.",
    fields: [
      { key: 'scoreReported', label: 'Score reported (approx.)', kind: 'number' },
      { key: 'lastChecked', label: 'Last checked (when / where)', kind: 'text' },
      { key: 'latePayments', label: 'Late payments', kind: 'yesno' },
      { key: 'collections', label: 'Collections', kind: 'yesno' },
      { key: 'bankruptcy', label: 'Bankruptcy', kind: 'yesno' },
      { key: 'foreclosure', label: 'Foreclosure', kind: 'yesno' },
      { key: 'recentChanges', label: 'Recent credit changes', kind: 'yesno' },
      {
        key: 'debts',
        label: 'Debt inventory',
        kind: 'repeater',
        itemLabel: 'debt',
        wide: true,
        fields: [
          { key: 'creditor', label: 'Creditor', kind: 'text' },
          { key: 'type', label: 'Type', kind: 'select', options: opts(['auto', 'Auto'], ['card', 'Credit card'], ['student', 'Student loan'], ['personal', 'Personal loan'], ['mortgage', 'Mortgage / HELOC'], ['support', 'Child support / alimony'], ['tax', 'Tax payment plan'], ['cosigned', 'Co-signed'], ['other', 'Other']) },
          { key: 'balance', label: 'Balance', kind: 'money' },
          { key: 'monthly', label: 'Monthly', kind: 'money' },
          { key: 'status', label: 'Status / deferment', kind: 'text' },
          { key: 'endsSoon', label: 'Ends soon?', kind: 'select', options: opts(['no', 'No'], ['yes', 'Yes']) },
          { key: 'endsDetail', label: 'Ends when', kind: 'text' },
        ],
      },
      { key: 'confirmHint', label: 'Confirm: auto · cards · student · personal · mortgages/HELOCs · support · tax plans · co-signed', kind: 'hint', wide: true },
      NOTES,
    ],
  },
  {
    id: 'assets',
    title: 'Assets & funds',
    prompt: 'What accounts do you have, checking, savings, investments or retirement, and about how much is in each? Where will the down payment and closing costs come from?',
    fields: [
      {
        key: 'accounts',
        label: 'Accounts',
        kind: 'repeater',
        itemLabel: 'account',
        wide: true,
        fields: [
          { key: 'type', label: 'Type', kind: 'select', options: opts(['checking', 'Checking'], ['savings', 'Savings'], ['investments', 'Investments'], ['retirement', 'Retirement'], ['other', 'Other']) },
          { key: 'owners', label: 'Owners', kind: 'text' },
          { key: 'balance', label: 'Approx. balance', kind: 'money' },
          { key: 'notes', label: 'Notes', kind: 'text' },
        ],
      },
      {
        key: 'funds',
        label: 'Funds',
        kind: 'funds',
        wide: true,
        rows: opts(['gift', 'Expected gift'], ['saleProceeds', 'Sale proceeds'], ['cashOnHand', 'Cash on hand'], ['downPayment', 'Down payment funds'], ['closingCosts', 'Closing-cost funds'], ['reserves', 'Reserves']),
      },
      NOTES,
    ],
  },
  {
    id: 'income',
    title: 'Employment & income',
    prompt: "Walk me through your work over the last two years, including any gaps. Then let's go through each source of income one at a time.",
    fields: [
      {
        key: 'history',
        label: 'Two-year history',
        kind: 'repeater',
        itemLabel: 'job or activity',
        wide: true,
        fields: [
          { key: 'dates', label: 'Dates', kind: 'text' },
          { key: 'employer', label: 'Employer / activity', kind: 'text' },
          { key: 'role', label: 'Role / income type', kind: 'text' },
          { key: 'gaps', label: 'Gaps', kind: 'text' },
        ],
      },
      {
        key: 'sources',
        label: 'Income sources',
        kind: 'repeater',
        itemLabel: 'income source',
        wide: true,
        fields: [],
        byType: { key: 'type', label: 'Type', options: opts(['w2', 'W-2'], ['1099', '1099 / contract'], ['business', 'Business owner'], ['other', 'Other']), fields: INCOME_FIELDS },
      },
      NOTES,
    ],
  },
  {
    id: 'changes',
    title: 'Changes, documents & close',
    prompt: "Thank you. I'll send these facts and open questions to {LO}. {LO} will review financing options and next steps. I'm not making a commitment or approval decision during this call.",
    fields: [
      { key: 'employment', label: 'Expected change: employment', kind: 'yesno' },
      { key: 'income', label: 'Expected change: income', kind: 'yesno' },
      { key: 'debts', label: 'Expected change: debts', kind: 'yesno' },
      { key: 'assets', label: 'Expected change: assets', kind: 'yesno' },
      { key: 'property', label: 'Expected change: property', kind: 'yesno' },
      { key: 'timing', label: 'Expected change: timing', kind: 'yesno' },
      {
        key: 'missingDocs',
        label: 'Missing documents',
        kind: 'repeater',
        itemLabel: 'document',
        wide: true,
        fields: [
          { key: 'item', label: 'Item', kind: 'text' },
          { key: 'owner', label: 'Who gets it', kind: 'text' },
        ],
      },
      { key: 'bestFollowUp', label: 'Best follow-up', kind: 'text', wide: true },
      { key: 'concerns', label: "Borrower's concerns / questions", kind: 'textarea', wide: true },
      NOTES,
    ],
  },
  {
    id: 'handoff',
    title: 'Handoff to {LO}',
    prompt: 'Before we wrap up: is anything time-sensitive, and when and how is it best to follow up?',
    fields: [
      { key: 'urgency', label: 'Urgency', kind: 'select', options: opts(['routine', 'Routine'], ['time_sensitive', 'Time-sensitive']) },
      { key: 'urgencyReason', label: 'Why / what', kind: 'text' },
      { key: 'urgencyDate', label: 'By when', kind: 'date' },
      { key: 'unresolvedQuestions', label: 'Unresolved questions', kind: 'textarea', wide: true },
      { key: 'followUpOwner', label: 'Follow-up owner', kind: 'text' },
      { key: 'followUpDate', label: 'Follow-up date', kind: 'date' },
      { key: 'followUpMethod', label: 'Follow-up method', kind: 'select', options: METHODS },
      { key: 'checkSummary', label: 'Goal, property, price, timeline, payments and realtor are summarized', kind: 'check', wide: true },
      { key: 'checkCredit', label: 'Credit info is marked as borrower-reported', kind: 'check', wide: true },
      { key: 'checkIncome', label: 'Each income stream is listed separately', kind: 'check', wide: true },
      { key: 'checkFunds', label: 'Debts, assets and funds are summarized without promising qualification', kind: 'check', wide: true },
      { key: 'checkDocs', label: 'Missing docs and secure-portal instructions are recorded', kind: 'check', wide: true },
      { key: 'checkConcerns', label: 'Concerns, urgency, questions and follow-up owner are assigned', kind: 'check', wide: true },
      { key: 'checkCompliance', label: 'Any compliance question has been escalated', kind: 'check', wide: true },
      NOTES,
    ],
  },
]

export const BOUNDARY = "Gather facts, flag questions. Don't promise approval, pricing, or that any funds qualify. No credit pull without authorization."

export type Answers = Record<string, unknown>
type Obj = Record<string, unknown>

const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const arr = (v: unknown): Obj[] => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') as Obj[] : [])
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '')
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.replace(/[$,\s]/g, '')) : NaN
  return Number.isFinite(n) ? n : null
}

export const sectionOf = (a: Answers, id: SectionId): Obj => obj(a[id])
export const withLo = (text: string, loFirst: string) => text.replaceAll('{LO}', loFirst || 'the loan officer')

/** Sections the interviewer marked done (Next / Done). */
export const doneSections = (a: Answers): SectionId[] => (Array.isArray(obj(a.meta).done) ? (obj(a.meta).done as unknown[]) : []).filter((s): s is SectionId => SECTIONS.some((x) => x.id === s))

/** Submit is open once section 7 is done; otherwise "Submit partial" with a reason. */
export const readyToSubmit = (a: Answers) => doneSections(a).includes('handoff')

/** Whether a field has anything in it (repeaters: a row with something; yes/no: an answer). */
export function filled(f: Field, v: unknown): boolean {
  switch (f.kind) {
    case 'hint':
      return false
    case 'check':
      return v === true
    case 'yesno':
      return !!str(obj(v).answer)
    case 'realtor':
      return !!(str(obj(v).partnerId) || str(obj(v).name))
    case 'repeater':
      return arr(v).some((row) => Object.values(row).some((x) => str(x)))
    case 'funds':
      return Object.values(obj(v)).some((row) => str(obj(row).amount) || str(obj(row).source))
    default:
      return !!str(v)
  }
}

/** How many of a section's fields have something in them, out of how many could. */
export function sectionFill(a: Answers, id: SectionId): { filled: number; of: number } {
  const s = SECTIONS.find((x) => x.id === id)!
  const fields = s.fields.filter((f) => f.kind !== 'hint')
  const data = sectionOf(a, id)
  return { filled: fields.filter((f) => filled(f, data[f.key])).length, of: fields.length }
}

const LABEL: Record<string, Record<string, string>> = Object.fromEntries(
  SECTIONS.flatMap((s) => s.fields).flatMap((f) => (f.kind === 'select' ? [[f.key, Object.fromEntries(f.options.map((o) => [o.value, o.label]))]] : [])),
)
const label = (key: string, value: unknown) => LABEL[key]?.[str(value)] ?? str(value)
export const INCOME_TYPE_LABEL: Record<string, string> = { w2: 'W-2', '1099': '1099', business: 'Business', other: 'Other' }
const money = (n: number | null) => (n == null ? null : n >= 10_000 ? `~$${Math.round(n / 1000)}k` : `$${Math.round(n).toLocaleString('en-US')}`)

/** The right-hand "Building for {LO}" card: short lines that fill in as the interview goes. */
export function liveSummary(a: Answers): string[] {
  const goal = sectionOf(a, 'goal')
  const credit = sectionOf(a, 'credit')
  const assets = sectionOf(a, 'assets')
  const income = sectionOf(a, 'income')
  const changes = sectionOf(a, 'changes')
  const call = sectionOf(a, 'call')
  const lines: string[] = []
  const first = [label('goal', goal.goal), str(goal.location) && `${str(goal.location)} area`, money(num(goal.expectedPrice))].filter(Boolean)
  if (first.length) lines.push(first.join(' · '))
  if (str(goal.contractStatus)) lines.push(`Under contract? ${label('contractStatus', goal.contractStatus)}`)
  const pay = [num(goal.currentHousing) != null && `Rent now ${money(num(goal.currentHousing))}`, num(goal.targetPayment) != null && `target ≤ ${money(num(goal.targetPayment))}`].filter(Boolean)
  if (pay.length) lines.push(pay.join(' · '))
  const gift = obj(obj(assets.funds).gift)
  const down = [num(goal.downPayment) != null && `${money(num(goal.downPayment))}`, str(goal.downPaymentSource), (str(gift.amount) || str(gift.source)) && 'possible gift'].filter(Boolean)
  if (down.length) lines.push(`Down: ${down.join(' + ')}`)
  if (num(credit.scoreReported) != null) lines.push(`Score ~${num(credit.scoreReported)} (self-reported)`)
  const debts = arr(credit.debts).filter((d) => str(d.creditor) || num(d.monthly) != null)
  if (debts.length) lines.push(`Debts: ${debts.length} · ${money(debts.reduce((t, d) => t + (num(d.monthly) ?? 0), 0))}/mo`)
  const sources = arr(income.sources).filter((s) => str(s.type))
  if (sources.length) lines.push(`Income: ${sources.map((s) => INCOME_TYPE_LABEL[str(s.type)] ?? str(s.type)).join(' + ')}`)
  const realtor = obj(call.realtor)
  if (str(realtor.name)) lines.push(`Realtor: ${str(realtor.name)}`)
  const docs = arr(changes.missingDocs).filter((d) => str(d.item))
  if (docs.length) lines.push(`Missing docs: ${docs.length}`)
  return lines
}

/**
 * Section 7 filled from sections 1–6 (only what can be worked out); the page
 * applies it to blank fields only, so nothing typed is replaced.
 */
export function handoffPrefill(a: Answers, interviewerName: string | null): Obj {
  const call = sectionOf(a, 'call')
  const goal = sectionOf(a, 'goal')
  const credit = sectionOf(a, 'credit')
  const income = sectionOf(a, 'income')
  const changes = sectionOf(a, 'changes')
  const assets = sectionOf(a, 'assets')
  const out: Obj = {}
  const contract = str(goal.contractStatus)
  if (contract === 'offer_submitted' || contract === 'under_contract') {
    out.urgency = 'time_sensitive'
    out.urgencyReason = [label('contractStatus', contract), str(goal.keyDates)].filter(Boolean).join(': ')
  } else if (contract || str(goal.keyDates)) out.urgency = 'routine'
  if (str(changes.concerns)) out.unresolvedQuestions = str(changes.concerns)
  if (interviewerName) out.followUpOwner = interviewerName
  if (str(call.followUpMethod)) out.followUpMethod = str(call.followUpMethod)
  else if (str(changes.bestFollowUp)) out.followUpMethod = /text/i.test(str(changes.bestFollowUp)) ? 'text' : /email/i.test(str(changes.bestFollowUp)) ? 'email' : /call|phone/i.test(str(changes.bestFollowUp)) ? 'call' : undefined
  if (out.followUpMethod === undefined) delete out.followUpMethod
  if (str(goal.goal) && (str(goal.location) || num(goal.expectedPrice) != null)) out.checkSummary = true
  if (num(credit.scoreReported) != null) out.checkCredit = true
  if (arr(income.sources).some((s) => str(s.type))) out.checkIncome = true
  if (arr(credit.debts).length || arr(assets.accounts).length) out.checkFunds = true
  if (arr(changes.missingDocs).some((d) => str(d.item)) && call.toldSecurePortal === true) out.checkDocs = true
  return out
}

/** The prefill applied to blank fields only. */
export function fillBlanks(current: Obj, prefill: Obj): Obj {
  const next = { ...current }
  for (const [k, v] of Object.entries(prefill)) if (!str(next[k]) && next[k] !== true) next[k] = v
  return next
}
