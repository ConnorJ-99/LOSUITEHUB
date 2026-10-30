// LOSuite ↔ GoHighLevel: a Supabase Edge Function (Deno). Phase 1 (Connor,
// 2026-10-29; plan in docs/plans/ghl-messaging.md) connects LOSuite to the
// MPS Mortgage sub-account. Tasks:
// - "status": whether GHL is set up (any signed-in user; no GHL call), like
//   the assistant's, so nothing else in the app depends on GHL.
// - "token_check": a read-only look at what the Private Integration Token can
//   do (sub-account name, GHL users, phone numbers, which calls work or need a
//   scope), then re-confirms every team member's linked number and records
//   this company as the sub-account's owner (for ghl-inbound).
// - "link_user": links a team member to their GHL user, after GHL confirms the
//   number assigned to that user. Texts only ever go from that number.
// - "send" (Phase 3): sends one text or email that a person wrote or approved.
//   Anyone who can see the person's file may send; the server re-checks every
//   rule first (sendRules.ts: consent, opt-outs, sending hours, test mode, the
//   LO's confirmed number), re-checks GHL's Do Not Disturb live, and saves the
//   message with its idempotency key before calling GHL so it can't go twice.
//   It uses the person's existing GHL contact (found by phone or email) and
//   never creates GHL contacts or adds tags (tags start Connor's workflows).
//
// The token and location id live in Edge Function secrets (GHL_PRIVATE_TOKEN,
// GHL_LOCATION_ID) and never reach the browser or the logs. Requests run as
// the signed-in user, so Row Level Security applies; check and link are for
// owners and admins. Messages and the send log are written with the service
// role after those checks. Every GHL call is logged in ghl_calls (path, answer
// code, ids; never the token). Nothing is enrolled in a workflow.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import {
  CHECKS,
  GHL_BASE,
  NO_SUCH_ID,
  assignedNumber,
  classify,
  logEndpoint,
  missingScopes,
  pickNumbers,
  pickUsers,
  type CheckKey,
  type CheckOutcome,
  type CheckPlan,
  type CheckResult,
  type GhlNumber,
  type GhlUser,
} from './checks.ts'
import { e164, planSend, textToHtml, type SendHoursValue } from './sendRules.ts'
import { pickContact } from '../ghl-inbound/sync.ts'

const TIMEOUT_MS = 10_000

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

/** An error whose message is safe and useful to show Connor. */
class UserError extends Error {}

interface Answer {
  status: number | null
  body: unknown
}

interface LoggedCall {
  method: string
  endpoint: string
  http_status: number | null
  result: CheckResult
  detail: string
}

const plan = (key: CheckKey) => CHECKS.find((c) => c.key === key)!

/** Calls GHL with the token and remembers each call for the log. */
class Ghl {
  calls: LoggedCall[] = []
  constructor(private token: string, readonly locationId: string) {}

  /** Errors come back as an answer, never thrown, so one failed call doesn't stop the rest. */
  async call(p: CheckPlan, path: string, body?: unknown): Promise<Answer & { outcome: ReturnType<typeof classify> }> {
    let answer: Answer
    try {
      const res = await fetch(`${GHL_BASE}${path}`, {
        method: p.method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Version: p.version,
          Accept: 'application/json',
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      const text = await res.text()
      let parsed: unknown = text
      try {
        parsed = JSON.parse(text)
      } catch {
        // Keep the plain text.
      }
      answer = { status: res.status, body: parsed }
    } catch (e) {
      answer = { status: null, body: (e as Error).name === 'TimeoutError' ? 'GHL took too long to answer.' : 'Could not reach GHL.' }
    }
    const outcome = classify(p, answer.status, answer.body)
    this.calls.push({ method: p.method, endpoint: logEndpoint(path), http_status: answer.status, result: outcome.result, detail: outcome.detail })
    return { ...answer, outcome }
  }
}

interface People {
  location: { name: string | null; timezone: string | null } | null
  users: GhlUser[]
  numbers: GhlNumber[]
  usersOk: boolean
  outcomes: CheckOutcome[]
}

/** The sub-account, its users and its phone numbers. */
async function loadPeople(g: Ghl): Promise<People> {
  const loc = encodeURIComponent(g.locationId)
  const outcomes: CheckOutcome[] = []
  const record = (key: CheckKey, a: { outcome: ReturnType<typeof classify> }) => {
    const p = plan(key)
    outcomes.push({ key, label: p.label, scope: p.scope, ...a.outcome })
    return a.outcome.result === 'works'
  }

  // GET /locations/{locationId} (locations.readonly). companyId is needed for the user search.
  const location = await g.call(plan('location'), `/locations/${loc}`)
  const locOk = record('location', location)
  const locBody = (location.body as { location?: Record<string, unknown> } | null)?.location
  const companyId = locOk && typeof locBody?.companyId === 'string' ? locBody.companyId : null

  // GET /users/search?companyId&locationId (users.readonly); the older GET /users/?locationId is deprecated, so it's only a fallback.
  let usersAnswer = companyId ? await g.call(plan('users'), `/users/search?companyId=${encodeURIComponent(companyId)}&locationId=${loc}&limit=100`) : null
  if (!usersAnswer || usersAnswer.outcome.result !== 'works') {
    const fallback = await g.call(plan('users'), `/users/?locationId=${loc}`)
    if (!usersAnswer || fallback.outcome.result === 'works') usersAnswer = fallback
  }
  const usersOk = record('users', usersAnswer)

  // GET /phone-system/numbers/location/{locationId} (phonenumbers.read).
  const numbersAnswer = await g.call(plan('phone_numbers'), `/phone-system/numbers/location/${loc}?pageSize=100`)
  const numbersOk = record('phone_numbers', numbersAnswer)

  return {
    location: locOk ? { name: (locBody?.name as string | undefined) ?? null, timezone: (locBody?.timezone as string | undefined) ?? null } : null,
    users: usersOk ? pickUsers(usersAnswer.body, g.locationId) : [],
    numbers: numbersOk ? pickNumbers(numbersAnswer.body) : [],
    usersOk,
    outcomes,
  }
}

/** The rest of the read-only checks, after loadPeople. */
async function otherChecks(g: Ghl): Promise<CheckOutcome[]> {
  const loc = encodeURIComponent(g.locationId)
  const outcomes: CheckOutcome[] = []
  const record = (key: CheckKey, a: { outcome: ReturnType<typeof classify> }) => {
    const p = plan(key)
    outcomes.push({ key, label: p.label, scope: p.scope, ...a.outcome })
  }

  // GET /contacts/search/duplicate (contacts.readonly) with an address no one has, so no person's data comes back.
  record('contacts_read', await g.call(plan('contacts_read'), `/contacts/search/duplicate?locationId=${loc}&email=${encodeURIComponent('token-check@example.com')}`))

  // PUT /contacts/{contactId} (contacts.write): a blank update to a contact that doesn't exist.
  record('contacts_write', await g.call(plan('contacts_write'), `/contacts/${NO_SUCH_ID}`, {}))

  // GET /conversations/search (conversations.readonly), one conversation. Its contents aren't kept.
  const convs = await g.call(plan('conversations_read'), `/conversations/search?locationId=${loc}&limit=1`)
  record('conversations_read', convs)
  const firstConversation = ((convs.body as { conversations?: { id?: unknown }[] } | null)?.conversations ?? [])[0]?.id

  // GET /conversations/{conversationId}/messages (conversations/message.readonly), one message, contents not kept.
  // With no conversation to read, ask for a message that doesn't exist: "not found" still proves the scope.
  record(
    'messages_read',
    typeof firstConversation === 'string'
      ? await g.call(plan('messages_read'), `/conversations/${encodeURIComponent(firstConversation)}/messages?limit=1`)
      : await g.call({ ...plan('messages_read'), dryRun: true }, `/conversations/messages/${NO_SUCH_ID}`),
  )

  // POST /conversations/messages (conversations/message.write) with only a type: no contact, no text, so nothing can be sent.
  record('messages_write', await g.call(plan('messages_write'), '/conversations/messages', { type: 'SMS' }))
  return outcomes
}

interface LinkRow {
  id: string
  profile_id: string
  ghl_user_id: string
  ghl_number: string | null
  number_confirmed_at: string | null
}

/** What a link should say now, from GHL's users and numbers. Unknown GHL user = not confirmed. */
function linkFacts(ghlUserId: string, people: People) {
  const user = people.users.find((u) => u.id === ghlUserId) ?? null
  const number = user ? assignedNumber(user, people.numbers) : null
  return { user, number, confirmedAt: number ? new Date().toISOString() : null }
}

/** Re-confirms every linked number in the company. Skipped when GHL's users couldn't be read. */
async function refreshLinks(db: SupabaseClient, organizationId: string, people: People): Promise<number> {
  if (!people.usersOk) return 0
  const links = await db.from('ghl_user_links').select('id, profile_id, ghl_user_id, ghl_number, number_confirmed_at').eq('organization_id', organizationId)
  if (links.error) throw new Error(links.error.message)
  let changed = 0
  for (const link of (links.data ?? []) as LinkRow[]) {
    const { user, number, confirmedAt } = linkFacts(link.ghl_user_id, people)
    const row = user
      ? { ghl_name: user.name, ghl_email: user.email, ghl_number: number, number_confirmed_at: confirmedAt, checked_at: new Date().toISOString() }
      : { number_confirmed_at: null, checked_at: new Date().toISOString() }
    const update = await db.from('ghl_user_links').update(row).eq('id', link.id)
    if (update.error) throw new Error(update.error.message)
    changed++
  }
  return changed
}

/** Saves the call log. A failure here is reported, not hidden. */
async function saveLog(db: SupabaseClient, organizationId: string, userId: string, task: string, g: Ghl, ids: Record<string, string> = {}): Promise<string | null> {
  if (!g.calls.length) return null
  const result = await db.from('ghl_calls').insert(g.calls.map((c) => ({ organization_id: organizationId, called_by: userId, task, ...c, ghl_ids: ids })))
  return result.error ? `The GHL call log wasn't saved: ${result.error.message}` : null
}

async function tokenCheck(db: SupabaseClient, g: Ghl, organizationId: string, userId: string) {
  const people = await loadPeople(g)
  const checks = [...people.outcomes, ...(await otherChecks(g))]
  const linksChecked = await refreshLinks(db, organizationId, people)
  // ghl-inbound finds the company that owns this sub-account here.
  const owner = await db.from('messaging_settings').upsert({ organization_id: organizationId, ghl_location_id: g.locationId }, { onConflict: 'organization_id' })
  if (owner.error) {
    if (owner.error.code === '23505') throw new UserError('This GHL sub-account is already connected to another company in LOSuite.')
    throw new Error(owner.error.message)
  }
  const logError = await saveLog(db, organizationId, userId, 'token_check', g)
  return {
    location: people.location,
    users: people.users,
    numbers: people.numbers,
    checks,
    missingScopes: missingScopes(checks),
    tokenRejected: checks.some((o) => o.result === 'bad_token'),
    linksChecked,
    logError,
  }
}

async function linkUser(db: SupabaseClient, g: Ghl, organizationId: string, userId: string, body: Record<string, unknown>) {
  const profileId = typeof body.profileId === 'string' ? body.profileId : null
  const ghlUserId = typeof body.ghlUserId === 'string' ? body.ghlUserId.trim() : ''
  if (!profileId || !ghlUserId) throw new UserError('Pick a team member and a GHL user.')

  const member = await db.from('organization_members').select('user_id').eq('organization_id', organizationId).eq('user_id', profileId).maybeSingle()
  if (member.error) throw new Error(member.error.message)
  if (!member.data) throw new UserError('That person is not on the team.')

  const people = await loadPeople(g)
  const logError = await saveLog(db, organizationId, userId, 'link_user', g, { ghlUserId })
  if (!people.usersOk) throw new UserError('GHL users could not be read. Check connection for the reason.')
  const { user, number, confirmedAt } = linkFacts(ghlUserId, people)
  if (!user) throw new UserError('That GHL user was not found in the MPS Mortgage sub-account.')

  const saved = await db
    .from('ghl_user_links')
    .upsert(
      {
        organization_id: organizationId,
        profile_id: profileId,
        ghl_user_id: user.id,
        ghl_name: user.name,
        ghl_email: user.email,
        ghl_number: number,
        number_confirmed_at: confirmedAt,
        checked_at: new Date().toISOString(),
        linked_by: userId,
      },
      { onConflict: 'organization_id,profile_id' },
    )
    .select('id, profile_id, ghl_user_id, ghl_name, ghl_email, ghl_number, number_confirmed_at')
    .single()
  if (saved.error) {
    if (saved.error.code === '23505') throw new UserError(`${user.name} is already linked to someone else on the team. Unlink them first.`)
    throw new Error(saved.error.message)
  }
  return { link: saved.data, logError }
}


interface SendRequest {
  contactId: string
  loanId: string
  channel: 'text' | 'email'
  body: string
  subject: string | null
  idempotencyKey: string
}

function parseSend(body: Record<string, unknown>): SendRequest {
  const s = (v: unknown) => (typeof v === 'string' ? v : '')
  const channel = body.channel === 'email' ? 'email' : body.channel === 'text' ? 'text' : null
  if (!channel) throw new UserError('Pick Text or Email.')
  const key = s(body.idempotencyKey).trim()
  if (key.length < 8 || key.length > 100) throw new UserError('Missing send key; refresh the page and try again.')
  if (!s(body.contactId) || !s(body.loanId)) throw new UserError('Which person and file?')
  return { contactId: s(body.contactId), loanId: s(body.loanId), channel, body: s(body.body), subject: s(body.subject).trim() || null, idempotencyKey: key }
}

/** The person's GHL contact: GHL's match for their phone, then email. Never creates one. */
async function findGhlContact(g: Ghl, phone: string | null, email: string | null): Promise<string | null> {
  const loc = encodeURIComponent(g.locationId)
  const number = e164(phone)
  const tries = [number && `number=${encodeURIComponent(number)}`, email && `email=${encodeURIComponent(email.trim().toLowerCase())}`].filter(Boolean)
  for (const q of tries) {
    // GET /contacts/search/duplicate (contacts.readonly, Version 2021-07-28).
    const a = await g.call(plan('contacts_read'), `/contacts/search/duplicate?locationId=${loc}&${q}`)
    const id = (a.body as { contact?: { id?: unknown } | null } | null)?.contact?.id
    if (a.outcome.result === 'works' && typeof id === 'string' && id) return id
  }
  return null
}

const DEFAULT_HOURS: SendHoursValue = { mon: ['09:00', '21:00'], tue: ['09:00', '21:00'], wed: ['09:00', '21:00'], thu: ['09:00', '21:00'], fri: ['09:00', '21:00'], sat: ['09:00', '21:00'], sun: ['12:00', '21:00'] }

async function sendMessage(db: SupabaseClient, admin: SupabaseClient, g: Ghl, organizationId: string, userId: string, body: Record<string, unknown>) {
  const req = parseSend(body)

  // What the sender can see (Row Level Security): the person, and that they're on this file.
  const person = await db
    .from('contacts')
    .select('id, first_name, last_name, email, phone, sms_consent, email_consent, sms_opted_out_at, email_opted_out_at, ghl_contact_id')
    .eq('id', req.contactId)
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (person.error) throw new Error(person.error.message)
  if (!person.data) throw new UserError('That person was not found, or their file is not yours.')
  const p = person.data as {
    first_name: string | null
    last_name: string | null
    email: string | null
    phone: string | null
    sms_consent: boolean | null
    email_consent: boolean | null
    sms_opted_out_at: string | null
    email_opted_out_at: string | null
    ghl_contact_id: string | null
  }
  const first = p.first_name || 'This person'
  const onFile = await db.from('loan_borrowers').select('loan_id, loan:loans ( assigned_lo_id )').eq('loan_id', req.loanId).eq('contact_id', req.contactId).maybeSingle()
  if (onFile.error) throw new Error(onFile.error.message)
  if (!onFile.data) throw new UserError('That person is not on this file.')
  const loId = (onFile.data as unknown as { loan: { assigned_lo_id: string | null } | null }).loan?.assigned_lo_id ?? null

  // A message already sent (or being sent) with this key: say so, never send again.
  const already = await admin.from('messages').select('id, status, send_error').eq('organization_id', organizationId).eq('idempotency_key', req.idempotencyKey).maybeSingle()
  if (already.error) throw new Error(already.error.message)
  if (already.data) return { alreadySent: true, status: already.data.status, error: already.data.send_error }

  const settings = await admin.from('messaging_settings').select('send_hours, inbound_mode, email_domain_verified').eq('organization_id', organizationId).maybeSingle()
  if (settings.error) throw new Error(settings.error.message)
  const s = settings.data as { send_hours: SendHoursValue; inbound_mode: string; email_domain_verified: boolean } | null
  let lo: { name: string; ghlNumber: string | null; numberConfirmed: boolean; ghlEmail: string | null } | null = null
  if (loId) {
    const prof = await db.from('profiles').select('full_name, email').eq('id', loId).maybeSingle()
    const link = await admin.from('ghl_user_links').select('ghl_number, ghl_email, number_confirmed_at').eq('organization_id', organizationId).eq('profile_id', loId).maybeSingle()
    if (prof.error || link.error) throw new Error((prof.error ?? link.error)!.message)
    const pr = prof.data as { full_name: string | null; email: string } | null
    const l = link.data as { ghl_number: string | null; ghl_email: string | null; number_confirmed_at: string | null } | null
    lo = { name: pr?.full_name || pr?.email || 'The loan officer', ghlNumber: l?.ghl_number ?? null, numberConfirmed: !!l?.number_confirmed_at, ghlEmail: l?.ghl_email ?? null }
  }

  const sendPlan = planSend({
    channel: req.channel,
    body: req.body,
    subject: req.subject,
    person: {
      firstName: p.first_name,
      lastName: p.last_name,
      phone: p.phone,
      email: p.email,
      smsConsent: p.sms_consent,
      emailConsent: p.email_consent,
      smsOptedOutAt: p.sms_opted_out_at,
      emailOptedOutAt: p.email_opted_out_at,
    },
    // No settings row yet: test mode and the default hours.
    testMode: (s?.inbound_mode ?? 'test_only') === 'test_only',
    hours: s?.send_hours ?? DEFAULT_HOURS,
    now: new Date(),
    lo,
    emailDomainVerified: s?.email_domain_verified ?? false,
  })
  if (sendPlan.problems.length) throw new UserError(sendPlan.problems.join(' '))

  // The person's GHL contact (found, never created), linked to them the first time.
  let ghlContactId = p.ghl_contact_id
  if (!ghlContactId) {
    ghlContactId = await findGhlContact(g, p.phone, p.email)
    if (!ghlContactId) throw new UserError(`${first} isn't a contact in GHL yet. Add them in GHL (no tags needed), then send again. LOSuite doesn't create GHL contacts.`)
    const taken = await admin.from('contacts').select('id').eq('organization_id', organizationId).eq('ghl_contact_id', ghlContactId).neq('id', req.contactId).maybeSingle()
    if (taken.error) throw new Error(taken.error.message)
    if (taken.data) throw new UserError('That phone or email belongs to a GHL contact already linked to someone else in LOSuite. An admin should check who is who first.')
    const linked = await admin.from('contacts').update({ ghl_contact_id: ghlContactId }).eq('id', req.contactId).is('ghl_contact_id', null)
    if (linked.error) throw new Error(linked.error.message)
  }

  // GHL's Do Not Disturb, checked live: GET /contacts/{contactId} (contacts.readonly).
  const live = await g.call(plan('contacts_read'), `/contacts/${encodeURIComponent(ghlContactId)}`)
  const contact = live.outcome.result === 'works' ? pickContact(live.body) : null
  if (!contact) throw new UserError('GHL did not return this contact, so nothing was sent. Try again in a minute.')
  if (req.channel === 'text' ? contact.dndText : contact.dndEmail) {
    const field = req.channel === 'text' ? 'sms' : 'email'
    await admin.from('contacts').update({ [`${field}_consent`]: false, [`${field}_opted_out_at`]: new Date().toISOString() }).eq('id', req.contactId).is(`${field}_opted_out_at`, null)
    await admin.from('consent_events').insert({ organization_id: organizationId, contact_id: req.contactId, channel: req.channel, change: 'opted_out', source: 'ghl_dnd' })
    throw new UserError(`${first} has Do Not Disturb on in GHL, so ${req.channel === 'text' ? 'texting' : 'email'} is now turned off for them. Nothing was sent.`)
  }

  // The lock: saved with its key before GHL is called, so it can't go twice.
  const now = new Date().toISOString()
  const saved = await admin
    .from('messages')
    .insert({
      organization_id: organizationId,
      contact_id: req.contactId,
      loan_id: req.loanId,
      channel: req.channel,
      direction: 'outbound',
      subject: req.channel === 'email' ? req.subject : null,
      body: req.body.trim(),
      from_address: sendPlan.fromNumber ?? sendPlan.fromEmail,
      to_address: sendPlan.to,
      status: 'sending',
      sent_at: now,
      ghl_message_id: `losuite-${crypto.randomUUID()}`,
      ghl_contact_id: ghlContactId,
      ghl_contact_name: contact.name ?? ([contact.firstName, contact.lastName].filter(Boolean).join(' ') || null),
      ghl_contact_email: contact.email,
      ghl_contact_phone: contact.phone,
      match_status: 'matched',
      matched_by: 'ghl_id',
      read_at: now,
      idempotency_key: req.idempotencyKey,
      sent_by: userId,
    })
    .select('id')
    .single()
  if (saved.error) {
    if (saved.error.code === '23505') return { alreadySent: true, status: 'sending', error: null }
    throw new Error(saved.error.message)
  }
  const rowId = (saved.data as { id: string }).id

  // POST /conversations/messages (conversations/message.write, Version 2021-04-15).
  const text = req.body.trim()
  const payload =
    req.channel === 'text'
      ? { type: 'SMS', contactId: ghlContactId, message: text, fromNumber: sendPlan.fromNumber, toNumber: sendPlan.to }
      : { type: 'Email', contactId: ghlContactId, subject: req.subject, html: textToHtml(text), message: text, emailFrom: sendPlan.fromEmail, emailTo: sendPlan.to }
  const sent = await g.call({ ...plan('messages_write'), dryRun: false }, '/conversations/messages', payload)
  const result = (sent.body ?? {}) as { messageId?: unknown; conversationId?: unknown; status?: unknown }
  if (sent.outcome.result !== 'works' || typeof result.messageId !== 'string') {
    const why = sent.outcome.detail || 'GHL did not accept it.'
    await admin.from('messages').update({ status: 'failed', send_error: why }).eq('id', rowId)
    throw new UserError(`GHL didn't send it: ${why}`)
  }
  const status = typeof result.status === 'string' ? result.status : 'sent'
  const done = await admin
    .from('messages')
    .update({ ghl_message_id: result.messageId, ghl_conversation_id: typeof result.conversationId === 'string' ? result.conversationId : null, status })
    .eq('id', rowId)
  if (done.error?.code === '23505') {
    // The inbound check saved GHL's copy first: keep that one, with who sent it.
    await admin.from('messages').delete().eq('id', rowId)
    await admin.from('messages').update({ sent_by: userId, idempotency_key: req.idempotencyKey, read_at: now }).eq('organization_id', organizationId).eq('ghl_message_id', result.messageId)
  } else if (done.error) throw new Error(done.error.message)
  return { sent: true, status, from: sendPlan.fromNumber ?? sendPlan.fromEmail, to: sendPlan.to }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' })

  const auth = request.headers.get('Authorization')
  if (!auth) return reply(401, { error: 'Sign in first.' })

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: auth } },
    auth: { persistSession: false },
  })
  const { data: userData, error: userError } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ''))
  if (userError || !userData.user) return reply(401, { error: 'Your session expired. Sign in again.' })
  const userId = userData.user.id

  const token = Deno.env.get('GHL_PRIVATE_TOKEN')
  const locationId = Deno.env.get('GHL_LOCATION_ID')
  if (!token || !locationId) {
    return reply(500, { error: 'GHL is not set up yet: add GHL_PRIVATE_TOKEN and GHL_LOCATION_ID under Edge Functions → Secrets in Supabase.' })
  }

  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const task = body.task
  // The app asks this once to know whether GHL features can run (the secrets check above answers "not set up" first).
  if (task === 'status') return reply(200, { ready: true })

  try {
    const organizationId = typeof body.organizationId === 'string' ? body.organizationId : null
    if (!organizationId) throw new UserError('Which company? (organizationId is missing.)')
    const role = await db.from('organization_members').select('role').eq('organization_id', organizationId).eq('user_id', userId).maybeSingle()
    if (role.error) throw new Error(role.error.message)
    if (!role.data) return reply(403, { error: "You aren't on this company's team." })

    const g = new Ghl(token, locationId)
    if (task === 'send') {
      // Anyone who can see the person's file; the send itself re-checks everything.
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
      try {
        return reply(200, await sendMessage(db, admin, g, organizationId, userId, body))
      } finally {
        if (g.calls.length) await admin.from('ghl_calls').insert(g.calls.map((c) => ({ organization_id: organizationId, called_by: userId, task: 'send', ...c })))
      }
    }
    if (!['owner', 'admin'].includes((role.data as { role: string }).role)) return reply(403, { error: 'Only an owner or admin can manage the GHL connection.' })
    if (task === 'token_check') return reply(200, await tokenCheck(db, g, organizationId, userId))
    if (task === 'link_user') return reply(200, await linkUser(db, g, organizationId, userId, body))
    throw new UserError('Unknown task.')
  } catch (e) {
    return reply(e instanceof UserError ? 400 : 500, { error: (e as Error).message })
  }
})
