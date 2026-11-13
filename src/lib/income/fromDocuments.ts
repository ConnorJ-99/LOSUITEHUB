// "Calculate income" (Stage 4; plan docs/plans/income-calculation.md): turns
// the analyzed uploads (Stage 3 readings) into DRAFT income worksheets. Pure.
// The AI only read the documents; the figures here are code, and the
// worksheets' own math (src/lib/calc/income) does the qualifying income line
// by line. Every draft lists the documents it used and notes for Connor.
//
// W-2 job (current): base pay from the latest pay stub: the stated rate ×
//   pay periods, unless the year-to-date base average is lower (then that,
//   the agency practice); overtime, bonus and commission from the YTD
//   amounts (prior years from a WVOE or December stub, typed in).
// Bank statements: the deposits summed across statements, months 12 or 24,
//   large deposits listed to exclude, the expense factor given (default 50%).
// Tax returns: Schedule C (1040), 1120S or 1065 + K-1, the two most recent
//   years into the matching self-employed worksheet.
//
// Stage 4d: every input the draft fills keeps its source (inputSources): the
// document, the field it was read from, the value put in the input, the quote
// and the page. An input worked out from a field (a YTD average, months from
// the pay date, a sum of statements) says how in `derived`. Keys are the
// input's path inside `inputs` ("amount", "recent.netProfit").

import { round } from '@/lib/calc'
import { PERIODS_PER_YEAR } from '@/lib/calc/income/wages'
import type { PartnershipYear, SCorpYear, ScheduleCYear } from '@/lib/calc/income/selfEmployed'
import { matchJob, type ReadDeposit, type ReadField, type ReadFieldKey } from '../../../supabase/functions/assistant/documentRead'
import { defaultInputs, suggestedLabel, type SalaryFrequency, type VariableType, type WorksheetData } from './worksheets'

export type ReadFields = Partial<Record<ReadFieldKey, ReadField>> & { deposits?: ReadDeposit[] }

export interface IncomeDoc {
  documentId: string
  fileName: string
  /** The document's type (the accepted one, else the AI's suggestion). */
  kind: string
  fields: ReadFields
}

export interface IncomeJob {
  id: string
  employerName: string
  current: boolean
  selfEmployed: boolean
  startDate: string | null
  endDate: string | null
}

/** Where one input's value came from (saved in income_worksheets.input_sources). */
export interface InputSource {
  documentId: string
  /** The field read from the document. */
  field: ReadFieldKey
  /** The value the draft put in the input (the AI's figure for the edit log). */
  value: number | string | null
  quote: string
  /** The page the quote is on (absent on readings made before Stage 4d). */
  page?: number
  /** How the input was worked out from the field, when it isn't the field as read. */
  derived?: string
  /** Stage 4d-2: ticked as checked. */
  checkedBy?: string
  checkedAt?: string
}

export type InputSources = Record<string, InputSource>

export interface IncomeDraft {
  data: WorksheetData
  label: string
  employmentId: string | null
  sourceDocumentIds: string[]
  notes: string[]
  inputSources: InputSources
}

/** The source of an input from one field of a document (null when the field wasn't read). */
function sourceOf(doc: IncomeDoc, field: ReadFieldKey, value: number | string | null, derived?: string): InputSource | null {
  const r = doc.fields[field]
  if (!r || value == null) return null
  return { documentId: doc.documentId, field, value, quote: r.quote, ...(r.page ? { page: r.page } : {}), ...(derived ? { derived } : {}) }
}

const sourcesFrom = (entries: [string, InputSource | null][]): InputSources => Object.fromEntries(entries.filter((e): e is [string, InputSource] => e[1] != null))

const num = (f: ReadField | undefined) => (f && typeof f.value === 'number' ? f.value : null)
const str = (f: ReadField | undefined) => (f && typeof f.value === 'string' ? f.value : null)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDate = (d: string) => `${MONTHS[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}, ${d.slice(0, 4)}`
const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

/** Months of the year covered through a date: Sep 15 = 8.5 (to two decimals). */
export function monthsThrough(date: string): number {
  const m = Number(date.slice(5, 7))
  const d = Number(date.slice(8, 10))
  const days = new Date(Date.UTC(Number(date.slice(0, 4)), m, 0)).getUTCDate()
  return round(m - 1 + d / days, 2)
}

const payDateOf = (d: IncomeDoc) => str(d.fields.pay_date) ?? str(d.fields.pay_period_end)

/** The pay stubs and W-2s for each current W-2 job (by employer name; a single job takes the unnamed ones). */
function docsByJob(docs: IncomeDoc[], jobs: IncomeJob[]): Map<string, IncomeDoc[]> {
  const wageJobs = jobs.filter((j) => j.current && !j.selfEmployed)
  const flagJobs = jobs.map((j) => ({ id: j.id, employerName: j.employerName, current: j.current, startDate: j.startDate, endDate: j.endDate }))
  const out = new Map<string, IncomeDoc[]>()
  for (const d of docs.filter((x) => x.kind === 'paystub' || x.kind === 'w2')) {
    const employer = str(d.fields.employer_name)
    const job = employer ? matchJob(employer, flagJobs) : wageJobs.length === 1 ? wageJobs[0] : null
    if (!job || !wageJobs.some((w) => w.id === job.id)) continue
    out.set(job.id, [...(out.get(job.id) ?? []), d])
  }
  return out
}

/**
 * Employers named on pay stubs and W-2s that aren't a current W-2 job on the
 * 1003. Their documents are left out of Calculate income (a different
 * employer is something to look at), so the screen says which and offers to
 * add the job.
 */
export function unmatchedEmployers(docs: IncomeDoc[], jobs: IncomeJob[]): string[] {
  const wageJobs = jobs.filter((j) => j.current && !j.selfEmployed)
  const flagJobs = jobs.map((j) => ({ id: j.id, employerName: j.employerName, current: j.current, startDate: j.startDate, endDate: j.endDate }))
  const out: string[] = []
  for (const d of docs.filter((x) => x.kind === 'paystub' || x.kind === 'w2')) {
    const employer = str(d.fields.employer_name)
    if (!employer) continue
    const job = matchJob(employer, flagJobs)
    if ((!job || !wageJobs.some((w) => w.id === job.id)) && !out.includes(employer)) out.push(employer)
  }
  return out
}

function wageDrafts(job: IncomeJob, docs: IncomeDoc[], today: string): IncomeDraft[] {
  const stubs = docs.filter((d) => d.kind === 'paystub' && payDateOf(d)).sort((a, b) => payDateOf(b)!.localeCompare(payDateOf(a)!))
  const w2s = docs.filter((d) => d.kind === 'w2' && num(d.fields.tax_year)).sort((a, b) => num(b.fields.tax_year)! - num(a.fields.tax_year)!)
  const stub = stubs[0]
  if (!stub) return []
  const f = stub.fields
  const paid = payDateOf(stub)!
  const sources = [stub.documentId, ...w2s.map((w) => w.documentId)]
  const notes: string[] = [`From the pay stub dated ${shortDate(paid)} (${stub.fileName})`]
  if (Number(today.slice(0, 4)) !== Number(paid.slice(0, 4))) notes.push(`The pay stub is from ${paid.slice(0, 4)}: get a current-year stub before relying on these numbers`)
  const ytdMonths = monthsThrough(paid)
  const frequency = str(f.pay_frequency) as SalaryFrequency | null
  const out: IncomeDraft[] = []

  // Base: the stated rate (per period, or hourly × hours) × periods ÷ 12, or the YTD base average when that's lower.
  const perPeriod = num(f.base_pay_current) ?? (num(f.hourly_rate) != null && num(f.hours_current) != null ? round(num(f.hourly_rate)! * num(f.hours_current)!) : null)
  const stated = perPeriod != null && frequency ? round((perPeriod * PERIODS_PER_YEAR[frequency]) / 12) : null
  const variableYtd = (num(f.ytd_overtime) ?? 0) + (num(f.ytd_bonus) ?? 0) + (num(f.ytd_commission) ?? 0)
  const ytdBase = num(f.ytd_base) ?? (num(f.ytd_gross) != null && variableYtd === 0 ? num(f.ytd_gross) : null)
  if (num(f.ytd_base) == null && ytdBase != null) notes.push('No separate YTD base on the stub: YTD gross is used as base (there is no overtime, bonus or commission on it)')
  const ytdMonthly = ytdBase != null && ytdMonths > 0 ? round(ytdBase / ytdMonths) : null
  if (stated != null || ytdMonthly != null) {
    let inputs: { frequency: SalaryFrequency; amount: number | null }
    let inputSources: InputSources
    if (stated != null && (ytdMonthly == null || stated <= ytdMonthly)) {
      inputs = { frequency: frequency!, amount: perPeriod }
      inputSources = sourcesFrom([
        ['amount', num(f.base_pay_current) != null ? sourceOf(stub, 'base_pay_current', perPeriod) : sourceOf(stub, 'hourly_rate', perPeriod, `$${num(f.hourly_rate)} an hour × ${num(f.hours_current)} hours this period`)],
        ['frequency', sourceOf(stub, 'pay_frequency', frequency)],
      ])
      notes.push(ytdMonthly != null ? `Stated base ${money(stated)}/mo is at or below the YTD average ${money(ytdMonthly)}/mo, so the stated rate is used` : `Stated base ${money(perPeriod!)} ${frequency!.replace('_', '-')}`)
    } else {
      inputs = { frequency: 'monthly', amount: ytdMonthly }
      inputSources = sourcesFrom([['amount', sourceOf(stub, num(f.ytd_base) != null ? 'ytd_base' : 'ytd_gross', ytdMonthly, `${money(ytdBase!)} ÷ ${ytdMonths} months through ${shortDate(paid)}`)]])
      notes.push(stated != null ? `YTD base average ${money(ytdMonthly!)}/mo (${money(ytdBase!)} over ${ytdMonths} months) is lower than the stated ${money(stated)}/mo, so the YTD average is used` : `YTD base ${money(ytdBase!)} over ${ytdMonths} months (no pay rate on the stub)`)
    }
    // Pace vs the latest W-2: a falling income needs a look.
    const lastW2 = w2s[0]
    const ytdGross = num(f.ytd_gross)
    if (lastW2 && num(lastW2.fields.w2_wages) && ytdGross != null && ytdMonths > 0) {
      const pace = (ytdGross / ytdMonths) * 12
      const w2 = num(lastW2.fields.w2_wages)!
      const change = (pace - w2) / w2
      notes.push(`${num(lastW2.fields.tax_year)} W-2: ${money(w2)}; this year's pace: ${money(pace)}`)
      if (change < -0.05) notes.push(`This year's pace is ${Math.round(-change * 100)}% below the ${num(lastW2.fields.tax_year)} W-2: the underwriter will ask why`)
    } else if (w2s.length === 0) notes.push('No W-2 analyzed yet for this job')
    out.push({ data: { kind: 'salary', inputs }, label: suggestedLabel('salary', job, null), employmentId: job.id, sourceDocumentIds: sources, notes, inputSources })
  }

  const VARIABLE: [VariableType, ReadFieldKey][] = [
    ['overtime', 'ytd_overtime'],
    ['bonus', 'ytd_bonus'],
    ['commission', 'ytd_commission'],
  ]
  for (const [type, key] of VARIABLE) {
    const ytd = num(f[key])
    if (!ytd) continue
    out.push({
      data: { kind: 'variable', inputs: { incomeType: type, ytdAmount: ytd, ytdMonths, priorYear1: null, priorYear2: null } },
      label: `${type[0].toUpperCase()}${type.slice(1)} · ${job.employerName}`,
      employmentId: job.id,
      sourceDocumentIds: [stub.documentId],
      notes: [`YTD ${type} ${money(ytd)} through ${shortDate(paid)}`, `Add the prior years' ${type} from a WVOE or the December pay stubs: a W-2 doesn't split it out, and under 12 months of history usually can't be used`],
      inputSources: sourcesFrom([
        ['ytdAmount', sourceOf(stub, key, ytd)],
        ['ytdMonths', sourceOf(stub, str(f.pay_date) ? 'pay_date' : 'pay_period_end', ytdMonths, `months through ${shortDate(paid)}`)],
      ]),
    })
  }
  return out
}

function bankStatementDraft(docs: IncomeDoc[], expenseRatioPct: number | null, selfEmployedJob: IncomeJob | null): IncomeDraft | null {
  const statements = docs.filter((d) => d.kind === 'bank_statement' && num(d.fields.total_deposits) != null)
  if (statements.length === 0) return null
  const total = round(statements.reduce((s, d) => s + num(d.fields.total_deposits)!, 0))
  const months: 12 | 24 = statements.length > 12 ? 24 : 12
  const avg = total / statements.length
  const notes = [`${statements.length} statement${statements.length === 1 ? '' : 's'}, ${money(total)} in deposits`]
  if (statements.length < months) notes.push(`Only ${statements.length} of ${months} months uploaded: the total is divided by ${months}, so add the missing statements`)
  for (const d of statements) {
    for (const dep of d.fields.deposits ?? []) {
      if (dep.amount > avg * 0.5) notes.push(`Large deposit ${shortDate(dep.date)} ${money(dep.amount)} (${dep.description}): put it in excluded deposits if it isn't business income`)
    }
  }
  notes.push('Account type is set to business (expense factor applies); change it to personal for personal statements')
  return {
    data: { kind: 'bank_statement', inputs: { ...defaultInputs('bank_statement'), totalDeposits: total, months, expenseRatioPct: expenseRatioPct ?? 50 } },
    label: suggestedLabel('bank_statement', selfEmployedJob, null),
    employmentId: selfEmployedJob?.id ?? null,
    sourceDocumentIds: statements.map((d) => d.documentId),
    notes,
    inputSources: sourcesFrom([['totalDeposits', sourceOf(statements[0], 'total_deposits', total, statements.length > 1 ? `the sum of ${statements.length} statements' total deposits (this is the first)` : undefined)]]),
  }
}

function returnDrafts(docs: IncomeDoc[], selfEmployedJob: IncomeJob | null): IncomeDraft[] {
  const returns = docs.filter((d) => (d.kind === 'tax_return' || d.kind === 'business_return') && num(d.fields.tax_year))
  const out: IncomeDraft[] = []
  const formOf = (d: IncomeDoc) => str(d.fields.return_form) ?? (num(d.fields.sch_c_net_profit) != null ? '1040' : null)
  for (const form of ['1040', '1120S', '1065'] as const) {
    const byYear = new Map<number, IncomeDoc>()
    for (const d of returns.filter((x) => formOf(x) === form)) byYear.set(num(d.fields.tax_year)!, d)
    const years = [...byYear.keys()].sort((a, b) => b - a).slice(0, 2)
    if (years.length === 0) continue
    const [recentYear, olderYear] = years
    const recentDoc = byYear.get(recentYear)!
    const olderDoc = olderYear ? byYear.get(olderYear)! : null
    const recent = recentDoc.fields
    const older = olderDoc?.fields ?? null
    // Each year's inputs point at the line they were read from.
    const yearSources = (map: [string, ReadFieldKey][]) =>
      sourcesFrom([
        ['recentYear', sourceOf(recentDoc, 'tax_year', recentYear)],
        ...map.map(([input, field]): [string, InputSource | null] => [`recent.${input}`, sourceOf(recentDoc, field, num(recentDoc.fields[field]))]),
        ...(olderDoc ? map.map(([input, field]): [string, InputSource | null] => [`older.${input}`, sourceOf(olderDoc, field, num(olderDoc.fields[field]))]) : []),
      ])
    const notes = [`Tax years ${years.slice().reverse().join(' and ')}`]
    if (years.length < 2) notes.push('Only one year of returns analyzed: the two-year rule needs both years')
    const sources = years.map((y) => byYear.get(y)!.documentId)
    if (form === '1040') {
      const year = (f: ReadFields | null): ScheduleCYear => ({ ...defaultInputs('schedule_c').recent, ...(f ? { netProfit: num(f.sch_c_net_profit), nonrecurringIncome: num(f.sch_c_other_income), depletion: num(f.sch_c_depletion), depreciation: num(f.sch_c_depreciation), nonDeductibleMeals: num(f.sch_c_meals), businessUseOfHome: num(f.sch_c_home_office) } : {}) })
      if (recent.sch_c_net_profit == null) continue
      const inputSources = yearSources([['netProfit', 'sch_c_net_profit'], ['nonrecurringIncome', 'sch_c_other_income'], ['depletion', 'sch_c_depletion'], ['depreciation', 'sch_c_depreciation'], ['nonDeductibleMeals', 'sch_c_meals'], ['businessUseOfHome', 'sch_c_home_office']])
      out.push({ data: { kind: 'schedule_c', inputs: { recentYear, recent: year(recent), older: year(older) } }, label: suggestedLabel('schedule_c', selfEmployedJob, null), employmentId: selfEmployedJob?.id ?? null, sourceDocumentIds: sources, notes, inputSources })
    } else {
      const corp = (f: ReadFields | null): SCorpYear => ({
        ...defaultInputs('s_corp').recent,
        ...(f
          ? { k1OrdinaryIncome: num(f.k1_ordinary_income), k1RentalIncome: num(f.k1_rental_income), depreciation: num(f.biz_depreciation), depletion: num(f.biz_depletion), amortizationCasualty: num(f.biz_amortization), notesPayableUnder1Yr: num(f.biz_notes_under_1yr), nonDeductibleTravelMeals: num(f.biz_travel_meals), ownershipPct: num(f.k1_ownership_pct) }
          : {}),
      })
      if (recent.k1_ordinary_income == null) continue
      const corpMap: [string, ReadFieldKey][] = [['k1OrdinaryIncome', 'k1_ordinary_income'], ['k1RentalIncome', 'k1_rental_income'], ['depreciation', 'biz_depreciation'], ['depletion', 'biz_depletion'], ['amortizationCasualty', 'biz_amortization'], ['notesPayableUnder1Yr', 'biz_notes_under_1yr'], ['nonDeductibleTravelMeals', 'biz_travel_meals'], ['ownershipPct', 'k1_ownership_pct']]
      if (form === '1120S') out.push({ data: { kind: 's_corp', inputs: { recentYear, recent: corp(recent), older: corp(older) } }, label: suggestedLabel('s_corp', selfEmployedJob, null), employmentId: selfEmployedJob?.id ?? null, sourceDocumentIds: sources, notes, inputSources: yearSources(corpMap) })
      else {
        const part = (f: ReadFields | null): PartnershipYear => ({ ...corp(f), k1GuaranteedPayments: f ? num(f.k1_guaranteed_payments) : null })
        out.push({ data: { kind: 'partnership', inputs: { recentYear, recent: part(recent), older: part(older) } }, label: suggestedLabel('partnership', selfEmployedJob, null), employmentId: selfEmployedJob?.id ?? null, sourceDocumentIds: sources, notes, inputSources: yearSources([...corpMap, ['k1GuaranteedPayments', 'k1_guaranteed_payments']]) })
      }
    }
  }
  return out
}

/**
 * Draft worksheets from one borrower's analyzed documents. `only` limits it to
 * the documents of one kind of income (from "Calculate income" on a document).
 */
export function incomeDrafts(input: { docs: IncomeDoc[]; jobs: IncomeJob[]; today: string; expenseRatioPct?: number | null; only?: 'wages' | 'bank_statement' | 'returns' }): IncomeDraft[] {
  const { docs, jobs, today, only } = input
  const seJobs = jobs.filter((j) => j.current && j.selfEmployed)
  const seJob = seJobs.length === 1 ? seJobs[0] : null
  const out: IncomeDraft[] = []
  if (!only || only === 'wages') for (const [jobId, list] of docsByJob(docs, jobs)) out.push(...wageDrafts(jobs.find((j) => j.id === jobId)!, list, today))
  if (!only || only === 'bank_statement') {
    const bs = bankStatementDraft(docs, input.expenseRatioPct ?? null, seJob)
    if (bs) out.push(bs)
  }
  if (!only || only === 'returns') out.push(...returnDrafts(docs, seJob))
  return out
}

/** Which kind of income a document feeds ("Calculate income" on that document). */
export function incomeKindOf(docKind: string): 'wages' | 'bank_statement' | 'returns' | null {
  if (docKind === 'paystub' || docKind === 'w2') return 'wages'
  if (docKind === 'bank_statement') return 'bank_statement'
  if (docKind === 'tax_return' || docKind === 'business_return') return 'returns'
  return null
}
