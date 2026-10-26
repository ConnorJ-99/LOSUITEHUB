// LOSuite assistant: a Supabase Edge Function (Deno). The only place the app
// talks to Claude. The Anthropic API key lives in Edge Function secrets and
// never reaches the browser.
//
// Every request runs as the signed-in user (their token is passed through),
// so Row Level Security decides what the assistant can read and write.
// Nothing is sent to the borrower: a draft lands in the file's Action Queue
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

  const req = parseRequest(await request.json().catch(() => null))
  if ('error' in req) return reply(400, req)

  let file: Awaited<ReturnType<typeof loadFile>>
  try {
    file = await loadFile(db, req, userId)
  } catch (e) {
    return reply(e instanceof UserError ? 400 : 500, { error: (e as Error).message })
  }

  const run = await db
    .from('ai_runs')
    .insert({ organization_id: file.organizationId, loan_id: req.loanId, task_type: 'follow_up_draft', input_ref: file.inputRef, model: MODEL, created_by: userId })
    .select('id')
    .single()
  if (run.error) return reply(500, { error: `Could not log the run: ${run.error.message}` })
  const runId = run.data.id as string

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
    const message = e instanceof UserError ? e.message : e instanceof Anthropic.APIError ? `Claude API error (${e.status ?? 'network'}): ${e.message}` : (e as Error).message
    await db.from('ai_runs').update({ status: 'failed', error: message, model: usage.model, input_tokens: usage.input, output_tokens: usage.output }).eq('id', runId)
    return reply(e instanceof UserError ? 422 : 502, { error: message, runId })
  }
})
