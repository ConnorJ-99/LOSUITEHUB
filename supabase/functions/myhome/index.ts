// MPS HQ: the myhome Edge Function (MyHome Stage 1, docs/plans/myhome.md).
// Verify JWT is ON. /myhome talks only to this; borrowers never query tables
// (their login has no organization_members row, so RLS shows them nothing).
// It uses the service role, so it checks everything itself:
//   sign_in    email + the person's permanent MyHome code, or their personal
//              link (/myhome?invite=…, never expires) + their email. 5 wrong
//              tries in an hour lock the account for the hour; a wrong email and
//              a wrong code get the same answer. Then it makes or updates the
//              MyHome login (marked myhome in app metadata, so it gets no staff
//              profile and can't join the team) and returns a one-time sign-in
//              key (generateLink, which emails nothing); the page trades it for
//              a session with verifyOtp on its own client.
//   me         the signed-in borrower: first name, every file they're a
//              borrower on (lost ones left out) with its MyHome view (active,
//              nurture, closed), and their loan officer's card.
// Never sends anything: the code and link reach the borrower only through
// Connor's GHL email ("Send MyHome code to GHL", the ghl function).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import { CODE_LENGTH, INVITE_TOKEN, LINK_EMAIL_WRONG, LINK_GONE, LOCKED, NOT_SIGNED_IN, NO_MATCH, STAFF_EMAIL, TURNED_OFF, cleanCode, emailLooksValid, fileLabel, isLocked, normEmail, orderFiles, pickAccount, sameCode, viewFor, type AccountMatch, type AccountStatus, type MyHomeFile, type MyHomeLo, type MyHomeMe } from './rules.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

const URL_ = Deno.env.get('SUPABASE_URL')!
const admin = () => createClient(URL_, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

interface AccountRow {
  id: string
  organization_id: string
  contact_id: string
  user_id: string | null
  status: AccountStatus
}

const event = (db: SupabaseClient, a: Pick<AccountRow, 'id' | 'organization_id' | 'contact_id'>, kind: string, detail: Record<string, unknown> = {}, loanId: string | null = null) =>
  db.from('myhome_events').insert({ organization_id: a.organization_id, account_id: a.id, contact_id: a.contact_id, loan_id: loanId, kind, detail })

/** The loan officer's card: name, NMLS, phone, email, and the headshot from Pages if there is one. */
async function loCard(db: SupabaseClient, organizationId: string, loId: string | null): Promise<MyHomeLo> {
  if (!loId) return { name: 'MPS Mortgage', nmls: null, phone: null, email: null, photoUrl: null }
  const [prof, link] = await Promise.all([
    db.from('profiles').select('full_name, email, nmls, phone').eq('id', loId).maybeSingle(),
    db.from('ghl_user_links').select('ghl_number, ghl_email').eq('organization_id', organizationId).eq('profile_id', loId).maybeSingle(),
  ])
  const p = prof.data as { full_name: string | null; email: string; nmls: string | null; phone: string | null } | null
  const g = link.data as { ghl_number: string | null; ghl_email: string | null } | null
  let photoUrl: string | null = null
  const files = await db.storage.from('page-assets').list(`${organizationId}/headshots`, { search: loId, limit: 5 })
  const file = (files.data ?? []).find((f) => f.name.startsWith(loId))
  if (file) photoUrl = db.storage.from('page-assets').getPublicUrl(`${organizationId}/headshots/${file.name}`).data.publicUrl
  return { name: p?.full_name || 'Your loan officer', nmls: p?.nmls ?? null, phone: g?.ghl_number ?? p?.phone ?? null, email: g?.ghl_email ?? p?.email ?? null, photoUrl }
}

// ---------------------------------------------------------------------------
// sign_in: email + MyHome code, or the personal link + email
// ---------------------------------------------------------------------------

interface Candidate extends AccountRow {
  contact_email: string | null
  invite_code: string
}

const wrongCount = async (db: SupabaseClient, accountId: string) => {
  const hourAgo = new Date(Date.now() - 3600_000).toISOString()
  const r = await db.from('myhome_events').select('id', { count: 'exact', head: true }).eq('account_id', accountId).eq('kind', 'code_wrong').gte('created_at', hourAgo)
  return r.count ?? 0
}

/** Checks the email and code (or link), then makes or updates the MyHome login and hands the page a one-time sign-in key. */
async function signIn(db: SupabaseClient, body: Record<string, unknown>): Promise<Response> {
  const email = normEmail(typeof body.email === 'string' ? body.email : '')
  if (!email || !emailLooksValid(email)) return reply(400, { error: 'Type your email address.' })
  const invite = typeof body.invite === 'string' ? body.invite.toLowerCase() : null
  let account: Candidate

  if (invite) {
    // The personal link: it never expires, but the typed email must be the person's.
    if (!INVITE_TOKEN.test(invite)) return reply(404, { error: LINK_GONE })
    const r = await db.from('borrower_accounts').select('id, organization_id, contact_id, user_id, status, invite_code, contact:contacts ( email )').eq('invite_token', invite).maybeSingle()
    if (r.error) throw new Error(r.error.message)
    const row = r.data as unknown as (AccountRow & { invite_code: string; contact: { email: string | null } | null }) | null
    if (!row || row.status === 'off') return reply(404, { error: LINK_GONE })
    account = { ...row, contact_email: row.contact?.email ?? null }
    if (isLocked(await wrongCount(db, account.id))) return reply(429, { error: LOCKED })
    if (normEmail(account.contact_email) !== email) {
      await event(db, account, 'code_wrong', { via: 'link' })
      return reply(403, { error: LINK_EMAIL_WRONG })
    }
  } else {
    const code = cleanCode(typeof body.code === 'string' ? body.code : '')
    if (!code) return reply(400, { error: `Type the ${CODE_LENGTH}-digit MyHome code from your email.` })
    const found = await db.rpc('myhome_accounts_for_email', { p_email: email })
    if (found.error) throw new Error(found.error.message)
    const rows = (found.data ?? []) as { account_id: string; status: AccountStatus; user_id: string | null; organization_id: string; contact_id: string; contact_email: string | null; invite_code: string }[]
    const pick = pickAccount(rows.map((r): AccountMatch => ({ accountId: r.account_id, status: r.status, contactEmail: r.contact_email })), email)
    if ('problem' in pick) {
      // Two people share the email: nobody signs in by code until Connor sorts it out. Recorded on each.
      if (pick.problem === 'shared') for (const r of rows.filter((x) => x.status !== 'off')) await event(db, { id: r.account_id, organization_id: r.organization_id, contact_id: r.contact_id }, 'code_refused', { reason: 'shared_email' })
      return reply(403, { error: NO_MATCH })
    }
    const r = rows.find((x) => x.account_id === pick.accountId)!
    account = { id: r.account_id, organization_id: r.organization_id, contact_id: r.contact_id, user_id: r.user_id, status: r.status, contact_email: r.contact_email, invite_code: r.invite_code }
    if (isLocked(await wrongCount(db, account.id))) return reply(429, { error: LOCKED })
    if (!sameCode(code, account.invite_code)) {
      await event(db, account, 'code_wrong', { via: 'code' })
      return reply(403, { error: NO_MATCH })
    }
  }

  // The login: the one with this email, else the account's own (its email updated), else a new one.
  const login = await db.rpc('myhome_auth_user', { p_email: email })
  if (login.error) throw new Error(login.error.message)
  const existing = ((login.data ?? []) as { user_id: string; is_myhome: boolean }[])[0] ?? null
  let userId: string
  if (existing) {
    if (!existing.is_myhome) {
      await event(db, account, 'code_refused', { reason: 'staff_email' })
      return reply(403, { error: STAFF_EMAIL })
    }
    const taken = await db.from('borrower_accounts').select('id').eq('user_id', existing.user_id).neq('id', account.id).maybeSingle()
    if (taken.data || (account.user_id && account.user_id !== existing.user_id)) {
      // That email is another MyHome account's login: leave both alone and let Connor look.
      await event(db, account, 'code_refused', { reason: 'login_taken' })
      return reply(409, { error: 'This email is already used by another MyHome account. Contact your loan officer.' })
    }
    userId = existing.user_id
  } else if (account.user_id) {
    const u = await db.auth.admin.updateUserById(account.user_id, { email, email_confirm: true })
    if (u.error) throw new Error(u.error.message)
    userId = account.user_id
  } else {
    const u = await db.auth.admin.createUser({ email, email_confirm: true, app_metadata: { myhome: true } })
    if (u.error || !u.data.user) throw new Error(u.error?.message ?? 'Could not make the login.')
    userId = u.data.user.id
  }
  if (account.user_id !== userId) {
    const link = await db.from('borrower_accounts').update({ user_id: userId }).eq('id', account.id)
    if (link.error) throw new Error(link.error.message)
  }

  // A one-time sign-in key for this login. Nothing is emailed: the page trades it for a session right away.
  const key = await db.auth.admin.generateLink({ type: 'magiclink', email })
  if (key.error || !key.data.properties?.hashed_token) throw new Error(key.error?.message ?? 'Could not sign you in. Try again.')
  return reply(200, { tokenHash: key.data.properties.hashed_token, type: key.data.properties.verification_type ?? 'magiclink' })
}

// ---------------------------------------------------------------------------
// me
// ---------------------------------------------------------------------------

/** The signed-in borrower's account, or the reply to send instead. */
async function signedIn(db: SupabaseClient, request: Request): Promise<AccountRow | Response> {
  const jwt = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return reply(401, { error: NOT_SIGNED_IN })
  const u = await db.auth.getUser(jwt)
  const user = u.data.user
  if (u.error || !user) return reply(401, { error: NOT_SIGNED_IN })
  if (user.app_metadata?.myhome !== true) return reply(403, { error: 'This is an MPS-HQ team login. MyHome is for borrowers.' })
  const a = await db.from('borrower_accounts').select('id, organization_id, contact_id, user_id, status').eq('user_id', user.id).maybeSingle()
  if (a.error) throw new Error(a.error.message)
  const account = a.data as AccountRow | null
  if (!account) return reply(401, { error: NOT_SIGNED_IN })
  if (account.status === 'off') return reply(403, { error: TURNED_OFF, state: 'off' })
  return account
}

interface LoanRow {
  id: string
  stage: string
  purpose: string
  closing_date: string | null
  created_at: string
  assigned_lo_id: string | null
  subject_property_id: string | null
}

async function me(db: SupabaseClient, account: AccountRow, fresh: boolean): Promise<MyHomeMe> {
  const now = new Date().toISOString()
  if (account.status === 'invited') await db.from('borrower_accounts').update({ status: 'active', activated_at: now }).eq('id', account.id)
  if (fresh) {
    await db.from('borrower_accounts').update({ last_signed_in_at: now }).eq('id', account.id)
    await event(db, account, 'signed_in')
  }

  const [person, on] = await Promise.all([
    db.from('contacts').select('first_name').eq('id', account.contact_id).single(),
    db.from('loan_borrowers').select('loan_id').eq('contact_id', account.contact_id),
  ])
  const loanIds = ((on.data ?? []) as { loan_id: string }[]).map((x) => x.loan_id)
  const loans = loanIds.length
    ? ((await db.from('loans').select('id, stage, purpose, closing_date, created_at, assigned_lo_id, subject_property_id').in('id', loanIds).eq('organization_id', account.organization_id)).data ?? []) as LoanRow[]
    : []
  const homeIds = loans.map((l) => l.subject_property_id).filter((x): x is string => !!x)
  const homes = homeIds.length ? (((await db.from('properties').select('id, address_line, city').in('id', homeIds)).data ?? []) as { id: string; address_line: string; city: string | null }[]) : []

  const files = orderFiles(
    loans.flatMap((l): (MyHomeFile & { lo: string | null })[] => {
      const view = viewFor(l.stage)
      if (!view) return []
      const home = homes.find((h) => h.id === l.subject_property_id) ?? null
      return [{ loanId: l.id, view, purpose: l.purpose, stage: l.stage, address: home?.address_line ?? null, city: home?.city ?? null, closingDate: l.closing_date, createdAt: l.created_at, lo: l.assigned_lo_id }]
    }),
  )
  const lo = files.length ? await loCard(db, account.organization_id, files[0].lo) : null
  return {
    firstName: (person.data as { first_name: string } | null)?.first_name ?? '',
    files: files.map(({ lo: _lo, ...f }) => ({ ...f, label: fileLabel(f) })),
    lo,
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' })
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const db = admin()
  try {
    if (body.action === 'sign_in') return await signIn(db, body)
    if (body.action === 'me') {
      const account = await signedIn(db, request)
      if (account instanceof Response) return account
      return reply(200, await me(db, account, body.fresh === true))
    }
    return reply(400, { error: 'Unknown action.' })
  } catch (e) {
    return reply(500, { error: (e as Error).message })
  }
})
