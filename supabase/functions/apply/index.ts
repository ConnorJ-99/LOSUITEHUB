// MPS HQ: the apply Edge Function (Stage 5, the borrower application).
// Verify JWT is OFF: borrowers don't sign in. Two ways in:
//   standalone (/apply, for mps.mortgage): `start` makes an application and
//     returns a resume code (only its hash is saved) the page keeps on the
//     borrower's device; `lo` names the loan officer (else the owner).
//   portal (/u/{token}): the portal link's token + its 24-hour session (after
//     the email check, same rules as the portal); the application belongs to
//     that borrower's file.
// Actions: start, load, save (one step at a time), submit.
// submit: every step checked again here (form.ts); no Social Security number
// anywhere; the credit authorization consent saved with its wording version
// and a one-way IP code. Standalone: lead intake (intake_web_lead(): matched
// by email or phone, never by name); a new file gets the answers in its 1003
// at once (apply_application()), a file that was already open waits for
// Connor's "Add to the 1003". Portal: waits for that click too. Then the GHL
// contact is matched or made (the ghl function's own matching, test mode
// respected) and a thank-you text and email are DRAFTED in the Action Queue.
// Nothing is ever sent from here.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import { CREDIT_AUTH_VERSION, blankAnswers, hasSsn, intakePayload, normalizeAnswers, stepProblems, submitProblems, thankYouDrafts, type ApplicationAnswers, type StepId } from './form.ts'
import { linkState, sessionValid } from '../document-upload/rules.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const MAX_BODY_BYTES = 200_000
const HEX64 = /^[0-9a-f]{64}$/i
const STARTS_PER_HOUR = 5

const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
const randomHex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')
const todayInDallas = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())

async function ipHash(request: Request): Promise<string | null> {
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || request.headers.get('x-real-ip') || ''
  if (!ip) return null
  return sha256(`${Deno.env.get('PAGE_IP_SALT') ?? Deno.env.get('SUPABASE_URL') ?? 'mps-hq'}:${ip}`)
}

interface AppRow {
  id: string
  organization_id: string
  loan_id: string | null
  contact_id: string | null
  link_id: string | null
  assigned_to_email: string | null
  answers: ApplicationAnswers
  step: string | null
  status: 'in_progress' | 'submitted'
}

const APP_SELECT = 'id, organization_id, loan_id, contact_id, link_id, assigned_to_email, answers, step, status'

/** The portal link and session the page presents (same rules as the portal), or a reply to send back. */
async function portalLink(db: SupabaseClient, body: Record<string, unknown>) {
  const token = typeof body.portalToken === 'string' && HEX64.test(body.portalToken) ? body.portalToken.toLowerCase() : null
  if (!token) return reply(404, { error: 'This link is not available.' })
  const r = await db.from('document_upload_links').select('id, organization_id, loan_id, contact_id, kind, expires_at, revoked_at, session_hash, session_expires_at').eq('token_hash', await sha256(token)).maybeSingle()
  const l = r.data as { id: string; organization_id: string; loan_id: string; contact_id: string; kind: string; expires_at: string; revoked_at: string | null; session_hash: string | null; session_expires_at: string | null } | null
  if (!l || l.kind !== 'portal') return reply(404, { error: 'This link is not available.' })
  if (linkState({ expiresAt: l.expires_at, revokedAt: l.revoked_at }, new Date()) !== 'open') return reply(410, { state: 'expired' })
  const presented = typeof body.session === 'string' && body.session.length >= 32 ? await sha256(body.session) : null
  if (!sessionValid({ sessionHash: l.session_hash, sessionExpiresAt: l.session_expires_at }, presented, new Date())) return reply(401, { state: 'ask_email' })
  return l
}

/** The application this request is about: by resume code (standalone) or by portal link. */
async function findApp(db: SupabaseClient, body: Record<string, unknown>): Promise<AppRow | Response> {
  if (typeof body.resume === 'string') {
    if (!HEX64.test(body.resume)) return reply(404, { error: 'That application was not found. Start a new one.' })
    const r = await db.from('borrower_applications').select(APP_SELECT).eq('resume_hash', await sha256(body.resume.toLowerCase())).maybeSingle()
    if (!r.data) return reply(404, { error: 'That application was not found. Start a new one.' })
    return r.data as AppRow
  }
  const l = await portalLink(db, body)
  if (l instanceof Response) return l
  const r = await db.from('borrower_applications').select(APP_SELECT).eq('link_id', l.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (!r.data) return reply(404, { error: 'No application yet.' })
  return r.data as AppRow
}

/** Answers from the page: the known shape only (unknown keys dropped), never with an SSN. */
function cleanAnswers(raw: unknown): ApplicationAnswers | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  // Only the known keys, in this version's shape, with each job's monthly income worked out here (the 1003 reads it).
  const base = blankAnswers() as unknown as Record<string, unknown>
  const r = raw as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(base)) out[key] = key in r ? r[key] : base[key]
  return normalizeAnswers(out as Partial<ApplicationAnswers>)
}

async function start(request: Request, db: SupabaseClient, body: Record<string, unknown>) {
  // Portal: the borrower's own application for this file (one in progress at a time), started with what the file knows.
  if (typeof body.portalToken === 'string') {
    const l = await portalLink(db, body)
    if (l instanceof Response) return l
    const existing = await db.from('borrower_applications').select(APP_SELECT).eq('link_id', l.id).order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (existing.data) return reply(200, { answers: (existing.data as AppRow).answers, step: (existing.data as AppRow).step, status: (existing.data as AppRow).status })
    const c = await db.from('contacts').select('first_name, last_name, email, phone').eq('id', l.contact_id).single()
    const p = c.data as { first_name: string; last_name: string | null; email: string | null; phone: string | null }
    const answers = blankAnswers()
    answers.borrower = { ...answers.borrower, firstName: p.first_name ?? '', lastName: p.last_name ?? '', email: p.email ?? '', phone: p.phone ?? '' }
    const ins = await db.from('borrower_applications').insert({ organization_id: l.organization_id, loan_id: l.loan_id, contact_id: l.contact_id, link_id: l.id, answers, step: 'you' }).select(APP_SELECT).single()
    if (ins.error) throw new Error(ins.error.message)
    return reply(200, { answers, step: 'you', status: 'in_progress' })
  }
  // Standalone: a fresh application with a resume code, a few per hour per visitor.
  const ip = await ipHash(request)
  if (ip) {
    const hourAgo = new Date(Date.now() - 3600_000).toISOString()
    const recent = await db.from('borrower_applications').select('id', { count: 'exact', head: true }).eq('ip_hash', ip).gte('created_at', hourAgo)
    if ((recent.count ?? 0) >= STARTS_PER_HOUR) return reply(429, { error: 'Thanks! You have started a few applications already. Please continue the one you started, or try again in an hour.' })
  }
  const org = await db.from('organizations').select('id').order('created_at').limit(1).single()
  if (org.error) throw new Error(org.error.message)
  const lo = typeof body.lo === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.lo.trim()) ? body.lo.trim().toLowerCase() : null
  const resume = randomHex()
  const answers = blankAnswers()
  const ins = await db.from('borrower_applications').insert({ organization_id: (org.data as { id: string }).id, resume_hash: await sha256(resume), assigned_to_email: lo, answers, step: 'you', ip_hash: ip }).select('id').single()
  if (ins.error) throw new Error(ins.error.message)
  return reply(200, { resume, answers, step: 'you', status: 'in_progress' })
}

async function save(db: SupabaseClient, body: Record<string, unknown>) {
  const app = await findApp(db, body)
  if (app instanceof Response) return app
  if (app.status === 'submitted') return reply(409, { error: 'This application was already submitted. Thank you!' })
  const answers = cleanAnswers(body.answers)
  if (!answers) return reply(400, { error: 'Those answers could not be read.' })
  if (hasSsn(answers)) return reply(400, { error: "Please don't enter a Social Security number. We'll ask for it securely later." })
  const step = typeof body.step === 'string' ? (body.step as StepId) : app.step
  const r = await db.from('borrower_applications').update({ answers, step }).eq('id', app.id).eq('status', 'in_progress')
  if (r.error) throw new Error(r.error.message)
  // Problems on the step they're leaving, so the page can show them (saving still happens).
  return reply(200, { ok: true, problems: typeof body.leaving === 'string' ? stepProblems(body.leaving as StepId, answers, todayInDallas()) : [] })
}

async function submit(request: Request, db: SupabaseClient, body: Record<string, unknown>) {
  const app = await findApp(db, body)
  if (app instanceof Response) return app
  if (app.status === 'submitted') return reply(200, { ok: true, already: true })
  const answers = cleanAnswers(body.answers) ?? app.answers
  const problems = submitProblems(answers, todayInDallas())
  if (problems.length) return reply(400, { error: problems[0], problems })

  let loanId = app.loan_id
  let contactId = app.contact_id
  let outcome: 'new_lead' | 'new_loan_existing_person' | 'existing_open_loan' | 'portal' = 'portal'
  if (!app.link_id) {
    const intake = await db.rpc('intake_web_lead', { p_lead: intakePayload(answers, app.id, app.assigned_to_email) })
    if (intake.error) throw new Error(intake.error.message)
    const r = intake.data as { outcome: string; first_outcome?: string; loan_id: string; contact_id: string }
    loanId = r.loan_id
    contactId = r.contact_id
    const o = r.outcome === 'already_received' ? r.first_outcome : r.outcome
    outcome = o === 'new_lead' || o === 'new_loan_existing_person' ? o : 'existing_open_loan'
  }
  const upd = await db
    .from('borrower_applications')
    .update({ answers, loan_id: loanId, contact_id: contactId, status: 'submitted', submitted_at: new Date().toISOString(), outcome, step: 'review', credit_auth_at: new Date().toISOString(), credit_auth_version: CREDIT_AUTH_VERSION, ip_hash: await ipHash(request) })
    .eq('id', app.id)
    .eq('status', 'in_progress')
  if (upd.error) throw new Error(upd.error.message)

  // A file this application made gets the answers now; an open file waits for Connor.
  if (outcome === 'new_lead' || outcome === 'new_loan_existing_person') {
    const applied = await db.rpc('apply_application', { p_id: app.id })
    if (applied.error) console.error('apply_application failed:', applied.error.message)
  }
  await Promise.allSettled([linkGhl(app.organization_id, contactId!, loanId!), draftThankYou(db, app.organization_id, loanId!, contactId!, app.id, answers)])
  return reply(200, { ok: true })
}

/** The ghl function's own contact matching (server to server, with the timer key). */
async function linkGhl(organizationId: string, contactId: string, loanId: string) {
  const key = Deno.env.get('GHL_WEBHOOK_SECRET')
  if (!key) return
  await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/ghl?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SUPABASE_ANON_KEY') ?? ''}` },
    body: JSON.stringify({ task: 'page_contact', organizationId, contactId, loanId }),
  })
}

/** The thank-you text and email, as Action Queue drafts (never sent from here). */
async function draftThankYou(db: SupabaseClient, organizationId: string, loanId: string, contactId: string, appId: string, a: ApplicationAnswers) {
  const loan = await db.from('loans').select('assigned_lo_id').eq('id', loanId).single()
  const loId = (loan.data as { assigned_lo_id: string | null } | null)?.assigned_lo_id
  const lo = loId ? await db.from('profiles').select('full_name').eq('id', loId).maybeSingle() : null
  const loName = (lo?.data as { full_name: string | null } | null)?.full_name || 'MPS Mortgage'
  const person = await db.from('contacts').select('phone, email, sms_opted_out_at, email_opted_out_at').eq('id', contactId).single()
  const p = person.data as { phone: string | null; email: string | null; sms_opted_out_at: string | null; email_opted_out_at: string | null }
  const words = thankYouDrafts(a.borrower.firstName.trim() || 'there', loName)
  const name = `${a.borrower.firstName} ${a.borrower.lastName}`.trim()
  const items = [
    ...(p.phone && !p.sms_opted_out_at ? [{ channel: 'text', to: p.phone, subject: null, body: words.text }] : []),
    ...(p.email && !p.email_opted_out_at ? [{ channel: 'email', to: p.email, subject: words.subject, body: words.email }] : []),
  ]
  for (const d of items) {
    const ins = await db.from('action_items').insert({
      organization_id: organizationId,
      loan_id: loanId,
      kind: 'draft_message',
      title: `Thank ${name} for their application (${d.channel})`,
      payload: { ...d, contactId },
      sources: [],
      confidence: null,
      due_on: todayInDallas(),
      source_key: `application:${appId}:${d.channel}`,
    })
    if (ins.error && !ins.error.message.includes('duplicate')) console.error('thank-you draft failed:', ins.error.message)
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' })
  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) return reply(413, { error: 'That is too much to send at once.' })
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw)
  } catch {
    return reply(400, { error: 'The body must be JSON.' })
  }
  try {
    const db = admin()
    if (body.action === 'start') return await start(request, db, body)
    if (body.action === 'load') {
      const app = await findApp(db, body)
      if (app instanceof Response) return app
      return reply(200, { answers: app.answers, step: app.step, status: app.status })
    }
    if (body.action === 'save') return await save(db, body)
    if (body.action === 'submit') return await submit(request, db, body)
    return reply(400, { error: 'Unknown action.' })
  } catch (e) {
    console.error('apply failed:', (e as Error).message)
    return reply(500, { error: 'Something went wrong. Please try again.' })
  }
})
