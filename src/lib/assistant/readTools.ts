// The assistant's read tools (Loan Officer Assistant, Phase 1). Each one runs
// in the browser as the signed-in person, with the same queries the app's
// own screens use (fetchContacts, fetchPipeline, fetchLoanProfile, …), so
// the database's access rules decide what comes back: a loan officer only
// ever gets their own files. Each returns a compact result for Claude and,
// where it helps, a card for the chat.

import { db, unwrap } from '@/lib/api/client'
import { fetchConditions } from '@/lib/api/conditions'
import { fetchContacts } from '@/lib/api/contacts'
import { fetchEstimates } from '@/lib/api/estimates'
import { fetchLoanProfile, fetchPipeline } from '@/lib/api/loans'
import { fetchNotes } from '@/lib/api/notes'
import { fetchProperties } from '@/lib/api/properties'
import type { PipelineLoan } from '@/lib/api/types'
import { isCleared } from '@/lib/loanfile/conditions'
import { fullName } from '@/lib/pipeline/helpers'
import { purposeLabel, stageLabel } from '@/lib/pipeline/stages'
import { borrowerMatches, filterBorrowers, type ListFilters } from './filters'
import type { AssistantCard } from './cards'

export interface ToolOutput {
  /** What Claude reads (kept small). */
  result: unknown
  card?: AssistantCard
}

const money = (n: number | null | undefined) => (n == null ? null : Math.round(n))
const name = (l: PipelineLoan) => (l.borrower ? fullName(l.borrower) : 'No borrower')

export async function findBorrower(input: { query?: unknown }): Promise<ToolOutput> {
  const query = typeof input.query === 'string' ? input.query : ''
  const people = borrowerMatches(await fetchContacts(), query).slice(0, 8)
  const result = people.map((p) => ({
    contact_id: p.id,
    name: fullName(p),
    phone: p.phone,
    email: p.email,
    files: p.loans.map((l) => ({ loan_id: l.id, stage: l.stage, purpose: l.purpose })),
  }))
  const options = people.flatMap((p) => p.loans.map((l) => ({ label: `${fullName(p)} · ${purposeLabel(l.purpose)} · ${stageLabel(l.stage)}`, loanId: l.id })))
  return {
    result: result.length ? result : `Nobody on your files matches "${query}".`,
    card: options.length > 1 ? { type: 'choices', question: 'Which file do you mean?', options: options.slice(0, 8) } : undefined,
  }
}

export async function getBorrowerSummary(input: { loan_id?: unknown }): Promise<ToolOutput> {
  const loanId = typeof input.loan_id === 'string' ? input.loan_id : ''
  const loan = loanId ? await fetchLoanProfile(loanId) : null
  if (!loan) return { result: 'That file was not found, or it is not yours.' }
  const b = loan.borrower
  const [properties, conditions, notes, estimates, consent, messages] = await Promise.all([
    fetchProperties(loan.id),
    fetchConditions(loan.id),
    b ? fetchNotes(b.id) : Promise.resolve([]),
    fetchEstimates(loan.id),
    b ? db().from('contacts').select('sms_consent, email_consent, sms_opted_out_at, email_opted_out_at').eq('id', b.id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    b
      ? db().from('messages').select('channel, direction, subject, body, sent_at').eq('contact_id', b.id).order('sent_at', { ascending: false }).limit(3)
      : Promise.resolve({ data: [], error: null }),
  ])
  const c = consent.data as { sms_consent: boolean | null; email_consent: boolean | null; sms_opted_out_at: string | null; email_opted_out_at: string | null } | null
  const d = loan.details
  const open = conditions.filter((x) => !isCleared(x.status))
  const selected = estimates.find((e) => e.id === d.pricingScenarioId) ?? null
  const msgs = (messages.data ?? []) as { channel: string; direction: string; subject: string | null; body: string; sent_at: string }[]
  const result = {
    loan_id: loan.id,
    borrower: b ? { name: fullName(b), phone: b.phone, email: b.email } : null,
    consent: c ? { text: c.sms_opted_out_at ? 'opted out' : c.sms_consent ? 'yes' : 'not recorded', email: c.email_opted_out_at ? 'opted out' : c.email_consent ? 'yes' : 'not recorded' } : null,
    stage: stageLabel(loan.stage),
    purpose: purposeLabel(loan.purpose),
    loan_officer: loan.assignedLo?.name ?? null,
    loan_amount: money(d.loanAmount),
    purchase_price: money(loan.purchasePrice),
    rate: d.noteRate,
    lender: d.lenderName,
    program: d.programName,
    closing_date: loan.closingDate,
    homes: properties.map((p) => ({ address: [p.addressLine, p.city].filter(Boolean).join(', '), status: p.status, list_price: money(p.listPrice), subject: p.id === d.subjectPropertyId })),
    open_conditions: open.slice(0, 10).map((x) => x.body),
    open_conditions_count: open.length,
    selected_fee_estimate: selected ? selected.name : null,
    fee_estimates_count: estimates.filter((e) => !e.archivedAt).length,
    latest_notes: notes.slice(0, 3).map((n) => ({ kind: n.kind, on: n.createdAt.slice(0, 10), text: n.body.slice(0, 300) })),
    latest_messages: msgs.map((m) => ({ on: m.sent_at.slice(0, 10), from: m.direction === 'inbound' ? 'borrower' : 'us', channel: m.channel, text: (m.subject ? `${m.subject}: ` : '') + m.body.slice(0, 300) })),
  }
  return {
    result,
    card: {
      type: 'summary',
      loanId: loan.id,
      name: b ? fullName(b) : 'No borrower',
      status: `${purposeLabel(loan.purpose)} · ${stageLabel(loan.stage)}`,
      lines: [
        b?.phone || b?.email ? { label: 'Contact', value: [b?.phone, b?.email].filter(Boolean).join(' · ') } : null,
        d.loanAmount ? { label: 'Loan amount', value: `$${Math.round(d.loanAmount).toLocaleString('en-US')}` } : null,
        d.lenderName || d.programName ? { label: 'Lender', value: [d.lenderName, d.programName].filter(Boolean).join(' · ') } : null,
        loan.closingDate ? { label: 'Closing', value: loan.closingDate } : null,
        properties.length ? { label: 'Homes', value: properties.map((p) => p.addressLine).join(' · ') } : null,
        { label: 'Open conditions', value: String(open.length) },
        selected ? { label: 'Selected Fee Estimate', value: selected.name } : null,
        msgs[0] ? { label: 'Last message', value: `${msgs[0].direction === 'inbound' ? 'From them' : 'From us'}, ${msgs[0].sent_at.slice(0, 10)}: ${msgs[0].body.slice(0, 80)}` } : null,
      ].filter((x): x is { label: string; value: string } => !!x),
    },
  }
}

/** When each person last heard from us: our latest text or email, or a call, text, email or meeting note. */
async function lastContactByPerson(): Promise<Map<string, string>> {
  const [msgs, notes] = await Promise.all([
    db().from('messages').select('contact_id, sent_at').eq('direction', 'outbound').not('contact_id', 'is', null).order('sent_at', { ascending: false }).limit(5000),
    db().from('notes').select('contact_id, created_at').in('kind', ['call', 'text', 'email', 'meeting']).order('created_at', { ascending: false }).limit(5000),
  ])
  const last = new Map<string, string>()
  const keep = (id: string | null, at: string) => {
    if (!id) return
    const was = last.get(id)
    if (!was || at > was) last.set(id, at)
  }
  for (const m of unwrap<{ contact_id: string | null; sent_at: string }[]>(msgs)) keep(m.contact_id, m.sent_at)
  for (const n of unwrap<{ contact_id: string | null; created_at: string }[]>(notes)) keep(n.contact_id, n.created_at)
  return last
}

export async function listBorrowers(input: Record<string, unknown>): Promise<ToolOutput> {
  const filters: ListFilters = {
    stages: Array.isArray(input.stages) ? input.stages.filter((s): s is string => typeof s === 'string') : undefined,
    purposes: Array.isArray(input.purposes) ? input.purposes.filter((s): s is string => typeof s === 'string') : undefined,
    closingFrom: typeof input.closing_from === 'string' ? input.closing_from : undefined,
    closingTo: typeof input.closing_to === 'string' ? input.closing_to : undefined,
    noContactDays: typeof input.no_contact_days === 'number' ? input.no_contact_days : undefined,
    lender: typeof input.lender === 'string' ? input.lender : undefined,
    limit: typeof input.limit === 'number' ? input.limit : 50,
  }
  const loans = await fetchPipeline()
  const lastContact = filters.noContactDays ? await lastContactByPerson() : new Map<string, string>()
  const lenders = filters.lender
    ? new Map(unwrap<{ id: string; lender_name: string | null }[]>(await db().from('loans').select('id, lender_name')).map((r) => [r.id, r.lender_name]))
    : new Map<string, string | null>()
  const { rows, total } = filterBorrowers(loans, filters, { lastContact, lenders, now: new Date() })
  return {
    result: {
      total,
      shown: rows.length,
      files: rows.map((r) => ({ loan_id: r.loan.id, name: name(r.loan), stage: stageLabel(r.loan.stage), purpose: purposeLabel(r.loan.purpose), closing_date: r.loan.closingDate, last_contact: r.lastContact?.slice(0, 10) ?? null })),
    },
    card: {
      type: 'borrowers',
      title: `${total} file${total === 1 ? '' : 's'}${rows.length < total ? ` (first ${rows.length})` : ''}`,
      items: rows.map((r) => ({
        loanId: r.loan.id,
        name: name(r.loan),
        detail: [`${purposeLabel(r.loan.purpose)} · ${stageLabel(r.loan.stage)}`, r.loan.closingDate ? `closing ${r.loan.closingDate}` : null, filters.noContactDays ? (r.lastContact ? `last contact ${r.lastContact.slice(0, 10)}` : 'no contact on record') : null]
          .filter(Boolean)
          .join(' · '),
      })),
    },
  }
}

export async function listEstimates(input: { loan_id?: unknown }): Promise<ToolOutput> {
  const loanId = typeof input.loan_id === 'string' ? input.loan_id : ''
  const loan = loanId ? await fetchLoanProfile(loanId) : null
  if (!loan) return { result: 'That file was not found, or it is not yours.' }
  const list = (await fetchEstimates(loan.id)).filter((e) => !e.archivedAt)
  const selectedId = loan.details.pricingScenarioId
  const items = list.map((e) => ({
    id: e.id,
    name: e.name,
    lender: e.program?.lenderName ?? e.lenderName,
    program: e.program?.programName ?? e.programName,
    rate: e.noteRate,
    points: e.figures?.pointsPct ?? null,
    loanAmount: money(e.figures?.totalLoanAmount ?? e.loanAmount),
    pi: money(e.figures?.principalAndInterest),
    taxes: money(e.figures?.taxes),
    payment: money(e.figures?.pitia),
    cashToClose: money(e.figures?.cashToClose),
    selected: e.id === selectedId,
  }))
  return {
    result: items.length ? items.map(({ id, ...rest }) => ({ estimate_id: id, ...rest })) : 'No Fee Estimates on this file yet.',
    card: items.length ? { type: 'estimates', loanId: loan.id, items } : undefined,
  }
}

export const READ_TOOL_RUNNERS: Record<string, (input: Record<string, unknown>) => Promise<ToolOutput>> = {
  find_borrower: findBorrower,
  get_borrower_summary: getBorrowerSummary,
  list_borrowers: listBorrowers,
  list_estimates: listEstimates,
}
