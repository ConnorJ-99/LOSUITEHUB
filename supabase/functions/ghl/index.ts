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
//
// The token and location id live in Edge Function secrets (GHL_PRIVATE_TOKEN,
// GHL_LOCATION_ID) and never reach the browser or the logs. Every request runs
// as the signed-in user, so Row Level Security applies; check and link are
// for owners and admins. Every GHL call is logged in ghl_calls (path, answer
// code, ids; never the token). Nothing in GHL is created, changed, sent, or
// enrolled in a workflow: the two "write" checks send a blank request that
// GHL refuses.

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
    const role = await db.from('organization_members').select('role').eq('organization_id', organizationId).eq('user_id', userId).in('role', ['owner', 'admin']).maybeSingle()
    if (role.error) throw new Error(role.error.message)
    if (!role.data) return reply(403, { error: 'Only an owner or admin can manage the GHL connection.' })

    const g = new Ghl(token, locationId)
    if (task === 'token_check') return reply(200, await tokenCheck(db, g, organizationId, userId))
    if (task === 'link_user') return reply(200, await linkUser(db, g, organizationId, userId, body))
    throw new UserError('Unknown task.')
  } catch (e) {
    return reply(e instanceof UserError ? 400 : 500, { error: (e as Error).message })
  }
})
