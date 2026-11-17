// LOSuite ← GoHighLevel: a Supabase Edge Function (Deno) that copies texts and
// emails from the MPS Mortgage sub-account into LOSuite (Phase 2a, Connor
// 2026-10-29; plan in docs/plans/ghl-messaging.md). Verify JWT is OFF, like
// lead-intake: GHL can't sign in. Two ways in:
// - GHL's workflow "Customer Replied" → plain Webhook action, to this URL with
//   ?key=<GHL_WEBHOOK_SECRET>. The webhook is only a notice: nothing in it is
//   saved. It names a GHL contact, and this function reads that contact's
//   conversations from the GHL API itself.
// - "catch_up": everything GHL changed since the last check. Run by the
//   scheduled check (with the key) or by an owner or admin from the app (with
//   their sign-in).
//
// Each GHL contact is matched to a LOSuite person (supabase/functions/ghl/
// match.ts: stored GHL id, email, phone; never by name). Unclear cases wait in
// "Needs matching" for an admin. A STOP reply or GHL's Do Not Disturb turns
// that channel's consent off. In test mode (the default) only GHL contacts
// named TEST, or already linked to a LOSuite person named TEST, are saved, so
// real clients stay out of the dev database.
//
// Writes use the service role (no signed-in user), so Row Level Security is
// bypassed here on purpose; every write is scoped to the company that owns
// the GHL sub-account. Every GHL call is logged in ghl_calls. Nothing is sent, and no reply is drafted:
// the loan officer asks for a suggestion in the Messages tab (Connor, 2026-11-16).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import { CHECKS, GHL_BASE, classify, logEndpoint, type CheckKey, type CheckResult } from '../ghl/checks.ts'
import { matchContact, phone10, type Candidate, type MatchResult } from '../ghl/match.ts'
import { partnerFileFor, type PartnerFile } from './partnerFile.ts'
import {
  isEmailUnsubscribe,
  isStopReply,
  isTestContact,
  keepInTestMode,
  pickContact,
  pickConversations,
  pickEmail,
  pickMessages,
  secretMatches,
  webhookContactId,
  type ConversationRef,
  type GhlContact,
  type GhlMessage,
} from './sync.ts'

const TIMEOUT_MS = 10_000
/** The first catch-up looks back this far; later ones start a few minutes before the last one. */
const FIRST_LOOKBACK_MS = 24 * 60 * 60 * 1000
const OVERLAP_MS = 5 * 60 * 1000
const MAX_CONVERSATIONS = 100
const MESSAGES_PER_CONVERSATION = 50

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const plan = (key: CheckKey) => CHECKS.find((c) => c.key === key)!

interface LoggedCall {
  method: string
  endpoint: string
  http_status: number | null
  result: CheckResult
  detail: string
}

/** Calls GHL with the token and remembers each call for the log. */
class Ghl {
  calls: LoggedCall[] = []
  constructor(private token: string, readonly locationId: string) {}

  async get(key: CheckKey, path: string): Promise<{ ok: boolean; body: unknown }> {
    const p = plan(key)
    let status: number | null = null
    let body: unknown = null
    try {
      const res = await fetch(`${GHL_BASE}${path}`, {
        headers: { Authorization: `Bearer ${this.token}`, Version: p.version, Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      status = res.status
      const text = await res.text()
      try {
        body = JSON.parse(text)
      } catch {
        body = text
      }
    } catch (e) {
      body = (e as Error).name === 'TimeoutError' ? 'GHL took too long to answer.' : 'Could not reach GHL.'
    }
    const outcome = classify({ ...p, method: 'GET' }, status, body)
    this.calls.push({ method: 'GET', endpoint: logEndpoint(path), http_status: status, result: outcome.result, detail: outcome.detail })
    return { ok: outcome.result === 'works', body }
  }
}

interface Company {
  organization_id: string
  inbound_mode: 'test_only' | 'all'
  last_synced_at: string | null
  /**
   * Test mode: GHL contacts already linked to a LOSuite person named TEST (e.g. by a send), saved whatever
   * GHL calls them, but only from when they were linked (ghl_linked_at), and never GHL's own automated sends.
   */
  testLinks: Map<string, string | null>
}

interface Summary {
  conversations: number
  saved: number
  updated: number
  needsMatching: number
  skippedNotTest: number
  optOuts: number
  failed: number
  /** Reply drafts made or rewritten for the loan officer (Phase 2b). */
  drafts: number
}

interface PersonRow {
  id: string
  ghl_contact_id: string | null
  email: string | null
  phone_digits: string | null
  sms_opted_out_at?: string | null
  email_opted_out_at?: string | null
}

/** Turns one channel's consent off and records why. Skipped when already opted out. */
async function optOut(db: SupabaseClient, orgId: string, contactId: string, channel: 'text' | 'email', source: 'stop_reply' | 'ghl_dnd'): Promise<boolean> {
  const field = channel === 'text' ? 'sms' : 'email'
  const now = new Date().toISOString()
  const updated = await db
    .from('contacts')
    .update({ [`${field}_consent`]: false, [`${field}_opted_out_at`]: now })
    .eq('id', contactId)
    .eq('organization_id', orgId)
    .is(`${field}_opted_out_at`, null)
    .select('id')
  if (updated.error) throw new Error(updated.error.message)
  if (!updated.data?.length) return false
  const event = await db.from('consent_events').insert({ organization_id: orgId, contact_id: contactId, channel, change: 'opted_out', source })
  if (event.error) throw new Error(event.error.message)
  return true
}

/** Which LOSuite person this GHL contact is, and links them by GHL id the first time. */
async function matchPerson(db: SupabaseClient, orgId: string, contact: GhlContact): Promise<MatchResult> {
  const found = await db.rpc('ghl_match_candidates', { p_organization_id: orgId, p_ghl_contact_id: contact.id, p_email: contact.email, p_phone10: phone10(contact.phone) })
  if (found.error) throw new Error(found.error.message)
  const rows = (found.data ?? []) as PersonRow[]
  const candidates: Candidate[] = rows.map((r) => ({ id: r.id, ghlContactId: r.ghl_contact_id, email: r.email, phoneDigits: r.phone_digits }))
  const result = matchContact({ id: contact.id, email: contact.email, phone: contact.phone }, candidates)
  if (result.kind === 'matched' && result.by !== 'ghl_id' && !rows.find((r) => r.id === result.contactId)?.ghl_contact_id) {
    const link = await db.from('contacts').update({ ghl_contact_id: contact.id }).eq('id', result.contactId).eq('organization_id', orgId).is('ghl_contact_id', null)
    if (link.error) throw new Error(link.error.message)
  }
  return result
}

/**
 * A partner (title, insurance, realtor…) this GHL contact is (Connor, 2026-11-14):
 * by the GHL id saved when they were added to GHL, else (byEmail) the one
 * partner with this email, who is then linked. Never by name.
 */
async function partnerFor(db: SupabaseClient, orgId: string, contact: GhlContact, byEmail: boolean): Promise<{ id: string; by: 'ghl_id' | 'email' } | null> {
  const byId = await db.from('partners').select('id').eq('organization_id', orgId).eq('ghl_contact_id', contact.id).limit(2)
  if (byId.error) throw new Error(byId.error.message)
  if (byId.data?.length === 1) return { id: (byId.data[0] as { id: string }).id, by: 'ghl_id' }
  const email = contact.email?.trim().toLowerCase()
  if (!byEmail || !email || byId.data?.length) return null
  const found = await db.from('partners').select('id, ghl_contact_id').eq('organization_id', orgId).eq('email', email).limit(2)
  if (found.error) throw new Error(found.error.message)
  const rows = (found.data ?? []) as { id: string; ghl_contact_id: string | null }[]
  // Two partners with this email, or one linked to a different GHL contact: an admin decides.
  if (rows.length !== 1 || rows[0].ghl_contact_id) return null
  const link = await db.from('partners').update({ ghl_contact_id: contact.id }).eq('id', rows[0].id).eq('organization_id', orgId).is('ghl_contact_id', null)
  if (link.error) throw new Error(link.error.message)
  return { id: rows[0].id, by: 'email' }
}

/** The files a partner is on, with what names them (borrowers, loan numbers), and the file we last wrote to them from. */
async function partnerFiles(db: SupabaseClient, partnerId: string): Promise<{ files: PartnerFile[]; lastSentLoanId: string | null }> {
  const [team, last] = await Promise.all([
    db.from('loan_team_members').select('loan:loans!loan_team_members_loan_id_fkey ( *, borrowers:loan_borrowers ( contact:contacts!loan_borrowers_contact_id_fkey ( first_name, last_name ) ) )').eq('partner_id', partnerId),
    db.from('messages').select('loan_id').eq('partner_id', partnerId).eq('direction', 'outbound').not('loan_id', 'is', null).order('sent_at', { ascending: false }).limit(1),
  ])
  if (team.error || last.error) throw new Error((team.error ?? last.error)!.message)
  type LoanRow = { id: string; stage: string; created_at: string; arive_loan_number: string | null; lender_loan_number?: string | null; title_file_number?: string | null; borrowers: { contact: { first_name: string | null; last_name: string | null } | null }[] }
  const seen = new Set<string>()
  const files: PartnerFile[] = []
  for (const t of (team.data ?? []) as unknown as { loan: LoanRow | null }[]) {
    const l = t.loan
    if (!l || seen.has(l.id)) continue
    seen.add(l.id)
    files.push({
      loanId: l.id,
      borrowerNames: l.borrowers.flatMap((b) => (b.contact ? [[b.contact.first_name, b.contact.last_name].filter(Boolean).join(' ')] : [])),
      loanNumbers: [l.arive_loan_number, l.lender_loan_number ?? null, l.title_file_number ?? null].filter((n): n is string => !!n),
      open: !['closed', 'lost'].includes(l.stage),
      createdAt: l.created_at,
    })
  }
  return { files, lastSentLoanId: ((last.data ?? [])[0] as { loan_id: string } | undefined)?.loan_id ?? null }
}

/** Turns a partner's texts or emails off (a STOP reply or GHL's Do Not Disturb). */
async function partnerOptOut(db: SupabaseClient, orgId: string, partnerId: string, channel: 'text' | 'email'): Promise<boolean> {
  const field = channel === 'text' ? 'sms' : 'email'
  const u = await db.from('partners').update({ [`${field}_opted_out_at`]: new Date().toISOString(), [`${field}_consent`]: false }).eq('id', partnerId).eq('organization_id', orgId).is(`${field}_opted_out_at`, null).select('id')
  if (u.error) throw new Error(u.error.message)
  return !!u.data?.length
}

/** Copies one conversation's latest texts and emails into LOSuite. */
async function syncConversation(db: SupabaseClient, g: Ghl, company: Company, conversationId: string, ghlContactId: string, cache: Map<string, GhlContact | null>, s: Summary) {
  const orgId = company.organization_id

  // GET /contacts/{contactId} (contacts.readonly, Version 2021-07-28).
  if (!cache.has(ghlContactId)) {
    const c = await g.get('contacts_read', `/contacts/${encodeURIComponent(ghlContactId)}`)
    cache.set(ghlContactId, c.ok ? pickContact(c.body) : null)
  }
  const contact = cache.get(ghlContactId)
  if (!contact) {
    s.failed++
    return
  }
  if (company.inbound_mode === 'test_only' && !isTestContact(contact) && !company.testLinks.has(contact.id)) {
    s.skippedNotTest++
    return
  }
  s.conversations++

  // GET /conversations/{conversationId}/messages (conversations/message.readonly, Version 2021-04-15).
  const list = await g.get('messages_read', `/conversations/${encodeURIComponent(conversationId)}/messages?limit=${MESSAGES_PER_CONVERSATION}`)
  if (!list.ok) {
    s.failed++
    return
  }
  const all = pickMessages(list.body)
  const messages = company.inbound_mode === 'test_only' ? all.filter((m) => keepInTestMode(m, company.testLinks.get(contact.id) ?? null)) : all

  // A partner linked by GHL id is theirs; else a borrower; else one partner with this email.
  let partner = await partnerFor(db, orgId, contact, false)
  const match: MatchResult = partner ? { kind: 'needs_matching', reason: 'no_match', candidateIds: [] } : await matchPerson(db, orgId, contact)
  if (!partner && match.kind !== 'matched') partner = await partnerFor(db, orgId, contact, true)
  const personId = !partner && match.kind === 'matched' ? match.contactId : null
  if (partner) {
    if (contact.dndText && (await partnerOptOut(db, orgId, partner.id, 'text'))) s.optOuts++
    if (contact.dndEmail && (await partnerOptOut(db, orgId, partner.id, 'email'))) s.optOuts++
  }

  // GHL's Do Not Disturb turns consent off (a person turns it back on, with a note).
  if (personId) {
    if (contact.dndText && (await optOut(db, orgId, personId, 'text', 'ghl_dnd'))) s.optOuts++
    if (contact.dndEmail && (await optOut(db, orgId, personId, 'email', 'ghl_dnd'))) s.optOuts++
  }
  if (!messages.length) return

  const existing = await db.from('messages').select('ghl_message_id, status').eq('organization_id', orgId).in('ghl_message_id', messages.map((m) => m.id))
  if (existing.error) throw new Error(existing.error.message)
  const known = new Map(((existing.data ?? []) as { ghl_message_id: string; status: string | null }[]).map((r) => [r.ghl_message_id, r.status]))

  // Already saved: only GHL's status can change (delivered, read, …). Who it belongs to never changes here.
  for (const m of messages.filter((m) => known.has(m.id) && known.get(m.id) !== m.status)) {
    const u = await db.from('messages').update({ status: m.status }).eq('organization_id', orgId).eq('ghl_message_id', m.id)
    if (u.error) throw new Error(u.error.message)
    s.updated++
  }

  const fresh = messages.filter((m) => !known.has(m.id))
  if (!fresh.length) return
  let loanId: string | null = null
  if (personId) {
    const loan = await db.rpc('message_loan_for', { p_contact_id: personId })
    if (loan.error) throw new Error(loan.error.message)
    loanId = (loan.data as string | null) ?? null
  }

  const rows = []
  if (partner) {
    // A partner's message goes on the file it's about (the borrower or loan number in it, else the file we last wrote from).
    const pf = await partnerFiles(db, partner.id)
    for (const m of fresh) {
      const row = await messageRow(g, orgId, m, contact, conversationId, match, null)
      rows.push({ ...row, contact_id: null, partner_id: partner.id, loan_id: partnerFileFor(`${row.subject ?? ''}\n${row.body ?? ''}`, pf.files, pf.lastSentLoanId), match_status: 'matched', matched_by: partner.by, match_reason: null, candidate_ids: [] })
    }
  } else for (const m of fresh) rows.push(await messageRow(g, orgId, m, contact, conversationId, match, loanId))
  const saved = await db.from('messages').upsert(rows, { onConflict: 'organization_id,ghl_message_id', ignoreDuplicates: true }).select('ghl_message_id')
  if (saved.error) throw new Error(saved.error.message)
  s.saved += saved.data?.length ?? 0
  if (!personId && !partner) s.needsMatching += saved.data?.length ?? 0

  // A partner's STOP or unsubscribe turns that channel off for them (no reply drafts for partners).
  if (partner) {
    if (fresh.some((m) => m.channel === 'text' && m.direction === 'inbound' && isStopReply(m.body)) && (await partnerOptOut(db, orgId, partner.id, 'text'))) s.optOuts++
    if (rows.some((r) => r.channel === 'email' && r.direction === 'inbound' && isEmailUnsubscribe(r.body)) && (await partnerOptOut(db, orgId, partner.id, 'email'))) s.optOuts++
    return
  }

  // A STOP reply turns texting off.
  if (personId && fresh.some((m) => m.channel === 'text' && m.direction === 'inbound' && isStopReply(m.body))) {
    if (await optOut(db, orgId, personId, 'text', 'stop_reply')) s.optOuts++
  }
  // An email reply that only says "unsubscribe" (or the like) turns email off.
  if (personId && rows.some((r) => r.channel === 'email' && r.direction === 'inbound' && isEmailUnsubscribe(r.body))) {
    if (await optOut(db, orgId, personId, 'email', 'stop_reply')) s.optOuts++
  }
  // New client texts get no automatic reply draft (Connor, 2026-11-16): the loan officer is notified
  // (messages_notify) and presses "Suggest a reply" in the Messages tab when they want one.
}

async function messageRow(g: Ghl, orgId: string, m: GhlMessage, contact: GhlContact, conversationId: string, match: MatchResult, loanId: string | null) {
  let subject: string | null = null
  let body = m.body
  let from: string | null = null
  let to: string | null = null
  if (m.channel === 'email' && m.emailId) {
    // GET /conversations/messages/email/{id} (conversations/message.readonly, Version 2021-04-15): subject, body, from, to.
    const e = await g.get('messages_read', `/conversations/messages/email/${encodeURIComponent(m.emailId)}`)
    const detail = e.ok ? pickEmail(e.body) : null
    if (detail) {
      subject = detail.subject
      body = detail.body || body
      from = detail.from
      to = detail.to
    }
  }
  return {
    organization_id: orgId,
    contact_id: match.kind === 'matched' ? match.contactId : null,
    loan_id: match.kind === 'matched' ? loanId : null,
    channel: m.channel,
    direction: m.direction,
    subject,
    body,
    from_address: from,
    to_address: to,
    status: m.status,
    sent_at: m.sentAt,
    ghl_message_id: m.id,
    ghl_conversation_id: m.conversationId ?? conversationId,
    ghl_contact_id: contact.id,
    // Who it's from as GHL has them, so an admin can match it (20261204000000_ghl_message_senders.sql).
    ghl_contact_name: contact.name ?? ([contact.firstName, contact.lastName].filter(Boolean).join(' ') || null),
    ghl_contact_email: contact.email,
    ghl_contact_phone: contact.phone,
    ghl_user_id: m.userId,
    ghl_source: m.source,
    match_status: match.kind === 'matched' ? 'matched' : 'needs_matching',
    matched_by: match.kind === 'matched' ? match.by : null,
    match_reason: match.kind === 'matched' ? null : match.reason,
    candidate_ids: match.kind === 'matched' ? [] : match.candidateIds,
  }
}

/** Test mode: a conversation GHL lists under a name without TEST is skipped before its contact is even read. */
const skipByName = (company: Company, c: ConversationRef) =>
  company.inbound_mode === 'test_only' && !!c.name && !isTestContact({ firstName: null, lastName: null, name: c.name }) && !company.testLinks.has(c.contactId)

/** A webhook: every conversation of one GHL contact. */
async function syncContact(db: SupabaseClient, g: Ghl, company: Company, ghlContactId: string, s: Summary) {
  // GET /conversations/search?contactId (conversations.readonly, Version 2021-04-15).
  const found = await g.get('conversations_read', `/conversations/search?locationId=${encodeURIComponent(g.locationId)}&contactId=${encodeURIComponent(ghlContactId)}`)
  if (!found.ok) {
    s.failed++
    return
  }
  const cache = new Map<string, GhlContact | null>()
  for (const c of pickConversations(found.body)) {
    if (skipByName(company, c)) {
      s.skippedNotTest++
      continue
    }
    await syncConversation(db, g, company, c.id, ghlContactId, cache, s)
  }
}

/** A catch-up: every conversation with a message since the last check. */
async function catchUp(db: SupabaseClient, g: Ghl, company: Company, s: Summary) {
  const started = new Date()
  const since = company.last_synced_at ? Date.parse(company.last_synced_at) - OVERLAP_MS : started.getTime() - FIRST_LOOKBACK_MS
  const found = await g.get(
    'conversations_read',
    `/conversations/search?locationId=${encodeURIComponent(g.locationId)}&sortBy=last_message_date&sort=desc&limit=${MAX_CONVERSATIONS}`,
  )
  if (!found.ok) {
    s.failed++
    return
  }
  const cache = new Map<string, GhlContact | null>()
  for (const c of pickConversations(found.body)) {
    if (c.lastMessageAt !== null && c.lastMessageAt < since) break
    if (skipByName(company, c)) {
      s.skippedNotTest++
      continue
    }
    await syncConversation(db, g, company, c.id, c.contactId, cache, s)
  }
  const saved = await db.from('messaging_settings').update({ last_synced_at: started.toISOString() }).eq('organization_id', company.organization_id)
  if (saved.error) throw new Error(saved.error.message)
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' })

  const token = Deno.env.get('GHL_PRIVATE_TOKEN')
  const locationId = Deno.env.get('GHL_LOCATION_ID')
  if (!token || !locationId) return reply(500, { error: 'GHL is not set up yet: add GHL_PRIVATE_TOKEN and GHL_LOCATION_ID under Edge Functions → Secrets in Supabase.' })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  const company = await db.from('messaging_settings').select('organization_id, inbound_mode, last_synced_at').eq('ghl_location_id', locationId).maybeSingle()
  if (company.error) return reply(500, { error: company.error.message })
  if (!company.data) return reply(409, { error: 'LOSuite doesn\'t know which company this GHL sub-account belongs to yet. An owner or admin runs Check connection in Settings → GoHighLevel first.' })
  const co = { ...(company.data as Omit<Company, 'testLinks'>), testLinks: new Map<string, string | null>() } as Company
  if (co.inbound_mode === 'test_only') {
    const linked = await db.from('contacts').select('ghl_contact_id, ghl_linked_at, first_name, last_name').eq('organization_id', co.organization_id).not('ghl_contact_id', 'is', null)
    if (linked.error) return reply(500, { error: linked.error.message })
    for (const r of (linked.data ?? []) as { ghl_contact_id: string; ghl_linked_at: string | null; first_name: string | null; last_name: string | null }[]) {
      if (isTestContact({ firstName: r.first_name, lastName: r.last_name, name: null })) co.testLinks.set(r.ghl_contact_id, r.ghl_linked_at)
    }
  }

  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const key = new URL(request.url).searchParams.get('key')
  let calledBy: string | null = null
  let task: 'webhook' | 'catch_up'

  if (key !== null) {
    // GHL's workflow or the scheduled check.
    if (!secretMatches(key, Deno.env.get('GHL_WEBHOOK_SECRET'))) return reply(401, { error: 'Wrong or missing key.' })
    task = body.task === 'catch_up' ? 'catch_up' : 'webhook'
  } else {
    // An owner or admin from the app, with their sign-in.
    const auth = request.headers.get('Authorization')
    if (!auth) return reply(401, { error: 'Sign in first.' })
    const user = await createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false } }).auth.getUser(auth.replace(/^Bearer\s+/i, ''))
    if (user.error || !user.data.user) return reply(401, { error: 'Your session expired. Sign in again.' })
    const role = await db.from('organization_members').select('role').eq('organization_id', co.organization_id).eq('user_id', user.data.user.id).in('role', ['owner', 'admin']).maybeSingle()
    if (role.error) return reply(500, { error: role.error.message })
    if (!role.data) return reply(403, { error: 'Only an owner or admin can check GHL for new messages.' })
    if (body.task !== 'catch_up') return reply(400, { error: 'Unknown task.' })
    calledBy = user.data.user.id
    task = 'catch_up'
  }

  const g = new Ghl(token, locationId)
  const s: Summary = { conversations: 0, saved: 0, updated: 0, needsMatching: 0, skippedNotTest: 0, optOuts: 0, failed: 0, drafts: 0 }
  let error: string | null = null
  try {
    if (task === 'webhook') {
      const contactId = webhookContactId(body)
      if (!contactId) return reply(400, { error: 'The webhook didn\'t name a GHL contact (contact_id).' })
      await syncContact(db, g, co, contactId, s)
    } else {
      await catchUp(db, g, co, s)
    }
  } catch (e) {
    error = (e as Error).message
  }

  const log = g.calls.length
    ? await db.from('ghl_calls').insert(g.calls.map((c) => ({ organization_id: co.organization_id, called_by: calledBy, task: task === 'webhook' ? 'inbound_webhook' : 'inbound_catch_up', ...c })))
    : { error: null }
  const logError = log.error ? `The GHL call log wasn't saved: ${log.error.message}` : null
  if (error) return reply(500, { error, ...s, logError })
  return reply(200, { ...s, mode: co.inbound_mode, logError })
})
