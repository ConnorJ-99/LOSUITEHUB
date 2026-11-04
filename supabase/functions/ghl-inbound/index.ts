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
// the GHL sub-account. Every GHL call is logged in ghl_calls. Nothing is sent: a new message from a
// client only gets a reply DRAFT in the Action Queue (draftReply, Phase 2b).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0'
import { complianceIssues, finalBody, type Signer } from '../assistant/followUp.ts'
import {
  buildReplyPrompt,
  latestBurst,
  needsNoReply,
  readReply,
  REPLY_MODEL,
  REPLY_SCHEMA,
  REPLY_SYSTEM,
  replyChannel,
  replySourceKey,
  replySubject,
  templateReply,
  THREAD_SENT,
  type ThreadMessage,
} from '../assistant/replyDraft.ts'
import { CHECKS, GHL_BASE, classify, logEndpoint, type CheckKey, type CheckResult } from '../ghl/checks.ts'
import { matchContact, phone10, type Candidate, type MatchResult } from '../ghl/match.ts'
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

  const match = await matchPerson(db, orgId, contact)
  const personId = match.kind === 'matched' ? match.contactId : null

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
  for (const m of fresh) rows.push(await messageRow(g, orgId, m, contact, conversationId, match, loanId))
  const saved = await db.from('messages').upsert(rows, { onConflict: 'organization_id,ghl_message_id', ignoreDuplicates: true }).select('ghl_message_id')
  if (saved.error) throw new Error(saved.error.message)
  s.saved += saved.data?.length ?? 0
  if (!personId) s.needsMatching += saved.data?.length ?? 0

  // A STOP reply turns texting off.
  if (personId && fresh.some((m) => m.channel === 'text' && m.direction === 'inbound' && isStopReply(m.body))) {
    if (await optOut(db, orgId, personId, 'text', 'stop_reply')) s.optOuts++
  }
  // An email reply that only says "unsubscribe" (or the like) turns email off.
  if (personId && rows.some((r) => r.channel === 'email' && r.direction === 'inbound' && isEmailUnsubscribe(r.body))) {
    if (await optOut(db, orgId, personId, 'email', 'stop_reply')) s.optOuts++
  }

  // Something new from the client: draft (or rewrite) one reply for the loan officer to approve. A problem here never stops the sync.
  if (personId && loanId && fresh.some((m) => m.direction === 'inbound')) {
    try {
      if (await draftReply(db, orgId, personId, loanId)) s.drafts++
    } catch (e) {
      console.error('Reply draft failed:', (e as Error).message)
    }
  }
}

/**
 * One reply draft per burst (Phase 2b): what the client sent since our last
 * message gets one Action Queue draft, keyed by the burst's first message, and
 * later messages in the same burst rewrite that same draft while it's still
 * waiting. With ANTHROPIC_API_KEY, Sonnet writes it (logged in ai_runs, checked
 * by the follow-up compliance rules); otherwise, or if the AI's draft can't be
 * used, a short template starts it. Never sends. True when a draft was made or
 * rewritten.
 */
async function draftReply(db: SupabaseClient, orgId: string, contactId: string, loanId: string): Promise<boolean> {
  const recent = await db.from('messages').select('id, channel, direction, subject, body, sent_at').eq('contact_id', contactId).order('sent_at', { ascending: false }).limit(30)
  if (recent.error) throw new Error(recent.error.message)
  const thread: ThreadMessage[] = ((recent.data ?? []) as { id: string; channel: 'text' | 'email'; direction: 'inbound' | 'outbound'; subject: string | null; body: string; sent_at: string }[]).map((m) => ({
    id: m.id,
    channel: m.channel,
    direction: m.direction,
    subject: m.subject,
    body: m.body,
    sentAt: m.sent_at,
  }))
  const burst = latestBurst(thread)
  if (needsNoReply(burst, (m) => (m.channel === 'text' ? isStopReply(m.body) : isEmailUnsubscribe(m.body)))) return false
  const last = burst[burst.length - 1]
  const key = replySourceKey(contactId, burst[0].id)

  const existing = await db.from('action_items').select('id, status, payload').eq('organization_id', orgId).eq('source_key', key).maybeSingle()
  if (existing.error) throw new Error(existing.error.message)
  const ex = existing.data as { id: string; status: string; payload: { burstLastId?: string } } | null
  // Already decided (sent, scheduled or dismissed), or already drafted from the newest message: nothing to do.
  if (ex && (ex.status !== 'pending' || ex.payload?.burstLastId === last.id)) return false

  const person = await db.from('contacts').select('first_name, phone, email, sms_opted_out_at, email_opted_out_at').eq('id', contactId).maybeSingle()
  const loan = await db.from('loans').select('stage, purpose, assigned_lo_id').eq('id', loanId).maybeSingle()
  if (person.error || loan.error) throw new Error((person.error ?? loan.error)!.message)
  const p = person.data as { first_name: string | null; phone: string | null; email: string | null; sms_opted_out_at: string | null; email_opted_out_at: string | null } | null
  const l = loan.data as { stage: string; purpose: string; assigned_lo_id: string | null } | null
  if (!p || !l) return false
  let channel = replyChannel(burst)
  // Opted out of that channel: answer on the other one if we can, else don't draft.
  if (channel === 'text' && p.sms_opted_out_at) channel = 'email'
  else if (channel === 'email' && p.email_opted_out_at) channel = 'text'
  if ((channel === 'text' && (p.sms_opted_out_at || !p.phone)) || (channel === 'email' && (p.email_opted_out_at || !p.email))) return false

  const [profile, org] = await Promise.all([
    l.assigned_lo_id ? db.from('profiles').select('full_name, nmls, phone').eq('id', l.assigned_lo_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from('organizations').select('name, nmls').eq('id', orgId).maybeSingle(),
  ])
  const pr = profile.data as { full_name: string | null; nmls: string | null; phone: string | null } | null
  const o = org.data as { name: string; nmls: string | null } | null
  const signer: Signer = { loName: pr?.full_name ?? null, loNmls: pr?.nmls ?? null, loPhone: pr?.phone ?? null, companyName: o?.name ?? 'MPS Mortgage LLC', companyNmls: o?.nmls ?? '2501110' }
  const firstName = p.first_name ?? ''
  const subject = channel === 'email' ? replySubject(burst) : null

  let body = templateReply(firstName, channel)
  let confidence: 'high' | 'medium' | 'low' = 'low'
  let aiRunId: string | null = null
  let fromAi = false
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (apiKey) {
    const run = await db
      .from('ai_runs')
      .insert({ organization_id: orgId, loan_id: loanId, task_type: 'reply_draft', input_ref: { contactId, messageIds: thread.slice(0, THREAD_SENT).map((m) => m.id), channel }, model: REPLY_MODEL, created_by: null })
      .select('id')
      .single()
    aiRunId = (run.data as { id: string } | null)?.id ?? null
    try {
      const anthropic = new Anthropic({ apiKey })
      const res = await anthropic.beta.messages.create({
        model: REPLY_MODEL,
        max_tokens: 2000,
        system: REPLY_SYSTEM,
        messages: [{ role: 'user', content: buildReplyPrompt(channel, { firstName: firstName || 'the client', stage: l.stage, purpose: l.purpose, loName: pr?.full_name ?? null }, thread) }],
        output_config: { effort: 'low', format: { type: 'json_schema', schema: REPLY_SCHEMA } },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      } as never)
      const r = res as unknown as { stop_reason: string; model: string; usage: { input_tokens: number; output_tokens: number }; content: { type: string; text?: string }[] }
      const text = r.content.flatMap((b) => (b.type === 'text' && b.text ? [b.text] : [])).join('')
      let parsed: unknown = null
      try {
        parsed = JSON.parse(text)
      } catch {
        // Unreadable: the template is used.
      }
      const read = r.stop_reason === 'end_turn' ? readReply(parsed) : { error: r.stop_reason }
      const issues = 'error' in read ? [`unusable answer (${read.error})`] : complianceIssues(channel, { subject, body: read.body })
      if (!('error' in read) && issues.length === 0) {
        body = read.body
        confidence = read.confidence
        fromAi = true
      }
      if (aiRunId) {
        await db
          .from('ai_runs')
          .update(
            fromAi
              ? { status: 'succeeded', output: { body, confidence }, model: r.model, input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens }
              : { status: 'failed', error: `Template used instead: ${issues.join(' ')}`, model: r.model, input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens },
          )
          .eq('id', aiRunId)
      }
    } catch (e) {
      if (aiRunId) await db.from('ai_runs').update({ status: 'failed', error: (e as Error).message.slice(0, 500) }).eq('id', aiRunId)
    }
  }

  const finalText = channel === 'email' ? finalBody('email', body, signer) : body
  const item = {
    title: `Reply to ${firstName || 'the client'}`,
    payload: { channel, to: channel === 'text' ? p.phone : p.email, subject, body: finalText, contactId, burstLastId: last.id, replyTo: burst.map((m) => m.id), template: !fromAi },
    confidence,
    sources: [],
    ai_run_id: fromAi ? aiRunId : null,
    due_on: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()),
  }
  if (ex) {
    // Still waiting: rewrite it with the newest messages (only while nobody has decided it).
    const u = await db.from('action_items').update(item).eq('id', ex.id).eq('status', 'pending')
    if (u.error) throw new Error(u.error.message)
  } else {
    const ins = await db.from('action_items').upsert({ organization_id: orgId, loan_id: loanId, kind: 'draft_message', source_key: key, created_by: null, ...item }, { onConflict: 'organization_id,source_key', ignoreDuplicates: true })
    if (ins.error) throw new Error(ins.error.message)
  }
  return true
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
