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
// - "send" (Phase 3): sends one text or email that a person approved. Rule #0
//   (Connor, 2026-11-03): this is the ONLY code that sends through GHL, and it
//   sends only what an approval record says (send_approvals, made by
//   approve_send(): the file's loan officer or an admin), used once by
//   claim_send_approval(), by the person who approved it. The server re-checks
//   every rule first (sendRules.ts: consent, opt-outs, sending hours, test mode, the
//   LO's confirmed number), re-checks GHL's Do Not Disturb live, and saves the
//   message with its idempotency key before calling GHL so it can't go twice.
//   It uses the person's GHL contact (found by phone or email), and creates
//   one, assigned to the file's loan officer, only when GHL has no one with
//   that phone or email (next build Session 2). It never adds tags (tags start
//   Connor's workflows).
//   An email can carry up to 3 saved PDFs from the file (estimates and
//   pre-approval letters): they're uploaded into the person's GHL conversation
//   and attached from there. Documents never go by text.
// - "pipelines" (owners and admins): GHL's pipelines and stages, for the
//   Settings picker, with "Closed" / "Recently Closed" suggested by name.
// - "opportunity" (Session 2, decisions 2–3 in docs/plans/next-build.md):
//   moves the borrower's ONE GHL opportunity to Closed / Recently Closed when
//   their loan closes (making it if they have none), or back to the active
//   pipeline when a closed client starts a new loan. Never a second one.
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
import { e164, hasTestName, planSend, textToHtml, type SendHoursValue } from './sendRules.ts'
import { chooseOpportunity, newContactBody, pickOpportunities, pickOpportunity, pickPipelines, planMove, suggestClosed, type OpportunityMove } from './opportunities.ts'
import { pickContact, secretMatches } from '../ghl-inbound/sync.ts'
import { pickGhlMatch, sharedDetails, splitName } from './link.ts'

const TIMEOUT_MS = 10_000
const UPLOAD_TIMEOUT_MS = 30_000
/** PDFs attached to one email, and their size, sent from LOSuite. */
const MAX_ATTACHMENTS = 3
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024

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
    // A file upload goes as multipart form data (fetch sets its own Content-Type).
    const isForm = body instanceof FormData
    try {
      const res = await fetch(`${GHL_BASE}${path}`, {
        method: p.method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Version: p.version,
          Accept: 'application/json',
          ...(body === undefined || isForm ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
        signal: AbortSignal.timeout(isForm ? UPLOAD_TIMEOUT_MS : TIMEOUT_MS),
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

  // GET /opportunities/pipelines (opportunities.readonly): pipeline and stage names only.
  record('opportunities_read', await g.call(plan('opportunities_read'), `/opportunities/pipelines?locationId=${loc}`))

  // PUT /opportunities/{id} (opportunities.write): a blank update to an opportunity that doesn't exist.
  record('opportunities_write', await g.call(plan('opportunities_write'), `/opportunities/${NO_SUCH_ID}`, {}))
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
  approvalId: string
  /** A borrower on the file, or (partnerId) a partner on the file's team. */
  contactId: string | null
  partnerId: string | null
  loanId: string
  channel: 'text' | 'email'
  body: string
  subject: string | null
  idempotencyKey: string
  /** Saved documents on this file to attach (email only): estimates and pre-approval letters. */
  documentIds: string[]
}

interface ApprovalRow {
  id: string
  contact_id: string | null
  partner_id: string | null
  loan_id: string
  channel: 'text' | 'email'
  subject: string | null
  body: string
  document_ids: string[] | null
  approved_by: string
  used_at: string | null
  voided_at: string | null
}

/**
 * Rule #0 (Connor, 2026-11-03): the request names an approval and nothing
 * else. What goes out is exactly what the approval says: who to, which file,
 * text or email, subject, words and attachments. Whatever else the request
 * carries is ignored.
 */
async function loadApproval(admin: SupabaseClient, organizationId: string, userId: string, body: Record<string, unknown>): Promise<SendRequest> {
  const approvalId = typeof body.approvalId === 'string' ? body.approvalId.trim() : ''
  if (!/^[0-9a-f-]{36}$/i.test(approvalId)) throw new UserError('Nothing was sent: this message has no approval. Approve it in MPS HQ first.')
  const found = await admin
    .from('send_approvals')
    .select('id, contact_id, partner_id, loan_id, channel, subject, body, document_ids, approved_by, used_at, voided_at')
    .eq('id', approvalId)
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (found.error) throw new Error(found.error.message)
  const a = found.data as ApprovalRow | null
  if (!a) throw new UserError('Nothing was sent: that approval was not found.')
  if (a.approved_by !== userId) throw new UserError('Nothing was sent: only the person who approved a message can send it.')
  if (a.voided_at) throw new UserError('Nothing was sent: that approval was cancelled.')
  const documentIds = a.document_ids ?? []
  if (documentIds.length > MAX_ATTACHMENTS) throw new UserError(`Attach at most ${MAX_ATTACHMENTS} documents to one email.`)
  return { approvalId: a.id, contactId: a.contact_id, partnerId: a.partner_id, loanId: a.loan_id, channel: a.channel, body: a.body, subject: a.subject, idempotencyKey: `approval:${a.id}`, documentIds }
}

/** Uses the approval exactly once (the database re-checks who may approve). False = it was already used. */
async function claimApproval(admin: SupabaseClient, organizationId: string, userId: string, approvalId: string): Promise<boolean> {
  const claimed = await admin.rpc('claim_send_approval', { p_approval_id: approvalId, p_organization_id: organizationId, p_user: userId })
  if (claimed.error) {
    if (claimed.error.message.includes('already_used')) return false
    throw new UserError(`Nothing was sent: ${claimed.error.message}`)
  }
  if (!((claimed.data as unknown[] | null) ?? []).length) throw new UserError('Nothing was sent: the approval could not be used.')
  return true
}

/** GHL's match for a phone, then an email (not LOSuite's own match; see ensureGhlContact). */
async function findGhlContact(g: Ghl, phone: string | null, email: string | null): Promise<string | null> {
  const m = await findGhlMatches(g, phone, email, true)
  return m.byPhone ?? m.byEmail
}

/** GHL's duplicate search by phone and by email, each on its own (firstOnly stops at the first hit). */
async function findGhlMatches(g: Ghl, phone: string | null, email: string | null, firstOnly = false): Promise<{ byPhone: string | null; byEmail: string | null }> {
  const loc = encodeURIComponent(g.locationId)
  const one = async (q: string) => {
    // GET /contacts/search/duplicate (contacts.readonly, Version 2021-07-28).
    const a = await g.call(plan('contacts_read'), `/contacts/search/duplicate?locationId=${loc}&${q}`)
    const id = (a.body as { contact?: { id?: unknown } | null } | null)?.contact?.id
    return a.outcome.result === 'works' && typeof id === 'string' && id ? id : null
  }
  const number = e164(phone)
  const byPhone = number ? await one(`number=${encodeURIComponent(number)}`) : null
  if (byPhone && firstOnly) return { byPhone, byEmail: null }
  const byEmail = email?.trim() ? await one(`email=${encodeURIComponent(email.trim().toLowerCase())}`) : null
  return { byPhone, byEmail }
}

interface GhlPerson {
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  ghl_contact_id: string | null
}

/**
 * The person's GHL contact, linked to them the first time: the stored link,
 * else GHL's match for their phone or email, else a new GHL contact assigned
 * to the loan officer's GHL user (POST /contacts/, contacts.write, Version
 * 2021-07-28; no tags). A found contact nobody is assigned to gets the loan
 * officer; one assigned to someone else keeps them. A GHL contact already
 * linked to another LOSuite person stops here for an admin to check.
 */
async function ensureGhlContact(admin: SupabaseClient, g: Ghl, organizationId: string, contactId: string, p: GhlPerson, assignTo: string | null, found?: { id: string | null }): Promise<{ id: string; created: boolean }> {
  if (p.ghl_contact_id) return { id: p.ghl_contact_id, created: false }
  const first = p.first_name || 'This person'
  if (!p.email?.trim() && !e164(p.phone)) throw new UserError(`${first} needs an email or a 10-digit phone before LOSuite can add them to GHL.`)

  // found: GHL's match, already looked up and checked by the caller (Add to GoHighLevel).
  let id = found ? found.id : await findGhlContact(g, p.phone, p.email)
  let created = false
  if (id) {
    const taken = await admin.from('contacts').select('id').eq('organization_id', organizationId).eq('ghl_contact_id', id).neq('id', contactId).maybeSingle()
    if (taken.error) throw new Error(taken.error.message)
    if (taken.data) throw new UserError('That phone or email belongs to a GHL contact already linked to someone else in LOSuite. An admin should check who is who first.')
    if (assignTo) {
      // GET /contacts/{id} (contacts.readonly), then PUT (contacts.write) only when nobody is assigned.
      const live = await g.call(plan('contacts_read'), `/contacts/${encodeURIComponent(id)}`)
      const assigned = (live.body as { contact?: { assignedTo?: unknown } } | null)?.contact?.assignedTo
      if (live.outcome.result === 'works' && !(typeof assigned === 'string' && assigned)) {
        await g.call({ ...plan('contacts_write'), dryRun: false }, `/contacts/${encodeURIComponent(id)}`, { assignedTo: assignTo })
      }
    }
  } else {
    const made = await g.call(
      { ...plan('contacts_write'), method: 'POST', dryRun: false },
      '/contacts/',
      newContactBody({ locationId: g.locationId, firstName: p.first_name, lastName: p.last_name, email: p.email, phoneE164: e164(p.phone), assignedTo: assignTo }),
    )
    const newId = (made.body as { contact?: { id?: unknown } } | null)?.contact?.id
    if (made.outcome.result !== 'works' || typeof newId !== 'string' || !newId) throw new UserError(`GHL didn't add ${first} as a contact: ${made.outcome.detail}`)
    id = newId
    created = true
  }
  const linked = await admin.from('contacts').update({ ghl_contact_id: id }).eq('id', contactId).eq('organization_id', organizationId).is('ghl_contact_id', null)
  if (linked.error) throw new Error(linked.error.message)
  return { id, created }
}

/**
 * Puts the PDFs into the person's GHL conversation and returns GHL's links to
 * them, so the email carries files GHL hosts (no expiring LOSuite links).
 * Finds the conversation, or starts one (POST /conversations/, conversations.write),
 * then POST /conversations/messages/upload (conversations/message.write,
 * Version 2021-04-15; multipart, the file under "fileAttachment"; PDFs allowed).
 */
async function uploadDocuments(admin: SupabaseClient, g: Ghl, ghlContactId: string, docs: { file_name: string; storage_path: string }[]): Promise<string[]> {
  const loc = encodeURIComponent(g.locationId)
  const search = await g.call(plan('conversations_read'), `/conversations/search?locationId=${loc}&contactId=${encodeURIComponent(ghlContactId)}`)
  let conversationId = ((search.body as { conversations?: { id?: unknown }[] } | null)?.conversations ?? [])[0]?.id
  if (typeof conversationId !== 'string') {
    const made = await g.call({ ...plan('conversations_read'), method: 'POST', scope: 'conversations.write' }, '/conversations/', { locationId: g.locationId, contactId: ghlContactId })
    conversationId = (made.body as { conversation?: { id?: unknown }; id?: unknown } | null)?.conversation?.id ?? (made.body as { id?: unknown } | null)?.id
    if (made.outcome.result !== 'works' || typeof conversationId !== 'string') throw new Error(`GHL couldn't start a conversation for the attachment (${made.outcome.detail})`)
  }

  const urls: string[] = []
  for (const d of docs) {
    const file = await admin.storage.from('loan-files').download(d.storage_path)
    if (file.error || !file.data) throw new Error(`${d.file_name} could not be read from LOSuite.`)
    const form = new FormData()
    form.append('fileAttachment', new File([file.data], d.file_name, { type: 'application/pdf' }))
    form.append('conversationId', conversationId)
    form.append('contactId', ghlContactId)
    form.append('locationId', g.locationId)
    const up = await g.call({ ...plan('messages_write'), dryRun: false }, '/conversations/messages/upload', form)
    const uploaded = (up.body as { uploadedFiles?: Record<string, unknown> } | null)?.uploadedFiles ?? {}
    const links = Object.values(uploaded).filter((u): u is string => typeof u === 'string' && /^https:\/\//.test(u))
    if (up.outcome.result !== 'works' || !links.length) throw new Error(`GHL didn't take ${d.file_name} (${up.outcome.detail})`)
    urls.push(...links)
  }
  return urls
}

const DEFAULT_HOURS: SendHoursValue = { mon: ['09:00', '21:00'], tue: ['09:00', '21:00'], wed: ['09:00', '21:00'], thu: ['09:00', '21:00'], fri: ['09:00', '21:00'], sat: ['09:00', '21:00'], sun: ['12:00', '21:00'] }

async function sendMessage(db: SupabaseClient, admin: SupabaseClient, g: Ghl, organizationId: string, userId: string, body: Record<string, unknown>) {
  const req = await loadApproval(admin, organizationId, userId, body)

  type Recipient = {
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
  let p: Recipient
  let loId: string | null
  if (req.partnerId) {
    // A partner (realtor, title…) on this file's team, as the sender sees them (Row Level Security).
    const partner = await db
      .from('partners')
      .select('*')
      .eq('id', req.partnerId)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (partner.error) throw new Error(partner.error.message)
    if (!partner.data) throw new UserError('That partner was not found.')
    if ((partner.data as { email_via_gmail?: boolean }).email_via_gmail) throw new UserError(`${(partner.data as { name: string }).name} emails through Gmail: send from Messages, not GoHighLevel.`)
    const pt = partner.data as Omit<Recipient, 'first_name' | 'last_name'> & { name: string }
    const name = splitName(pt.name)
    p = { ...pt, first_name: name.first, last_name: name.last }
    const team = await db.from('loan_team_members').select('loan:loans ( assigned_lo_id )').eq('loan_id', req.loanId).eq('partner_id', req.partnerId).limit(1)
    if (team.error) throw new Error(team.error.message)
    if (!team.data?.length) throw new UserError(`${pt.name} is not on this file's team.`)
    loId = (team.data[0] as unknown as { loan: { assigned_lo_id: string | null } | null }).loan?.assigned_lo_id ?? null
  } else {
    // What the sender can see (Row Level Security): the person, and that they're on this file.
    const person = await db
      .from('contacts')
      .select('id, first_name, last_name, email, phone, sms_consent, email_consent, sms_opted_out_at, email_opted_out_at, ghl_contact_id')
      .eq('id', req.contactId!)
      .eq('organization_id', organizationId)
      .maybeSingle()
    if (person.error) throw new Error(person.error.message)
    if (!person.data) throw new UserError('That person was not found, or their file is not yours.')
    p = person.data as Recipient
    const onFile = await db.from('loan_borrowers').select('loan_id, loan:loans ( assigned_lo_id )').eq('loan_id', req.loanId).eq('contact_id', req.contactId!).maybeSingle()
    if (onFile.error) throw new Error(onFile.error.message)
    if (!onFile.data) throw new UserError('That person is not on this file.')
    loId = (onFile.data as unknown as { loan: { assigned_lo_id: string | null } | null }).loan?.assigned_lo_id ?? null
  }
  const first = p.first_name || 'This person'

  // A message already sent (or being sent) with this key: say so, never send again.
  const already = await admin.from('messages').select('id, status, send_error').eq('organization_id', organizationId).eq('idempotency_key', req.idempotencyKey).maybeSingle()
  if (already.error) throw new Error(already.error.message)
  if (already.data) return { alreadySent: true, status: already.data.status, error: already.data.send_error }

  const settings = await admin.from('messaging_settings').select('send_hours, inbound_mode, email_domain_verified').eq('organization_id', organizationId).maybeSingle()
  if (settings.error) throw new Error(settings.error.message)
  const s = settings.data as { send_hours: SendHoursValue; inbound_mode: string; email_domain_verified: boolean } | null
  let lo: { name: string; ghlNumber: string | null; numberConfirmed: boolean; ghlEmail: string | null } | null = null
  let loGhlUserId: string | null = null
  if (loId) {
    const prof = await db.from('profiles').select('full_name, email').eq('id', loId).maybeSingle()
    const link = await admin.from('ghl_user_links').select('ghl_user_id, ghl_number, ghl_email, number_confirmed_at').eq('organization_id', organizationId).eq('profile_id', loId).maybeSingle()
    if (prof.error || link.error) throw new Error((prof.error ?? link.error)!.message)
    const pr = prof.data as { full_name: string | null; email: string } | null
    const l = link.data as { ghl_user_id: string; ghl_number: string | null; ghl_email: string | null; number_confirmed_at: string | null } | null
    lo = { name: pr?.full_name || pr?.email || 'The loan officer', ghlNumber: l?.ghl_number ?? null, numberConfirmed: !!l?.number_confirmed_at, ghlEmail: l?.ghl_email ?? null }
    loGhlUserId = l?.ghl_user_id ?? null
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

  // Documents to attach: on this file, PDFs, a sensible size. Read as the sender (Row Level Security).
  let docs: { id: string; file_name: string; storage_path: string; content_type: string | null; size_bytes: number | null }[] = []
  if (req.documentIds.length) {
    const found = await db.from('loan_documents').select('id, file_name, storage_path, content_type, size_bytes').eq('loan_id', req.loanId).in('id', req.documentIds)
    if (found.error) throw new Error(found.error.message)
    docs = (found.data ?? []) as typeof docs
    if (docs.length !== req.documentIds.length) throw new UserError('A document to attach was not found on this file.')
    for (const d of docs) {
      if (d.content_type !== 'application/pdf' && !d.file_name.toLowerCase().endsWith('.pdf')) throw new UserError(`${d.file_name} isn't a PDF. Only PDFs are sent.`)
      if ((d.size_bytes ?? 0) > MAX_ATTACHMENT_BYTES) throw new UserError(`${d.file_name} is over 10 MB.`)
    }
  }

  // The person's GHL contact: found, or created and assigned to the loan officer; linked to them the first time.
  // A partner is linked through Add to GoHighLevel's own rules (a shared phone or two GHL people wait for an admin).
  let ghlContactId: string
  if (req.partnerId) {
    if (p.ghl_contact_id) ghlContactId = p.ghl_contact_id
    else {
      const linked = await linkPartner(db, admin, g, organizationId, userId, { partnerId: req.partnerId })
      if ('skipped' in linked) throw new UserError(`Nothing was sent: ${linked.skipped}`)
      const again = await admin.from('partners').select('ghl_contact_id').eq('id', req.partnerId).maybeSingle()
      if (!again.data?.ghl_contact_id) throw new UserError('Nothing was sent: the partner could not be linked to GoHighLevel.')
      ghlContactId = again.data.ghl_contact_id as string
    }
  } else ghlContactId = (await ensureGhlContact(admin, g, organizationId, req.contactId!, p, loGhlUserId)).id

  // GHL's Do Not Disturb, checked live: GET /contacts/{contactId} (contacts.readonly).
  const live = await g.call(plan('contacts_read'), `/contacts/${encodeURIComponent(ghlContactId)}`)
  const contact = live.outcome.result === 'works' ? pickContact(live.body) : null
  if (!contact) throw new UserError('GHL did not return this contact, so nothing was sent. Try again in a minute.')
  if (req.channel === 'text' ? contact.dndText : contact.dndEmail) {
    const field = req.channel === 'text' ? 'sms' : 'email'
    if (req.partnerId) {
      await admin.from('partners').update({ [`${field}_consent`]: false, [`${field}_opted_out_at`]: new Date().toISOString() }).eq('id', req.partnerId).is(`${field}_opted_out_at`, null)
    } else {
      await admin.from('contacts').update({ [`${field}_consent`]: false, [`${field}_opted_out_at`]: new Date().toISOString() }).eq('id', req.contactId!).is(`${field}_opted_out_at`, null)
      await admin.from('consent_events').insert({ organization_id: organizationId, contact_id: req.contactId, channel: req.channel, change: 'opted_out', source: 'ghl_dnd' })
    }
    throw new UserError(`${first} has Do Not Disturb on in GHL, so ${req.channel === 'text' ? 'texting' : 'email'} is now turned off for them. Nothing was sent.`)
  }

  // Every check passed: use the approval (once), then save the lock.
  if (!(await claimApproval(admin, organizationId, userId, req.approvalId))) return { alreadySent: true, status: 'sending', error: null }

  // The lock: saved with its key before GHL is called, so it can't go twice.
  const now = new Date().toISOString()
  const saved = await admin
    .from('messages')
    .insert({
      organization_id: organizationId,
      contact_id: req.contactId,
      partner_id: req.partnerId,
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
      approval_id: req.approvalId,
      sent_by: userId,
      attachments: docs.map((d) => ({ documentId: d.id, fileName: d.file_name })),
    })
    .select('id')
    .single()
  if (saved.error) {
    if (saved.error.code === '23505') return { alreadySent: true, status: 'sending', error: null }
    throw new Error(saved.error.message)
  }
  const rowId = (saved.data as { id: string }).id

  let attachmentUrls: string[] = []
  if (docs.length) {
    try {
      attachmentUrls = await uploadDocuments(admin, g, ghlContactId, docs)
    } catch (e) {
      const why = (e as Error).message
      await admin.from('messages').update({ status: 'failed', send_error: why }).eq('id', rowId)
      throw new UserError(`Nothing was sent: ${why}`)
    }
  }

  // POST /conversations/messages (conversations/message.write, Version 2021-04-15).
  const text = req.body.trim()
  const payload =
    req.channel === 'text'
      ? { type: 'SMS', contactId: ghlContactId, message: text, fromNumber: sendPlan.fromNumber, toNumber: sendPlan.to }
      : {
          type: 'Email',
          contactId: ghlContactId,
          subject: req.subject,
          html: textToHtml(text),
          message: text,
          emailFrom: sendPlan.fromEmail,
          emailTo: sendPlan.to,
          ...(attachmentUrls.length ? { attachments: attachmentUrls } : {}),
        }
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
    await admin.from('messages').update({ sent_by: userId, idempotency_key: req.idempotencyKey, approval_id: req.approvalId, read_at: now }).eq('organization_id', organizationId).eq('ghl_message_id', result.messageId)
  } else if (done.error) throw new Error(done.error.message)
  return { sent: true, status, from: sendPlan.fromNumber ?? sendPlan.fromEmail, to: sendPlan.to }
}

/** GHL's pipelines for the Settings picker: GET /opportunities/pipelines (opportunities.readonly, Version 2021-07-28). */
async function listPipelines(g: Ghl) {
  const a = await g.call(plan('opportunities_read'), `/opportunities/pipelines?locationId=${encodeURIComponent(g.locationId)}`)
  if (a.outcome.result !== 'works') throw new UserError(`GHL's pipelines couldn't be read: ${a.outcome.detail}`)
  const pipelines = pickPipelines(a.body)
  return { pipelines, suggestedClosed: suggestClosed(pipelines) }
}

/**
 * Puts the file's borrower's ONE GHL opportunity where it belongs (decision 3):
 * "closed" → the Closed pipeline's stage from Settings, made if they have none;
 * "comeback" → the active pipeline and stage from Settings, reopened. Anyone
 * who can see the file may run it. Test mode only touches people named TEST.
 * A step that can't run yet (nothing picked in Settings, test mode) comes back
 * as `skipped` with the reason, never as an error.
 */
async function moveOpportunity(db: SupabaseClient, admin: SupabaseClient, g: Ghl, organizationId: string, body: Record<string, unknown>) {
  const loanId = typeof body.loanId === 'string' ? body.loanId : null
  const move: OpportunityMove | null = body.move === 'closed' || body.move === 'comeback' ? body.move : null
  if (!loanId || !move) throw new UserError('Which file, and closed or coming back?')

  // What the user can see (Row Level Security): the file and its borrower.
  const loan = await db.from('loans').select('id, stage, loan_amount, purchase_price, assigned_lo_id').eq('id', loanId).eq('organization_id', organizationId).maybeSingle()
  if (loan.error) throw new Error(loan.error.message)
  if (!loan.data) throw new UserError('That file was not found, or it is not yours.')
  const l = loan.data as { stage: string; loan_amount: number | null; purchase_price: number | null; assigned_lo_id: string | null }
  if (move === 'closed' && l.stage !== 'closed') throw new UserError('This file is not Closed, so its GHL opportunity stays where it is.')
  const borrower = await db
    .from('loan_borrowers')
    .select('contact:contacts ( id, first_name, last_name, email, phone, ghl_contact_id, ghl_opportunity_id )')
    .eq('loan_id', loanId)
    .eq('role', 'primary')
    .maybeSingle()
  if (borrower.error) throw new Error(borrower.error.message)
  const person = (borrower.data as unknown as { contact: (GhlPerson & { id: string; ghl_opportunity_id: string | null }) | null } | null)?.contact
  if (!person) throw new UserError('This file has no borrower.')
  const name = [person.first_name, person.last_name].filter(Boolean).join(' ') || 'Borrower'

  const settings = await admin
    .from('messaging_settings')
    .select('inbound_mode, closed_pipeline_id, closed_stage_id, closed_label, comeback_pipeline_id, comeback_stage_id, comeback_label')
    .eq('organization_id', organizationId)
    .maybeSingle()
  if (settings.error) throw new Error(settings.error.message)
  const s = settings.data as Record<string, string | null> | null
  const target = move === 'closed'
    ? s?.closed_pipeline_id && s.closed_stage_id ? { pipelineId: s.closed_pipeline_id, stageId: s.closed_stage_id, label: s.closed_label } : null
    : s?.comeback_pipeline_id && s.comeback_stage_id ? { pipelineId: s.comeback_pipeline_id, stageId: s.comeback_stage_id, label: s.comeback_label } : null
  if (!target) return { skipped: `Pick the ${move === 'closed' ? 'Closed' : '"client came back"'} pipeline and stage in Settings → GoHighLevel first, so GHL wasn't changed.` }
  if ((s?.inbound_mode ?? 'test_only') === 'test_only' && !hasTestName(person.first_name, person.last_name)) {
    return { skipped: 'Test mode: LOSuite only changes GHL for people with TEST in their name, so GHL wasn\'t changed.' }
  }

  let assignTo: string | null = null
  if (l.assigned_lo_id) {
    const link = await admin.from('ghl_user_links').select('ghl_user_id').eq('organization_id', organizationId).eq('profile_id', l.assigned_lo_id).maybeSingle()
    if (link.error) throw new Error(link.error.message)
    assignTo = (link.data as { ghl_user_id: string } | null)?.ghl_user_id ?? null
  }
  const contact = await ensureGhlContact(admin, g, organizationId, person.id, person, assignTo)

  // Their opportunities: GET /opportunities/search?location_id&contact_id (opportunities.readonly).
  const search = await g.call(
    plan('opportunities_read'),
    `/opportunities/search?location_id=${encodeURIComponent(g.locationId)}&contact_id=${encodeURIComponent(contact.id)}&status=all&limit=20`,
  )
  if (search.outcome.result !== 'works') throw new UserError(`GHL's opportunities couldn't be read: ${search.outcome.detail}`)
  const chosen = chooseOpportunity(pickOpportunities(search.body), person.ghl_opportunity_id)

  const step = planMove({
    move,
    existing: chosen?.opportunity ?? null,
    target,
    locationId: g.locationId,
    ghlContactId: contact.id,
    personName: name,
    amount: l.loan_amount ?? l.purchase_price,
    assignedTo: assignTo,
  })
  const done = await g.call({ ...plan('opportunities_write'), method: step.method, dryRun: false }, step.path, step.body)
  const opportunity = pickOpportunity((done.body as { opportunity?: Record<string, unknown> } | null)?.opportunity)
  const opportunityId = opportunity?.id ?? chosen?.opportunity.id
  if (done.outcome.result !== 'works' || !opportunityId) throw new UserError(`GHL didn't ${chosen ? 'move' : 'add'} the opportunity: ${done.outcome.detail}`)

  if (person.ghl_opportunity_id !== opportunityId) {
    const saved = await admin.from('contacts').update({ ghl_opportunity_id: opportunityId }).eq('id', person.id).eq('organization_id', organizationId)
    if (saved.error) {
      if (saved.error.code === '23505') throw new UserError(`GHL moved it, but that opportunity is already linked to someone else in LOSuite. An admin should check who is who.`)
      throw new Error(saved.error.message)
    }
  }
  return {
    moved: true,
    created: !chosen,
    contactCreated: contact.created,
    to: target.label,
    // More than one opportunity in GHL for this person: the newest was used; the rest are for someone to tidy in GHL.
    otherOpportunities: chosen?.others ?? 0,
  }
}

/**
 * Matches or creates a borrower's GHL contact before something is drafted
 * for them (prequal results, decision 7), assigned to the file's loan
 * officer's GHL user. Test mode only touches GHL for people named TEST;
 * otherwise it comes back as `skipped` with the reason, never as an error.
 */
async function linkContact(db: SupabaseClient, admin: SupabaseClient, g: Ghl, organizationId: string, body: Record<string, unknown>) {
  const loanId = typeof body.loanId === 'string' ? body.loanId : null
  const contactId = typeof body.contactId === 'string' ? body.contactId : null
  if (!loanId || !contactId) throw new UserError('Which file, and which borrower?')

  // What the user can see (Row Level Security): the borrower on this file.
  const onFile = await db
    .from('loan_borrowers')
    .select('loan:loans ( assigned_lo_id ), contact:contacts ( id, first_name, last_name, email, phone, ghl_contact_id )')
    .eq('loan_id', loanId)
    .eq('contact_id', contactId)
    .maybeSingle()
  if (onFile.error) throw new Error(onFile.error.message)
  const row = onFile.data as unknown as { loan: { assigned_lo_id: string | null } | null; contact: (GhlPerson & { id: string }) | null } | null
  if (!row?.contact) throw new UserError('That person is not on this file, or the file is not yours.')
  const person = row.contact
  if (person.ghl_contact_id) return { linked: true, created: false }

  const settings = await admin.from('messaging_settings').select('inbound_mode').eq('organization_id', organizationId).maybeSingle()
  if (settings.error) throw new Error(settings.error.message)
  if (((settings.data as { inbound_mode: string } | null)?.inbound_mode ?? 'test_only') === 'test_only' && !hasTestName(person.first_name, person.last_name)) {
    return { skipped: 'Test mode: LOSuite only adds people with TEST in their name to GHL, so GHL wasn\'t changed.' }
  }

  let assignTo: string | null = null
  if (row.loan?.assigned_lo_id) {
    const link = await admin.from('ghl_user_links').select('ghl_user_id').eq('organization_id', organizationId).eq('profile_id', row.loan.assigned_lo_id).maybeSingle()
    if (link.error) throw new Error(link.error.message)
    assignTo = (link.data as { ghl_user_id: string } | null)?.ghl_user_id ?? null
  }
  if (!person.email?.trim() && !e164(person.phone)) throw new UserError(`${person.first_name || 'This person'} needs an email or a 10-digit phone before LOSuite can add them to GHL.`)

  // A shared email or phone, or a phone and email that GHL knows as two people, waits for an admin.
  const shared = sharedDetails(person, await samePeople(admin, organizationId, 'contacts', person.id, person.email, person.phone))
  if (shared) return { skipped: shared }
  const match = await findGhlMatches(g, person.phone, person.email)
  const picked = pickGhlMatch(match.byPhone, match.byEmail)
  if ('problem' in picked) return { skipped: picked.problem }
  const contact = await ensureGhlContact(admin, g, organizationId, person.id, person, assignTo, picked)
  return { linked: true, created: contact.created }
}

/** Others in the company (people, or partners) with the same email or 10-digit phone. */
async function samePeople(admin: SupabaseClient, organizationId: string, table: 'contacts' | 'partners', selfId: string, email: string | null, phone: string | null): Promise<{ email: string | null; phone: string | null }[]> {
  const out: { email: string | null; phone: string | null }[] = []
  const e = email?.trim().toLowerCase()
  if (e) {
    // ilike with % and _ escaped is a case-insensitive exact match.
    const r = await admin.from(table).select('email, phone').eq('organization_id', organizationId).neq('id', selfId).ilike('email', e.replace(/[\\%_]/g, (c) => `\\${c}`)).limit(5)
    if (r.error) throw new Error(r.error.message)
    out.push(...((r.data ?? []) as { email: string | null; phone: string | null }[]))
  }
  const ten = e164(phone)?.slice(2)
  if (ten) {
    const r = await admin.from(table).select('email, phone').eq('organization_id', organizationId).neq('id', selfId).in('phone_digits', [ten, `1${ten}`]).limit(5)
    if (r.error) throw new Error(r.error.message)
    out.push(...((r.data ?? []) as { email: string | null; phone: string | null }[]))
  }
  return out
}

/**
 * Add to GoHighLevel for a partner (build plan Phase 3): the stored link, else
 * GHL's duplicate search by email and phone (never by name), else a new GHL
 * contact assigned to the partner's loan officer (Phase 4), else the person
 * clicking. Only this sets partners.ghl_contact_id. Same rules as
 * borrowers: test mode only touches TEST names, no tags, no workflows, and a
 * shared email or phone, two GHL people, or a GHL contact already linked to
 * someone else waits for an admin.
 */
async function linkPartner(db: SupabaseClient, admin: SupabaseClient, g: Ghl, organizationId: string, userId: string, body: Record<string, unknown>) {
  const partnerId = typeof body.partnerId === 'string' ? body.partnerId : null
  if (!partnerId) throw new UserError('Which partner?')
  // What the user can see (Row Level Security): everyone in the company sees partners.
  // * so this works before and after the partner stages script (assigned_lo_id).
  const found = await db.from('partners').select('*').eq('id', partnerId).eq('organization_id', organizationId).maybeSingle()
  if (found.error) throw new Error(found.error.message)
  const partner = found.data as { id: string; name: string; kind: string; email: string | null; phone: string | null; ghl_contact_id: string | null; assigned_lo_id?: string | null; ghl_opportunity_id?: string | null } | null
  if (!partner) throw new UserError('That partner was not found.')
  // Title and insurance partners who email through Gmail live only in MPS HQ.
  if ((partner as { email_via_gmail?: boolean }).email_via_gmail) return { skipped: `${partner.name} emails through Gmail, so MPS HQ keeps them out of GoHighLevel.` }

  // * so this works before the realtor pipeline script too.
  const settings = await admin.from('messaging_settings').select('*').eq('organization_id', organizationId).maybeSingle()
  if (settings.error) throw new Error(settings.error.message)
  const s = settings.data as { inbound_mode?: string; realtor_pipeline_id?: string | null; realtor_stage_id?: string | null; realtor_label?: string | null } | null
  if ((s?.inbound_mode ?? 'test_only') === 'test_only' && !hasTestName(partner.name, null)) {
    return partner.ghl_contact_id ? { linked: true, created: false } : { skipped: 'Test mode: LOSuite only adds people with TEST in their name to GHL, so GHL wasn\'t changed.' }
  }

  const link = await admin.from('ghl_user_links').select('ghl_user_id').eq('organization_id', organizationId).eq('profile_id', partner.assigned_lo_id ?? userId).maybeSingle()
  if (link.error) throw new Error(link.error.message)
  const assignTo = (link.data as { ghl_user_id: string } | null)?.ghl_user_id ?? null

  // Already linked: just make sure a realtor is in the realtor pipeline.
  if (partner.ghl_contact_id) return { linked: true, created: false, pipeline: await ensureRealtorOpportunity(admin, g, organizationId, partner, partner.ghl_contact_id, assignTo, s) }

  if (!partner.email?.trim() && !e164(partner.phone)) throw new UserError(`${partner.name} needs an email or a 10-digit phone before LOSuite can add them to GHL.`)

  const shared = sharedDetails(partner, await samePeople(admin, organizationId, 'partners', partner.id, partner.email, partner.phone))
  if (shared) return { skipped: shared }
  const match = await findGhlMatches(g, partner.phone, partner.email)
  const picked = pickGhlMatch(match.byPhone, match.byEmail)
  if ('problem' in picked) return { skipped: picked.problem }

  let id = picked.id
  let created = false
  if (id) {
    // A GHL contact already linked to a borrower or another partner waits for an admin.
    const [asPerson, asPartner] = await Promise.all([
      admin.from('contacts').select('id').eq('organization_id', organizationId).eq('ghl_contact_id', id).limit(1),
      admin.from('partners').select('id').eq('organization_id', organizationId).eq('ghl_contact_id', id).neq('id', partner.id).limit(1),
    ])
    if (asPerson.error || asPartner.error) throw new Error((asPerson.error ?? asPartner.error)!.message)
    if (asPerson.data?.length || asPartner.data?.length) return { skipped: 'Needs matching by an admin: that GHL contact is already linked to someone else in LOSuite.' }
    if (assignTo) {
      const live = await g.call(plan('contacts_read'), `/contacts/${encodeURIComponent(id)}`)
      const assigned = (live.body as { contact?: { assignedTo?: unknown } } | null)?.contact?.assignedTo
      if (live.outcome.result === 'works' && !(typeof assigned === 'string' && assigned)) {
        await g.call({ ...plan('contacts_write'), dryRun: false }, `/contacts/${encodeURIComponent(id)}`, { assignedTo: assignTo })
      }
    }
  } else {
    const name = splitName(partner.name)
    const made = await g.call(
      { ...plan('contacts_write'), method: 'POST', dryRun: false },
      '/contacts/',
      newContactBody({ locationId: g.locationId, firstName: name.first, lastName: name.last, email: partner.email, phoneE164: e164(partner.phone), assignedTo: assignTo }),
    )
    const newId = (made.body as { contact?: { id?: unknown } } | null)?.contact?.id
    if (made.outcome.result !== 'works' || typeof newId !== 'string' || !newId) throw new UserError(`GHL didn't add ${partner.name} as a contact: ${made.outcome.detail}`)
    id = newId
    created = true
  }
  const saved = await admin.from('partners').update({ ghl_contact_id: id }).eq('id', partner.id).eq('organization_id', organizationId).is('ghl_contact_id', null)
  if (saved.error) throw new Error(saved.error.message)
  return { linked: true, created, pipeline: await ensureRealtorOpportunity(admin, g, organizationId, partner, id!, assignTo, s) }
}

/**
 * A realtor's opportunity in the realtor pipeline picked in Settings → GHL
 * pipelines: the one saved, else one they already have in that pipeline,
 * else a new one in the picked stage (named after them, assigned to their
 * loan officer). Never a second one. Other partners (title, builders…) are
 * left alone. Says what happened, or why not, in words.
 */
async function ensureRealtorOpportunity(
  admin: SupabaseClient,
  g: Ghl,
  organizationId: string,
  partner: { id: string; name: string; kind: string; ghl_opportunity_id?: string | null },
  ghlContactId: string,
  assignTo: string | null,
  s: { realtor_pipeline_id?: string | null; realtor_stage_id?: string | null; realtor_label?: string | null } | null,
): Promise<string | null> {
  if (partner.kind !== 'realtor') return null
  if (partner.ghl_opportunity_id) return 'Already in the realtor pipeline.'
  if (!s?.realtor_pipeline_id || !s.realtor_stage_id) return 'Pick the realtor pipeline in Settings → GHL pipelines to add them to it.'
  // Their opportunities: GET /opportunities/search (opportunities.readonly).
  const search = await g.call(plan('opportunities_read'), `/opportunities/search?location_id=${encodeURIComponent(g.locationId)}&contact_id=${encodeURIComponent(ghlContactId)}&status=all&limit=20`)
  if (search.outcome.result !== 'works') return `GHL's opportunities couldn't be read: ${search.outcome.detail}`
  let opportunityId = pickOpportunities(search.body).find((o) => o.pipelineId === s.realtor_pipeline_id)?.id ?? null
  let added = false
  if (!opportunityId) {
    // POST /opportunities/ (opportunities.write).
    const made = await g.call({ ...plan('opportunities_write'), method: 'POST', dryRun: false }, '/opportunities/', {
      locationId: g.locationId,
      contactId: ghlContactId,
      pipelineId: s.realtor_pipeline_id,
      pipelineStageId: s.realtor_stage_id,
      name: partner.name,
      status: 'open',
      ...(assignTo ? { assignedTo: assignTo } : {}),
    })
    opportunityId = pickOpportunity((made.body as { opportunity?: Record<string, unknown> } | null)?.opportunity)?.id ?? null
    if (made.outcome.result !== 'works' || !opportunityId) return `GHL didn't add them to the realtor pipeline: ${made.outcome.detail}`
    added = true
  }
  const saved = await admin.from('partners').update({ ghl_opportunity_id: opportunityId }).eq('id', partner.id).eq('organization_id', organizationId)
  if (saved.error) return saved.error.code === '23505' ? 'That GHL opportunity is already linked to another partner. An admin should check.' : saved.error.message
  return added ? `Added to ${s.realtor_label ?? 'the realtor pipeline'}.` : 'Linked to their opportunity in the realtor pipeline.'
}

/**
 * Sends every scheduled message that's due, each as the person who approved
 * it, through the same sendMessage (every check again). One that can't go
 * (consent, sending hours, Do Not Disturb, the approver lost the file…) is
 * cancelled with the reason, so it shows as "Didn't send" in Scheduled and is
 * never tried again; one GHL refuses is a failed send, like any other.
 */
async function sendDue(token: string, locationId: string) {
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const due = await admin
    .from('send_approvals')
    .select('id, organization_id, approved_by')
    .not('send_at', 'is', null)
    .lte('send_at', new Date(Date.now() + 30_000).toISOString())
    .is('used_at', null)
    .is('voided_at', null)
    .order('send_at')
    .limit(20)
  if (due.error) return { error: due.error.message }
  let sent = 0
  let stopped = 0
  for (const a of (due.data ?? []) as { id: string; organization_id: string; approved_by: string }[]) {
    const g = new Ghl(token, locationId)
    try {
      const r = await sendMessage(admin, admin, g, a.organization_id, a.approved_by, { approvalId: a.id })
      if ((r as { sent?: boolean }).sent) sent++
    } catch (e) {
      const why = (e as Error).message.replace(/^Nothing was sent: /, '')
      // A few seconds early: the next minute sends it.
      if (why.includes('not_due')) continue
      stopped++
      // Not used yet (a check failed before sending): cancel it with the reason. A used one already has its failed message.
      await admin.from('send_approvals').update({ voided_at: new Date().toISOString(), void_reason: why.slice(0, 500) }).eq('id', a.id).is('used_at', null).is('voided_at', null)
    } finally {
      if (g.calls.length) await admin.from('ghl_calls').insert(g.calls.map((c) => ({ organization_id: a.organization_id, called_by: a.approved_by, task: 'scheduled_send', ...c })))
    }
  }
  return { due: due.data?.length ?? 0, sent, stopped }
}

/**
 * Pages (2026-11-06): someone filled out a page, so match or add them in GHL,
 * assigned to the file's loan officer, exactly like "contact" (test mode only
 * touches TEST people; no tags). Called by the page-submit function with the
 * timer key, so it runs with the service role.
 */
async function pageContact(token: string, locationId: string, body: Record<string, unknown>) {
  const organizationId = typeof body.organizationId === 'string' ? body.organizationId : null
  if (!organizationId) return reply(400, { error: 'Which company?' })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const g = new Ghl(token, locationId)
  try {
    return reply(200, await linkContact(admin, admin, g, organizationId, body))
  } catch (e) {
    return reply(e instanceof UserError ? 400 : 500, { error: (e as Error).message })
  } finally {
    if (g.calls.length) await admin.from('ghl_calls').insert(g.calls.map((c) => ({ organization_id: organizationId, called_by: null, task: 'page_contact', ...c })))
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' })

  // The every-minute timer (scheduled_ghl_send in the database) sends approved, scheduled messages that are due.
  const timerKey = new URL(request.url).searchParams.get('key')
  if (timerKey !== null) {
    if (!secretMatches(timerKey, Deno.env.get('GHL_WEBHOOK_SECRET'))) return reply(401, { error: 'Wrong or missing key.' })
    const timerBody = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
    if (timerBody.task !== 'send_due' && timerBody.task !== 'page_contact') return reply(400, { error: 'Unknown task.' })
    const timerToken = Deno.env.get('GHL_PRIVATE_TOKEN')
    const timerLocation = Deno.env.get('GHL_LOCATION_ID')
    if (!timerToken || !timerLocation) return reply(500, { error: 'GHL is not set up yet.' })
    if (timerBody.task === 'page_contact') return await pageContact(timerToken, timerLocation, timerBody)
    return reply(200, await sendDue(timerToken, timerLocation))
  }

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
      // Only with an approval from the person calling; the send itself re-checks everything.
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
      try {
        return reply(200, await sendMessage(db, admin, g, organizationId, userId, body))
      } finally {
        if (g.calls.length) await admin.from('ghl_calls').insert(g.calls.map((c) => ({ organization_id: organizationId, called_by: userId, task: 'send', ...c })))
      }
    }
    if (task === 'opportunity') {
      // Anyone who can see the file.
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
      try {
        return reply(200, await moveOpportunity(db, admin, g, organizationId, body))
      } finally {
        if (g.calls.length) await admin.from('ghl_calls').insert(g.calls.map((c) => ({ organization_id: organizationId, called_by: userId, task: 'opportunity', ...c })))
      }
    }
    if (task === 'contact') {
      // Anyone who can see the file.
      const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
      try {
        // A partner (Partners → Add to GoHighLevel), or a borrower on a file.
        return reply(200, body.partnerId ? await linkPartner(db, admin, g, organizationId, userId, body) : await linkContact(db, admin, g, organizationId, body))
      } finally {
        if (g.calls.length) await admin.from('ghl_calls').insert(g.calls.map((c) => ({ organization_id: organizationId, called_by: userId, task: 'contact', ...c })))
      }
    }
    if (!['owner', 'admin'].includes((role.data as { role: string }).role)) return reply(403, { error: 'Only an owner or admin can manage the GHL connection.' })
    if (task === 'pipelines') {
      const result = await listPipelines(g)
      const logError = await saveLog(db, organizationId, userId, 'pipelines', g)
      return reply(200, { ...result, logError })
    }
    if (task === 'token_check') return reply(200, await tokenCheck(db, g, organizationId, userId))
    if (task === 'link_user') return reply(200, await linkUser(db, g, organizationId, userId, body))
    throw new UserError('Unknown task.')
  } catch (e) {
    return reply(e instanceof UserError ? 400 : 500, { error: (e as Error).message })
  }
})
