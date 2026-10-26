// LOSuite assistant: a Supabase Edge Function (Deno) that drafts follow-ups
// reads purchase contracts and call notes. The only place the app
// talks to Claude. The Anthropic API key lives in Edge Function secrets and
// never reaches the browser.
//
// Every request runs as the signed-in user (their token is passed through),
// so Row Level Security decides what the assistant can read and write.
// Nothing is sent or saved on the file: drafts and contract readings land in the file's Action Queue
// for Connor to approve, edit or dismiss, and every run is logged in ai_runs.

import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0'
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import {
  COMPANY_NMLS,
  DRAFT_SCHEMA,
  SYSTEM_PROMPT,
  buildUserPrompt,
  complianceIssues,
  finalBody,
  parseRequest,
  validateDraft,
  type Draft,
  type FileFacts,
  type FollowUpRequest,
  type NoteFact,
  type Signer,
  type TemplateFact,
} from './followUp.ts'
import { NOTES_SCHEMA, NOTES_SYSTEM_PROMPT, normalizeNotes } from './callNotes.ts'
import { CONTRACT_FIELDS, CONTRACT_SCHEMA, CONTRACT_SYSTEM_PROMPT, CONTRACT_USER_PROMPT, MAX_READ_BYTES, normalizeReading } from './contract.ts'

/** Drafts use Sonnet (approved by Connor): fast and inexpensive for short messages. */
const MODEL = 'claude-sonnet-5-5'
const NOTES_SENT = 5
const TASKS_SENT = 5

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

/** An error whose message is safe and useful to show Connor. */
class UserError extends Error {}

function must<T>(result: { data: T | null; error: { message: string } | null }, what: string): T {
  if (result.error) throw new Error(`${what}: ${result.error.message}`)
  if (result.data === null) throw new UserError(`${what}: not found, or you don't have access.`)
  return result.data
}

const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
const todayInDallas = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())

interface Person {
  id: string
  first_name: string
  last_name: string
  phone: string | null
  email: string | null
}

/** Reads what the draft needs, as the signed-in user. Only ids go into the log. */
async function loadFile(db: SupabaseClient, req: FollowUpRequest, userId: string) {
  const loan = must(
    await db
      .from('loans')
      .select(
        'id, organization_id, stage, purpose, mortgage_type, purchase_price, loan_amount, cash_out_amount, contract_date, option_end_date, closing_date, assigned_lo_id, subject_property_id, borrowers:loan_borrowers ( role, contact:contacts!loan_borrowers_contact_id_fkey ( id, first_name, last_name, phone, email ) )',
      )
      .eq('id', req.loanId)
      .maybeSingle(),
    'Loan',
  ) as Record<string, unknown> & { organization_id: string; borrowers: { role: string; contact: Person | null }[] }

  const people = loan.borrowers.filter((b) => b.contact)
  const primary = (people.find((b) => b.role === 'primary') ?? people[0])?.contact
  if (!primary) throw new UserError('This file has no borrower to write to.')

  const [property, notes, tasks, profile, org, template] = await Promise.all([
    loan.subject_property_id
      ? db.from('properties').select('address_line, city').eq('id', loan.subject_property_id as string).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from('notes').select('id, kind, body, created_at').eq('contact_id', primary.id).order('created_at', { ascending: false }).limit(NOTES_SENT),
    db.from('tasks').select('id, title, due_on').eq('loan_id', req.loanId).is('completed_at', null).order('due_on', { ascending: true, nullsFirst: false }).limit(TASKS_SENT),
    db.from('profiles').select('full_name, nmls, phone').eq('id', (loan.assigned_lo_id as string | null) ?? userId).maybeSingle(),
    db.from('organizations').select('name, nmls').eq('id', loan.organization_id).maybeSingle(),
    req.templateId
      ? db.from('message_templates').select('id, name, channel, subject, body').eq('id', req.templateId).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])
  for (const r of [property, notes, tasks, profile, org, template]) if (r.error) throw new Error(r.error.message)
  if (req.templateId && !template.data) throw new UserError('That template was not found.')

  const noteRows = (notes.data ?? []) as { id: string; kind: string; body: string; created_at: string }[]
  const taskRows = (tasks.data ?? []) as { id: string; title: string; due_on: string | null }[]
  const prop = property.data as { address_line: string; city: string | null } | null
  const facts: FileFacts = {
    today: todayInDallas(),
    borrowerFirstName: primary.first_name,
    borrowerName: `${primary.first_name} ${primary.last_name}`.trim(),
    coBorrowerNames: people.filter((b) => b.contact!.id !== primary.id).map((b) => `${b.contact!.first_name} ${b.contact!.last_name}`.trim()),
    stage: loan.stage as string,
    purpose: loan.purpose as string,
    mortgageType: (loan.mortgage_type as string | null) ?? null,
    purchasePrice: num(loan.purchase_price),
    loanAmount: num(loan.loan_amount),
    cashOutAmount: num(loan.cash_out_amount),
    contractDate: (loan.contract_date as string | null) ?? null,
    optionEndDate: (loan.option_end_date as string | null) ?? null,
    closingDate: (loan.closing_date as string | null) ?? null,
    propertyAddress: prop ? [prop.address_line, prop.city].filter(Boolean).join(', ') : null,
    openTasks: taskRows.map((t) => ({ title: t.title, dueOn: t.due_on })),
  }
  // Oldest first reads more naturally.
  const noteFacts: NoteFact[] = noteRows.reverse().map((n) => ({ id: n.id, kind: n.kind, body: n.body, createdAt: n.created_at }))
  const p = profile.data as { full_name: string | null; nmls: string | null; phone: string | null } | null
  const o = org.data as { name: string; nmls: string | null } | null
  const signer: Signer = {
    loName: p?.full_name ?? null,
    loNmls: p?.nmls ?? null,
    loPhone: p?.phone ?? null,
    companyName: o?.name ?? 'MPS Mortgage LLC',
    companyNmls: o?.nmls ?? COMPANY_NMLS,
  }
  const t = template.data as (TemplateFact & { id: string }) | null
  return {
    organizationId: loan.organization_id,
    primary,
    facts,
    notes: noteFacts,
    signer,
    template: t,
    inputRef: { loanId: req.loanId, channel: req.channel, noteIds: noteFacts.map((n) => n.id), taskIds: taskRows.map((x) => x.id), templateId: t?.id ?? null, instructions: req.instructions },
  }
}

interface Usage {
  input: number
  output: number
  model: string
}

/** Asks Claude for a draft; one retry if the first one breaks a compliance rule. */
async function draftWithClaude(anthropic: Anthropic, req: FollowUpRequest, file: Awaited<ReturnType<typeof loadFile>>, usage: Usage): Promise<Draft> {
  const messages: { role: 'user' | 'assistant'; content: unknown }[] = [
    { role: 'user', content: buildUserPrompt(req.channel, file.facts, file.notes, file.template, req.instructions, file.signer) },
  ]
  for (let attempt = 0; attempt < 2; attempt++) {
    const params = {
      model: MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      messages,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: DRAFT_SCHEMA } },
      // If Sonnet declines on a safety check, the API retries on a suitable model itself.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    }
    const res = await anthropic.beta.messages.create(params as never)
    usage.input += res.usage.input_tokens
    usage.output += res.usage.output_tokens
    usage.model = res.model
    if (res.stop_reason === 'refusal') throw new UserError('The assistant declined to draft this message.')
    if (res.stop_reason === 'max_tokens') throw new UserError('The draft came back cut off. Try again.')

    const text = res.content.flatMap((b: { type: string; text?: string }) => (b.type === 'text' && b.text ? [b.text] : [])).join('')
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      throw new UserError('The assistant returned something unreadable. Try again.')
    }
    const checked = validateDraft(raw, req.channel, file.notes)
    if ('error' in checked) throw new UserError(checked.error)
    const issues = complianceIssues(req.channel, checked.draft)
    if (issues.length === 0) return checked.draft
    if (attempt === 1) throw new UserError(`The draft broke a compliance rule twice, so it was not added: ${issues.join(' ')}`)
    messages.push({ role: 'assistant', content: res.content })
    messages.push({ role: 'user', content: `That draft can't be used: ${issues.join(' ')} Rewrite it following every rule.` })
  }
  throw new Error('unreachable')
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' })

  const auth = request.headers.get('Authorization')
  if (!auth) return reply(401, { error: 'Sign in first.' })
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return reply(500, { error: 'The assistant is not set up yet: add ANTHROPIC_API_KEY under Edge Functions → Secrets in Supabase.' })

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
  const { data: userData, error: userError } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ''))
  if (userError || !userData.user) return reply(401, { error: 'Your session expired. Sign in again.' })
  const userId = userData.user.id

  const body = await request.json().catch(() => null)
  try {
    const task = (body as { task?: unknown } | null)?.task
    if (task === 'contract_read') return await handleContractRead(db, body, userId, apiKey)
    if (task === 'call_notes_read') return await handleNotesRead(db, body, userId, apiKey)
    return await handleFollowUp(db, body, userId, apiKey)
  } catch (e) {
    return reply(500, { error: (e as Error).message })
  }
})

/** Starts a run in the log; every assistant run is logged, whatever happens next. */
async function startRun(db: SupabaseClient, organizationId: string, loanId: string, taskType: string, inputRef: unknown, model: string, userId: string): Promise<string> {
  const run = await db.from('ai_runs').insert({ organization_id: organizationId, loan_id: loanId, task_type: taskType, input_ref: inputRef, model, created_by: userId }).select('id').single()
  if (run.error) throw new Error(`Could not log the run: ${run.error.message}`)
  return run.data.id as string
}

/** Records a failed run and turns the error into a reply Connor can read. */
async function failRun(db: SupabaseClient, runId: string, usage: Usage, e: unknown) {
  const message = e instanceof UserError ? e.message : e instanceof Anthropic.APIError ? `Claude API error (${e.status ?? 'network'}): ${e.message}` : (e as Error).message
  await db.from('ai_runs').update({ status: 'failed', error: message, model: usage.model, input_tokens: usage.input, output_tokens: usage.output }).eq('id', runId)
  return reply(e instanceof UserError ? 422 : 502, { error: message, runId })
}

// ---------------------------------------------------------------------------
// Draft a follow-up
// ---------------------------------------------------------------------------

async function handleFollowUp(db: SupabaseClient, body: unknown, userId: string, apiKey: string) {
  const req = parseRequest(body)
  if ('error' in req) return reply(400, req)

  let file: Awaited<ReturnType<typeof loadFile>>
  try {
    file = await loadFile(db, req, userId)
  } catch (e) {
    return reply(e instanceof UserError ? 400 : 500, { error: (e as Error).message })
  }

  const runId = await startRun(db, file.organizationId, req.loanId, 'follow_up_draft', file.inputRef, MODEL, userId)
  const usage: Usage = { input: 0, output: 0, model: MODEL }
  try {
    const draft = await draftWithClaude(new Anthropic({ apiKey }), req, file, usage)
    const contact = req.channel === 'text' ? file.primary.phone : file.primary.email
    const payload = {
      channel: req.channel,
      to: `${file.facts.borrowerName}${contact ? ` · ${contact}` : ''}`,
      subject: draft.subject,
      body: finalBody(req.channel, draft.body, file.signer),
    }
    const item = await db
      .from('action_items')
      .insert({
        organization_id: file.organizationId,
        loan_id: req.loanId,
        kind: 'draft_message',
        title: `Follow-up ${req.channel} to ${file.facts.borrowerFirstName}`,
        payload,
        sources: draft.sources,
        confidence: draft.confidence,
        ai_run_id: runId,
      })
      .select('id')
      .single()
    if (item.error) throw new Error(`Could not add the draft to the queue: ${item.error.message}`)
    await db.from('ai_runs').update({ status: 'succeeded', output: { draft, payload }, model: usage.model, input_tokens: usage.input, output_tokens: usage.output }).eq('id', runId)
    return reply(200, { actionId: item.data.id, runId })
  } catch (e) {
    return failRun(db, runId, usage, e)
  }
}

// ---------------------------------------------------------------------------
// Read the contract
// ---------------------------------------------------------------------------

/** Contracts are read with Opus (approved by Connor): misreading a date or amount costs more than the price difference. */
const READ_MODEL = 'claude-opus-5-5'
const READABLE: Record<string, 'document' | 'image'> = { 'application/pdf': 'document', 'image/jpeg': 'image', 'image/png': 'image' }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface DocRow {
  id: string
  kind: string
  file_name: string
  storage_path: string
  content_type: string | null
  size_bytes: number | null
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

async function handleContractRead(db: SupabaseClient, body: unknown, userId: string, apiKey: string) {
  const loanId = (body as { loanId?: unknown } | null)?.loanId
  if (typeof loanId !== 'string' || !UUID.test(loanId)) return reply(400, { error: 'Missing or invalid loan.' })

  const loan = await db.from('loans').select('id, organization_id').eq('id', loanId).maybeSingle()
  if (loan.error || !loan.data) return reply(400, { error: "Loan not found, or you don't have access." })
  const organizationId = loan.data.organization_id as string
  const docs = await db.from('loan_documents').select('id, kind, file_name, storage_path, content_type, size_bytes').eq('loan_id', loanId).in('kind', ['purchase_contract', 'contract_addendum']).order('created_at')
  if (docs.error) return reply(500, { error: docs.error.message })
  // The contract first, then addenda in the order they were uploaded.
  const files = ((docs.data ?? []) as DocRow[]).sort((a, b) => Number(b.kind === 'purchase_contract') - Number(a.kind === 'purchase_contract'))
  if (files.length === 0) return reply(400, { error: 'Upload the executed contract first.' })
  const unsupported = files.filter((f) => !f.content_type || !READABLE[f.content_type])
  if (unsupported.length) return reply(400, { error: `The assistant reads PDFs, JPGs and PNGs. Re-upload ${unsupported.map((f) => f.file_name).join(', ')} in one of those formats.` })
  const total = files.reduce((s, f) => s + (f.size_bytes ?? 0), 0)
  if (total > MAX_READ_BYTES) return reply(400, { error: `The contract documents add up to ${Math.round(total / 1024 / 1024)} MB; the assistant can read 20 MB at a time. Remove pages that aren't part of the contract.` })

  const runId = await startRun(db, organizationId, loanId, 'contract_read', { loanId, documentIds: files.map((f) => f.id) }, READ_MODEL, userId)
  const usage: Usage = { input: 0, output: 0, model: READ_MODEL }
  try {
    const content: unknown[] = []
    for (const f of files) {
      const blob = await db.storage.from('loan-files').download(f.storage_path)
      if (blob.error || !blob.data) throw new Error(`Could not open ${f.file_name}: ${blob.error?.message ?? 'missing file'}`)
      const data = base64(new Uint8Array(await blob.data.arrayBuffer()))
      content.push(
        READABLE[f.content_type!] === 'document'
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data }, title: f.file_name }
          : { type: 'image', source: { type: 'base64', media_type: f.content_type, data } },
      )
    }
    content.push({ type: 'text', text: `${CONTRACT_USER_PROMPT}\n\nDocuments, in order: ${files.map((f, i) => `${i + 1}. ${f.file_name}`).join('; ')}. Count pages from the first page of the first document.` })

    const params = {
      model: READ_MODEL,
      max_tokens: 16000,
      system: CONTRACT_SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: CONTRACT_SCHEMA } },
      // If Opus declines on a safety check, the API retries on a suitable model itself.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    }
    const res = await new Anthropic({ apiKey }).beta.messages.create(params as never)
    usage.input += res.usage.input_tokens
    usage.output += res.usage.output_tokens
    usage.model = res.model
    if (res.stop_reason === 'refusal') throw new UserError('The assistant declined to read these documents.')
    if (res.stop_reason === 'max_tokens') throw new UserError('The reading came back cut off. Try again.')
    const text = res.content.flatMap((b: { type: string; text?: string }) => (b.type === 'text' && b.text ? [b.text] : [])).join('')
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      throw new UserError('The assistant returned something unreadable. Try again.')
    }
    const reading = normalizeReading(raw)
    if ('error' in reading) throw new UserError(reading.error)

    const labels = new Map<string, string>(CONTRACT_FIELDS.map((f) => [f.key, f.label]))
    const unreadableNote = reading.unreadable.length ? `Couldn't read cleanly: ${reading.unreadable.map((u) => `${labels.get(u.key)} ("${u.text}")`).join('; ')}.` : null
    const notes = [reading.notes, unreadableNote].filter(Boolean).join('\n') || null

    // A new reading replaces any earlier one still waiting for review.
    const now = new Date().toISOString()
    const older = await db.from('contract_extractions').update({ status: 'discarded', decided_at: now, decided_by: userId }).eq('loan_id', loanId).eq('status', 'pending_review').select('id')
    for (const o of (older.data ?? []) as { id: string }[]) {
      await db.from('action_items').update({ status: 'dismissed', decided_at: now, decided_by: userId }).eq('loan_id', loanId).eq('status', 'pending').eq('payload->>extractionId', o.id)
    }

    const extraction = await db
      .from('contract_extractions')
      .insert({ organization_id: organizationId, loan_id: loanId, document_ids: files.map((f) => f.id), ai_run_id: runId, fields: reading.fields.map((f) => ({ ...f, decision: null, final: null })), contacts: reading.contacts, notes })
      .select('id')
      .single()
    if (extraction.error) throw new Error(`Could not save the reading: ${extraction.error.message}`)
    const extractionId = extraction.data.id as string

    const lowest = reading.fields.some((f) => f.confidence === 'low') ? 'low' : reading.fields.some((f) => f.confidence === 'medium') ? 'medium' : 'high'
    const item = await db
      .from('action_items')
      .insert({
        organization_id: organizationId,
        loan_id: loanId,
        kind: 'field_update',
        title: `Review the contract reading (${reading.fields.length} terms, ${reading.contacts.length} people)`,
        payload: { extractionId, section: 'contract' },
        sources: reading.fields.filter((f) => f.quote).slice(0, 3).map((f) => ({ label: labels.get(f.key), quote: f.quote, page: f.page })),
        confidence: lowest,
        ai_run_id: runId,
      })
      .select('id')
      .single()
    if (item.error) throw new Error(`Could not add the review to the queue: ${item.error.message}`)
    await db.from('ai_runs').update({ status: 'succeeded', output: reading, model: usage.model, input_tokens: usage.input, output_tokens: usage.output }).eq('id', runId)
    return reply(200, { extractionId, actionId: item.data.id, runId })
  } catch (e) {
    return failRun(db, runId, usage, e)
  }
}

// ---------------------------------------------------------------------------
// Read call notes
// ---------------------------------------------------------------------------

/** Call notes are read with Opus (approved by Connor): misreading income or a debt changes the prequal. */
const NOTES_MODEL = 'claude-opus-5-5'

async function handleNotesRead(db: SupabaseClient, body: unknown, userId: string, apiKey: string) {
  const { loanId, noteId } = (body ?? {}) as { loanId?: unknown; noteId?: unknown }
  if (typeof loanId !== 'string' || !UUID.test(loanId) || typeof noteId !== 'string' || !UUID.test(noteId)) return reply(400, { error: 'Missing or invalid loan or note.' })

  const loan = await db.from('loans').select('id, organization_id, purpose, borrowers:loan_borrowers ( role, contact_id, contact:contacts!loan_borrowers_contact_id_fkey ( first_name ) )').eq('id', loanId).maybeSingle()
  if (loan.error || !loan.data) return reply(400, { error: "Loan not found, or you don't have access." })
  const organizationId = loan.data.organization_id as string
  const people = (loan.data.borrowers ?? []) as unknown as { role: string; contact_id: string; contact: { first_name: string } | null }[]
  const note = await db.from('notes').select('id, contact_id, body').eq('id', noteId).maybeSingle()
  if (note.error || !note.data) return reply(400, { error: "Note not found, or you don't have access." })
  const noteRow = note.data as { id: string; contact_id: string; body: string }
  if (!people.some((p) => p.contact_id === noteRow.contact_id)) return reply(400, { error: 'That note belongs to someone who is not on this loan.' })
  const noteText = noteRow.body

  const runId = await startRun(db, organizationId, loanId, 'call_notes_read', { loanId, noteId }, NOTES_MODEL, userId)
  const usage: Usage = { input: 0, output: 0, model: NOTES_MODEL }
  try {
    const names = people.map((p) => `${p.contact?.first_name ?? 'Unknown'} (${p.role === 'primary' ? 'main borrower' : 'co-borrower'})`).join(', ')
    const params = {
      model: NOTES_MODEL,
      max_tokens: 16000,
      system: NOTES_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `People on this file: ${names}. Loan purpose: ${String(loan.data.purpose).replace(/_/g, ' ')}.

<call_notes>
${noteText}
</call_notes>` }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: NOTES_SCHEMA } },
      // If Opus declines on a safety check, the API retries on a suitable model itself.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    }
    const res = await new Anthropic({ apiKey }).beta.messages.create(params as never)
    usage.input += res.usage.input_tokens
    usage.output += res.usage.output_tokens
    usage.model = res.model
    if (res.stop_reason === 'refusal') throw new UserError('The assistant declined to read this note.')
    if (res.stop_reason === 'max_tokens') throw new UserError('The reading came back cut off. Try again.')
    const text = res.content.flatMap((b: { type: string; text?: string }) => (b.type === 'text' && b.text ? [b.text] : [])).join('')
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      throw new UserError('The assistant returned something unreadable. Try again.')
    }
    const reading = normalizeNotes(raw, noteText)
    if ('error' in reading) throw new UserError(reading.error)

    // A new reading replaces any earlier one still waiting for review.
    const now = new Date().toISOString()
    const older = await db.from('call_note_readings').update({ status: 'discarded', decided_at: now, decided_by: userId }).eq('loan_id', loanId).eq('status', 'pending_review').select('id')
    for (const o of (older.data ?? []) as { id: string }[]) {
      await db.from('action_items').update({ status: 'dismissed', decided_at: now, decided_by: userId }).eq('loan_id', loanId).eq('status', 'pending').eq('payload->>readingId', o.id)
    }

    const saved = await db
      .from('call_note_readings')
      .insert({ organization_id: organizationId, loan_id: loanId, note_id: noteId, ai_run_id: runId, items: reading.items.map((i) => ({ ...i, decision: null })), notes: reading.notes })
      .select('id')
      .single()
    if (saved.error) throw new Error(`Could not save the reading: ${saved.error.message}`)
    const readingId = saved.data.id as string

    const lowest = reading.items.some((i) => i.confidence === 'low') ? 'low' : reading.items.some((i) => i.confidence === 'medium') ? 'medium' : 'high'
    const item = await db
      .from('action_items')
      .insert({
        organization_id: organizationId,
        loan_id: loanId,
        kind: 'field_update',
        title: `Review the call notes reading (${reading.items.length} items)`,
        payload: { readingId, section: 'prequal' },
        sources: reading.items.filter((i) => i.quote && i.quoteFound).slice(0, 3).map((i) => ({ label: 'Call notes', quote: i.quote })),
        confidence: lowest,
        ai_run_id: runId,
      })
      .select('id')
      .single()
    if (item.error) throw new Error(`Could not add the review to the queue: ${item.error.message}`)
    await db.from('ai_runs').update({ status: 'succeeded', output: reading, model: usage.model, input_tokens: usage.input, output_tokens: usage.output }).eq('id', runId)
    return reply(200, { readingId, actionId: item.data.id, runId })
  } catch (e) {
    return failRun(db, runId, usage, e)
  }
}
