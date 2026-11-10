// The assistant's in-app change tools (Loan Officer Assistant, Phase 2,
// Connor 2026-11-03). Each runs in the browser as the signed-in person with
// the same code the app's own buttons use, saves what it needs to put things
// back (assistant_actions.undo), and returns a card with Undo. Nothing here
// reaches a borrower: no texts, no emails.
//
// Reused, not rewritten: Build estimates' draftFromRow + the Estimate tool's
// create/save (estimateDataFrom), "Select for this file" (selectEstimate),
// the stage menu's updateStage (+ the GHL opportunity move on Closed),
// saveProperty, saveLoanDetails, and the same notes and tasks inserts.

import { db, unwrap } from '@/lib/api/client'
import { fetchProgramList, newProgramOption } from '@/lib/api/estimates'
import { moveGhlOpportunity } from '@/lib/api/ghl'
import { closeLoan, fetchLoanProfile, saveLoanDetails, updateStage } from '@/lib/api/loans'
import { todayIso } from '@/lib/dates'
import { saveProperty } from '@/lib/api/properties'
import type { LoanDetails, LoanProfile, Property } from '@/lib/api/types'
import { blankPropertyInput } from '@/components/profile/PropertyDialog'
import { draftOf, loadEstimateData } from '@/components/estimates/useEstimateData'
import { propertyInput, selectEstimate } from '@/components/estimates/useSelectEstimate'
import { ESTIMATE_DEFAULTS, defaultDownPct, draftFromRow, estimateName, type BuildRow, type Estimate, type EstimateDraft } from '@/lib/estimates/estimate'
import { scenarioFrom } from '@/lib/pricing/scenario'
import { fullName } from '@/lib/pipeline/helpers'
import { STAGES, stageLabel, type PipelineStage } from '@/lib/pipeline/stages'
import { matchProgram, type ProgramPick } from './filters'
import type { AssistantCard, EstimateItem } from './cards'

export interface ChangeOutput {
  result: unknown
  card?: AssistantCard
  /** What Undo needs (saved on the assistant_actions row). */
  undo?: Record<string, unknown>
  /** An outbound draft: logged as pending until Send on its card (sendTools.ts). */
  pending?: boolean
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() && Number.isFinite(Number(v)) ? Number(v) : null)
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const money = (n: number | null | undefined) => (n == null ? '—' : `$${Math.round(n).toLocaleString('en-US')}`)

async function mustLoan(loanId: unknown): Promise<LoanProfile> {
  const loan = typeof loanId === 'string' ? await fetchLoanProfile(loanId) : null
  if (!loan) throw new Error('That file was not found, or it is not yours.')
  return loan
}
const borrowerName = (loan: LoanProfile) => (loan.borrower ? fullName(loan.borrower) : 'this borrower')

const itemOf = (e: Estimate, selectedId: string | null): EstimateItem => ({
  id: e.id,
  name: e.name,
  lender: e.program?.lenderName ?? e.lenderName,
  program: e.program?.programName ?? e.programName,
  rate: e.noteRate,
  points: e.figures?.pointsPct ?? e.pointsPct ?? null,
  loanAmount: e.figures ? Math.round(e.figures.totalLoanAmount) : e.loanAmount,
  pi: e.figures ? Math.round(e.figures.principalAndInterest) : null,
  taxes: e.figures ? Math.round(e.figures.taxes) : null,
  payment: e.figures ? Math.round(e.figures.pitia) : null,
  cashToClose: e.figures ? Math.round(e.figures.cashToClose) : null,
  selected: e.id === selectedId,
})

// ---------------------------------------------------------------------------
// Fee Estimates
// ---------------------------------------------------------------------------

interface ScenarioInput {
  program?: unknown
  program_id?: unknown
  rate?: unknown
  points?: unknown
  down_pct?: unknown
  down_amount?: unknown
  loan_amount?: unknown
  term_years?: unknown
  label?: unknown
  taxes_annual?: unknown
  tax_rate_pct?: unknown
  insurance_annual?: unknown
  hoa_monthly?: unknown
}

/** A file's home by id, or by part of its address. */
function findHome(loan: LoanProfile, homes: Property[], input: Record<string, unknown>): Property | null {
  const id = str(input.property_id)
  if (id) return homes.find((h) => h.id === id) ?? null
  const address = str(input.property_address)?.toLowerCase()
  if (address) return homes.find((h) => h.addressLine.toLowerCase().includes(address) || address.includes(h.addressLine.toLowerCase())) ?? null
  return homes.find((h) => h.id === loan.details.subjectPropertyId) ?? null
}

/** Applies taxes, insurance and HOA said for one scenario. */
function withCosts(d: EstimateDraft, s: ScenarioInput): EstimateDraft {
  const out = { ...d }
  const taxPct = num(s.tax_rate_pct)
  const taxes = num(s.taxes_annual)
  if (taxPct != null) Object.assign(out, { taxesValue: taxPct, taxesFactor: 'pct_of_value' })
  else if (taxes != null) Object.assign(out, { taxesValue: taxes, taxesFactor: 'annual' })
  const ins = num(s.insurance_annual)
  if (ins != null) Object.assign(out, { insuranceValue: ins, insuranceFactor: 'annual' })
  const hoa = num(s.hoa_monthly)
  if (hoa != null) out.monthlyHoa = hoa
  return out
}

export async function createFeeEstimates(input: Record<string, unknown>): Promise<ChangeOutput> {
  const loan = await mustLoan(input.loan_id)
  const scenarios = (Array.isArray(input.scenarios) ? input.scenarios : []) as ScenarioInput[]
  if (!scenarios.length) throw new Error('Which programs and rates? Give at least one scenario.')
  if (scenarios.length > 8) throw new Error('At most 8 Fee Estimates at once.')
  const data = await loadEstimateData(loan)
  if (data.noFeeList) throw new Error('The fee list is empty (Settings → Fee list), so Smart Fees has nothing to price with.')
  const catalog = (await fetchProgramList()).filter((p) => p.active && p.lien === 'first' && p.lenderStatus !== 'inactive')
  const isPurchase = loan.purpose === 'purchase'
  const d = loan.details
  const home = findHome(loan, data.properties, input)
  if ((str(input.property_id) || str(input.property_address)) && !home) throw new Error(`No home matching "${str(input.property_address) ?? input.property_id}" is on this file. Add it first (update_borrower_fields with subject_property).`)
  const price = num(input.purchase_price) ?? (isPurchase ? (d.purchasePrice ?? home?.listPrice ?? null) : null)
  if (isPurchase && price == null) throw new Error('What purchase price? None is on the file.')

  // Every scenario's program first, so nothing is saved when one can't be found.
  const picks: ProgramPick[] = scenarios.map((s, i) => {
    const r = matchProgram(catalog, str(s.program_id), str(s.program))
    if ('error' in r) throw new Error(`Scenario ${i + 1}: ${r.error}`)
    if (num(s.rate) == null) throw new Error(`Scenario ${i + 1} needs a rate.`)
    return r.program
  })

  const base = { ...scenarioFrom(loan, home, '', data.properties), ...ESTIMATE_DEFAULTS }
  const shared = { purchasePrice: isPurchase ? price : null, propertyValue: null, closingDate: d.closingDate ?? d.estimatedFundingDate, sellerCredits: null, earnestMoney: null, propertyId: home?.id ?? null }
  const taken = data.list.map((e) => e.name)
  const created: Estimate[] = []
  const options: string[] = []
  try {
    for (let i = 0; i < scenarios.length; i++) {
      const s = scenarios[i]
      const p = picks[i]
      const downPct = num(s.down_pct) ?? (num(s.down_amount) != null && price ? (num(s.down_amount)! / price) * 100 : isPurchase ? defaultDownPct(p.family) : null)
      const row: BuildRow = {
        key: `a${i}`,
        programOptionId: null,
        programId: p.id,
        programName: p.name,
        family: p.family,
        lenderId: p.lenderId || null,
        lenderName: p.lenderName,
        label: str(s.label) ?? '',
        ratePct: num(s.rate),
        pointsPct: num(s.points) ?? 0,
        downPct: isPurchase ? downPct : null,
        loanAmount: isPurchase ? null : (num(s.loan_amount) ?? d.loanAmount),
        termMonths: num(s.term_years) ? Math.round(num(s.term_years)! * 12) : (d.termMonths ?? 360),
      }
      const name = row.label || estimateName(`${p.name} · ${p.lenderName}`, [...taken, ...created.map((c) => c.name)])
      const optionId = await newProgramOption(loan.id, loan.organizationId, p.id)
      options.push(optionId)
      const draft = withCosts({ ...draftFromRow(base, row, shared, isPurchase, name), programOptionId: optionId }, s)
      created.push(await data.create(draft, [], row.lenderId))
    }
  } catch (e) {
    // All or nothing: take back what was made.
    for (const c of created) await db().from('pricing_scenarios').delete().eq('id', c.id)
    for (const o of options) await db().from('loan_program_options').delete().eq('id', o)
    throw e
  }
  const items = created.map((e) => itemOf(e, d.pricingScenarioId))
  return {
    result: { created: items.map(({ id, ...rest }) => ({ estimate_id: id, ...rest })), purchase_price: price, home: home?.addressLine ?? null },
    card: { type: 'estimates', loanId: loan.id, items, created: true, forName: borrowerName(loan), note: `Fee Estimates on ${home?.addressLine ?? 'this file'}${price ? ` · ${money(price)} price` : ''}, priced with Smart Fees.` },
    undo: { estimateIds: created.map((c) => c.id), optionIds: options },
  }
}

const pctShow = (v: unknown) => (typeof v === 'number' ? `${v}%` : '—')
const usdShow = (v: unknown) => (typeof v === 'number' ? money(v) : '—')
/** How a changed estimate field reads on the card. */
const FIELD_LABEL: Partial<Record<keyof EstimateDraft, { label: string; show: (v: unknown) => string }>> = {
  noteRate: { label: 'Rate', show: pctShow },
  pointsPct: { label: 'Points', show: pctShow },
  loanAmount: { label: 'Loan amount', show: usdShow },
  purchasePrice: { label: 'Purchase price', show: usdShow },
  taxesValue: { label: 'Taxes', show: (v) => (typeof v === 'number' ? String(v) : '—') },
  insuranceValue: { label: 'Insurance (yearly)', show: usdShow },
  monthlyHoa: { label: 'HOA (monthly)', show: usdShow },
  name: { label: 'Name', show: (v) => (typeof v === 'string' ? v : '—') },
}

const ESTIMATE_FIELDS: Record<string, keyof EstimateDraft> ={ rate: 'noteRate', points: 'pointsPct', loan_amount: 'loanAmount', purchase_price: 'purchasePrice', name: 'name', hoa_monthly: 'monthlyHoa' }

export async function updateEstimateTool(input: Record<string, unknown>): Promise<ChangeOutput> {
  const id = str(input.estimate_id)
  const row = id ? unwrap<{ loan_id: string } | null>(await db().from('pricing_scenarios').select('loan_id').eq('id', id).maybeSingle()) : null
  if (!row) throw new Error('That Fee Estimate was not found.')
  const loan = await mustLoan(row.loan_id)
  const data = await loadEstimateData(loan)
  const e = data.list.find((x) => x.id === id)!
  const changes = (input.changes ?? {}) as Record<string, unknown>
  const before = draftOf(e)
  let draft: EstimateDraft = { ...before }
  for (const [k, field] of Object.entries(ESTIMATE_FIELDS)) {
    if (!(k in changes)) continue
    const v = field === 'name' ? str(changes[k]) : num(changes[k])
    if (v != null) draft = { ...draft, [field]: v }
  }
  const downPct = num(changes.down_pct)
  const price = draft.purchasePrice
  if (downPct != null && price) draft = { ...draft, loanAmount: Math.round(price * (1 - downPct / 100)) }
  draft = withCosts(draft, changes as ScenarioInput)
  const changedKeys = (Object.keys(draft) as (keyof EstimateDraft)[]).filter((k) => JSON.stringify(draft[k]) !== JSON.stringify(before[k]))
  if (!changedKeys.length) throw new Error('Nothing to change: say what to change (rate, points, down payment, loan amount, price, taxes, insurance, HOA, name).')
  await data.save(e, draft, data.feesOf(e.id))
  const after = (await loadEstimateData(loan)).list.find((x) => x.id === e.id)!
  return {
    result: { updated: itemOf(after, loan.details.pricingScenarioId), changed: changedKeys },
    card: {
      type: 'change',
      title: `Updated ${e.name}`,
      loanId: loan.id,
      lines: changedKeys
        .filter((k) => FIELD_LABEL[k])
        .slice(0, 8)
        .map((k) => ({ label: FIELD_LABEL[k]!.label, before: FIELD_LABEL[k]!.show(before[k]), after: FIELD_LABEL[k]!.show(draft[k]) })),
      suggestions: [`Show the Fee Estimates on ${borrowerName(loan)}'s file`],
    },
    undo: { estimateId: e.id, before: Object.fromEntries(changedKeys.map((k) => [k, before[k]])) },
  }
}

/** The loan fields Select writes, to put back on Undo. */
const SELECT_FIELDS: (keyof LoanDetails)[] = ['pricingScenarioId', 'noteRate', 'loanAmount', 'purchasePrice', 'termMonths', 'mortgageType', 'programId', 'lenderName', 'programName', 'sellerCredits', 'estimatedClosingCosts', 'prepaidItemsAmount', 'discountPointsAmount', 'lenderCredits']

export async function setSelectedProgram(input: Record<string, unknown>): Promise<ChangeOutput> {
  const loan = await mustLoan(input.loan_id)
  const data = await loadEstimateData(loan)
  const e = data.list.find((x) => x.id === str(input.estimate_id))
  if (!e) throw new Error('That Fee Estimate is not on this file.')
  const beforeLoan = Object.fromEntries(SELECT_FIELDS.filter((k) => k in loan.details).map((k) => [k, loan.details[k]]))
  const home = data.properties.find((p) => p.id === e.propertyId)
  const beforeHome = home ? { id: home.id, annualTaxes: home.annualTaxes, annualInsurance: home.annualInsurance, monthlyHoa: home.monthlyHoa } : null
  const previous = data.list.find((x) => x.id === loan.details.pricingScenarioId) ?? null
  const started = new Date(Date.now() - 1000).toISOString()
  await selectEstimate(loan, data, e)
  // The "Selected …" note Select adds, so Undo can take it back too.
  const note = loan.borrower
    ? unwrap<{ id: string }[]>(await db().from('notes').select('id').eq('loan_id', loan.id).eq('contact_id', loan.borrower.id).gte('created_at', started).ilike('body', 'Selected%').order('created_at', { ascending: false }).limit(1))[0]
    : undefined
  return {
    result: { selected: e.name, previous: previous?.name ?? null },
    card: {
      type: 'change',
      title: 'Selected for the file',
      loanId: loan.id,
      lines: [{ label: 'Selected Fee Estimate', before: previous?.name ?? 'none', after: e.name }],
      footnote: 'The loan now uses its program, rate, points, loan amount and fees (a note was added to the file).',
      suggestions: [`What's ${borrowerName(loan)}'s status?`],
    },
    undo: { loanId: loan.id, loan: beforeLoan, home: beforeHome, noteId: note?.id ?? null },
  }
}

// ---------------------------------------------------------------------------
// Stage, fields, notes, tasks
// ---------------------------------------------------------------------------

const NEXT_STEPS: Partial<Record<PipelineStage, string[]>> = {
  under_contract: ['Upload the contract', 'Add key dates from the contract', 'Text congrats'],
  pre_approved: ['Make a pre-approval letter', 'Create Fee Estimates'],
  processing: ['Show the open conditions'],
  clear_to_close: ['Text congrats on clear to close'],
  closed: ['Text a thank-you'],
}

export async function movePipelineStage(input: Record<string, unknown>): Promise<ChangeOutput> {
  const loan = await mustLoan(input.loan_id)
  const stage = str(input.stage) as PipelineStage | null
  if (!stage || !STAGES.some((s) => s.value === stage)) throw new Error(`Unknown stage. Use one of: ${STAGES.map((s) => s.value).join(', ')}.`)
  if (stage === loan.stage) return { result: `Already in ${stageLabel(stage)}.` }
  const lostReason = str(input.lost_reason)
  if (stage === 'lost' && !lostReason) throw new Error('Why was it lost? A reason is needed to move a file to Lost.')
  if (stage === 'closed' && (!loan.borrower?.email || !loan.borrower?.phone)) throw new Error("A file needs the borrower's email and phone before it moves to Closed.")
  // Closed saves the closed and funded dates with the stage (production counts on the funded date):
  // the dates given, else the file's closing date, else today.
  const isoDate = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v) ?? '') ? str(v)! : null)
  const closedOn = stage === 'closed' ? (isoDate(input.closed_on) ?? loan.details.closingDate ?? todayIso()) : null
  const fundedOn = stage === 'closed' ? (isoDate(input.funded_on) ?? closedOn) : null
  if (stage === 'closed') await closeLoan({ loanId: loan.id, closingDate: closedOn!, fundingDate: fundedOn!, reason: 'Moved to Closed by the assistant' })
  else await updateStage({ loanId: loan.id, stage, lostReason: lostReason ?? undefined })
  let ghl = 'not touched (only Closed moves it)'
  if (stage === 'closed') {
    try {
      const r = await moveGhlOpportunity(loan.organizationId, loan.id, 'closed')
      ghl = 'skipped' in r ? `not moved: ${r.skipped}` : `moved to ${r.to ?? 'Closed'}`
    } catch (e) {
      ghl = `not moved: ${(e as Error).message}`
    }
  }
  return {
    result: { from: stageLabel(loan.stage), to: stageLabel(stage), ghl_opportunity: ghl },
    card: {
      type: 'change',
      title: `${borrowerName(loan)} moved to ${stageLabel(stage)}`,
      loanId: loan.id,
      lines: [
        { label: 'Stage', before: stageLabel(loan.stage), after: stageLabel(stage) },
        ...(stage === 'lost' ? [{ label: 'Lost reason', before: '—', after: lostReason! }] : []),
        ...(stage === 'closed' ? [{ label: 'Closed on', before: loan.details.closingDate ?? '—', after: closedOn! }, { label: 'Funded on', before: '—', after: fundedOn! }] : []),
        { label: 'GHL opportunity', before: '', after: ghl },
      ],
      footnote: stage === 'closed' ? "Undo puts the stage back; it doesn't move the GHL opportunity back or clear the dates (correct them on the Overview)." : undefined,
      suggestions: NEXT_STEPS[stage] ?? [],
    },
    undo: { loanId: loan.id, stage: loan.stage, lostReason: loan.lostReason, statusDetail: loan.statusDetail },
  }
}

export async function updateBorrowerFields(input: Record<string, unknown>): Promise<ChangeOutput> {
  const loan = await mustLoan(input.loan_id)
  const lines: { label: string; before: string; after: string }[] = []
  const undo: Record<string, unknown> = { loanId: loan.id }
  const loanChanges: Partial<LoanDetails> = {}
  const before: Partial<LoanDetails> = {}

  const sp = (input.subject_property ?? null) as Record<string, unknown> | null
  if (sp && str(sp.address_line)) {
    const homes = unwrap<{ id: string; address_line: string }[]>(await db().from('properties').select('id, address_line').eq('loan_id', loan.id))
    const address = str(sp.address_line)!
    const match = homes.find((h) => h.address_line.toLowerCase() === address.toLowerCase())
    let id = match?.id ?? null
    if (!id) {
      id = await saveProperty(loan.id, loan.organizationId, {
        ...blankPropertyInput('under_contract'),
        addressLine: address,
        city: str(sp.city) ?? '',
        state: str(sp.state) ?? 'TX',
        zip: str(sp.zip) ?? '',
        listPrice: num(sp.price),
      })
      undo.createdPropertyId = id
    }
    const old = homes.find((h) => h.id === loan.details.subjectPropertyId)
    before.subjectPropertyId = loan.details.subjectPropertyId
    loanChanges.subjectPropertyId = id
    lines.push({ label: 'Subject property', before: old?.address_line ?? 'none', after: address })
  }
  const price = num(input.purchase_price)
  if (price != null) {
    before.purchasePrice = loan.details.purchasePrice
    loanChanges.purchasePrice = price
    lines.push({ label: 'Purchase price', before: money(loan.details.purchasePrice), after: money(price) })
  }
  const closing = str(input.closing_date)
  if (closing) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(closing)) throw new Error('Closing date as YYYY-MM-DD.')
    before.closingDate = loan.details.closingDate
    loanChanges.closingDate = closing
    lines.push({ label: 'Closing date', before: loan.details.closingDate ?? 'none', after: closing })
  }
  if (!lines.length) throw new Error('Nothing to change: a subject property, purchase price or closing date.')
  if (Object.keys(loanChanges).length) await saveLoanDetails(loan.id, loanChanges)
  undo.loan = before
  return {
    result: { changed: lines.map((l) => `${l.label}: ${l.before} → ${l.after}`) },
    card: { type: 'change', title: `Updated ${borrowerName(loan)}'s file`, loanId: loan.id, lines, suggestions: sp ? ['Create Fee Estimates for this home'] : [] },
    undo,
  }
}

export async function addNote(input: Record<string, unknown>): Promise<ChangeOutput> {
  const loan = await mustLoan(input.loan_id)
  const text = str(input.text)
  if (!text) throw new Error('What should the note say?')
  if (!loan.borrower) throw new Error('This file has no borrower to keep the note on.')
  const row = unwrap<{ id: string }>(await db().from('notes').insert({ organization_id: loan.organizationId, contact_id: loan.borrower.id, loan_id: loan.id, kind: 'note', body: text }).select('id').single())
  return {
    result: { note_added: text },
    card: { type: 'change', title: 'Note added', loanId: loan.id, lines: [{ label: 'Note', before: '', after: text }], suggestions: [] },
    undo: { noteId: row.id },
  }
}

export async function createTask(input: Record<string, unknown>): Promise<ChangeOutput> {
  const loan = await mustLoan(input.loan_id)
  const title = str(input.title)
  if (!title) throw new Error('What is the task?')
  const due = str(input.due_date)
  if (due && !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error('Due date as YYYY-MM-DD.')
  const row = unwrap<{ id: string }>(await db().from('tasks').insert({ organization_id: loan.organizationId, loan_id: loan.id, title, due_on: due }).select('id').single())
  return {
    result: { task_added: title, due: due ?? null },
    card: { type: 'change', title: 'Task added', loanId: loan.id, lines: [{ label: 'Task', before: '', after: due ? `${title} · due ${due}` : title }], suggestions: [] },
    undo: { taskId: row.id },
  }
}

export const CHANGE_TOOL_RUNNERS: Record<string, (input: Record<string, unknown>) => Promise<ChangeOutput>> = {
  create_fee_estimates: createFeeEstimates,
  update_estimate: updateEstimateTool,
  set_selected_program: setSelectedProgram,
  move_pipeline_stage: movePipelineStage,
  update_borrower_fields: updateBorrowerFields,
  add_note: addNote,
  create_task: createTask,
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

/** Puts things back as they were before one assistant change. */
export async function undoChange(tool: string, undo: Record<string, unknown>): Promise<void> {
  const ids = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
  if (tool === 'create_fee_estimates') {
    for (const id of ids(undo.estimateIds)) {
      // An estimate Selected since then stays: the file depends on it.
      const used = unwrap<{ id: string }[]>(await db().from('loans').select('id').eq('pricing_scenario_id', id))
      if (used.length) throw new Error('One of these Fee Estimates was Selected for the file since, so it was kept. Select another first.')
      unwrap(await db().from('pricing_scenarios').delete().eq('id', id).select('id'))
    }
    for (const id of ids(undo.optionIds)) await db().from('loan_program_options').delete().eq('id', id)
    return
  }
  if (tool === 'update_estimate') {
    const row = unwrap<{ loan_id: string } | null>(await db().from('pricing_scenarios').select('loan_id').eq('id', String(undo.estimateId)).maybeSingle())
    if (!row) throw new Error('That Fee Estimate is gone.')
    const loan = await mustLoan(row.loan_id)
    const data = await loadEstimateData(loan)
    const e = data.list.find((x) => x.id === undo.estimateId)!
    await data.save(e, { ...draftOf(e), ...(undo.before as Partial<EstimateDraft>) }, data.feesOf(e.id))
    return
  }
  if (tool === 'set_selected_program') {
    const loanId = String(undo.loanId)
    await saveLoanDetails(loanId, undo.loan as Partial<LoanDetails>)
    const h = undo.home as { id: string; annualTaxes: number | null; annualInsurance: number | null; monthlyHoa: number | null } | null
    if (h) {
      const loan = await mustLoan(loanId)
      const home = (await loadEstimateData(loan)).properties.find((p) => p.id === h.id)
      if (home) await saveProperty(loanId, loan.organizationId, { ...propertyInput(home), annualTaxes: h.annualTaxes, annualInsurance: h.annualInsurance, monthlyHoa: h.monthlyHoa, id: home.id })
    }
    if (typeof undo.noteId === 'string') await db().from('notes').delete().eq('id', undo.noteId)
    return
  }
  if (tool === 'move_pipeline_stage') {
    await updateStage({ loanId: String(undo.loanId), stage: undo.stage as PipelineStage, lostReason: (undo.lostReason as string | null) ?? undefined })
    // Changing the stage clears the status detail: put it back too.
    if (undo.statusDetail) unwrap(await db().from('loans').update({ status_detail: undo.statusDetail }).eq('id', String(undo.loanId)).select('id'))
    return
  }
  if (tool === 'update_borrower_fields') {
    const before = (undo.loan ?? {}) as Partial<LoanDetails>
    if (Object.keys(before).length) await saveLoanDetails(String(undo.loanId), before)
    if (typeof undo.createdPropertyId === 'string') await db().from('properties').delete().eq('id', undo.createdPropertyId)
    return
  }
  if (tool === 'add_note') {
    unwrap(await db().from('notes').delete().eq('id', String(undo.noteId)).select('id'))
    return
  }
  if (tool === 'create_task') {
    unwrap(await db().from('tasks').delete().eq('id', String(undo.taskId)).select('id'))
    return
  }
  throw new Error("This change can't be undone here.")
}
