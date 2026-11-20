// MPS HQ: the myhome Edge Function (MyHome Stage 1, docs/plans/myhome.md).
// Verify JWT is ON. /myhome talks only to this; borrowers never query tables
// (their login has no organization_members row, so RLS shows them nothing).
// It uses the service role, so it checks everything itself:
//   sign_in    email + the person's permanent MyHome code, with or without
//              their personal link (/myhome?invite=…, never expires). 5 wrong
//              tries in an hour lock the account for the hour; a wrong email and
//              a wrong code get the same answer. Then it makes or updates the
//              MyHome login (marked myhome in app metadata, so it gets no staff
//              profile and can't join the team) and returns a one-time sign-in
//              key (generateLink, which emails nothing); the page trades it for
//              a session with verifyOtp on its own client.
//   me         the signed-in borrower: first name, every file they're a
//              borrower on (lost ones left out) with its MyHome view (active,
//              nurture, closed), and their loan officer's card.
// Stage 2 (open files, the borrower portal's sections, same rules and shapes
// as the document-upload function; each checks the file is theirs and open):
//   file       the status step and its message, their document checklist with
//              files, published letters and estimates by home, home requests,
//              and that file's loan officer
//   upload_url / uploaded   a one-time signed upload for one of their items,
//              then the upload recorded on the Documents tab and the item received
//   pdf        a one-minute link to a published letter or estimate PDF
//   home_request "Request numbers" for a home (submit_myhome_request())
// Never sends anything: the code and link reach the borrower only through
// Connor's GHL email ("Send MyHome code to GHL", the ghl function).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import { CODE_LENGTH, INVITE_TOKEN, LINK_GONE, LOCKED, NOT_OPEN, NOT_SIGNED_IN, NOT_YOURS, NO_MATCH, STAFF_EMAIL, TURNED_OFF, cleanCode, emailLooksValid, fileLabel, isLocked, normEmail, orderFiles, pickAccount, sameCode, viewFor, type AccountMatch, type AccountStatus, type MyHomeFile, type MyHomeLo, type MyHomeMe } from './rules.ts'
import { groupByHome, homeRequestProblem, portalStep, stepMessage, type HomeRequestInput, type PortalDoc, type PortalMilestone, type PortalStage, type PortalView, type RequestStatus } from '../document-upload/portal.ts'
import { canUpload, fileProblem, safeFileName, type UploadItem } from '../document-upload/rules.ts'

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
  // The code is always needed, with or without the personal link (Connor, 2026-11-20).
  const code = cleanCode(typeof body.code === 'string' ? body.code : '')
  if (!code) return reply(400, { error: `Type the ${CODE_LENGTH}-digit MyHome code from your email.` })
  let account: Candidate

  if (invite) {
    // The personal link: it never expires, but the typed email and code must be the person's.
    if (!INVITE_TOKEN.test(invite)) return reply(404, { error: LINK_GONE })
    const r = await db.from('borrower_accounts').select('id, organization_id, contact_id, user_id, status, invite_code, contact:contacts ( email )').eq('invite_token', invite).maybeSingle()
    if (r.error) throw new Error(r.error.message)
    const row = r.data as unknown as (AccountRow & { invite_code: string; contact: { email: string | null } | null }) | null
    if (!row || row.status === 'off') return reply(404, { error: LINK_GONE })
    account = { ...row, contact_email: row.contact?.email ?? null }
    if (isLocked(await wrongCount(db, account.id))) return reply(429, { error: LOCKED })
    // A wrong email and a wrong code get the same answer.
    if (normEmail(account.contact_email) !== email || !sameCode(code, account.invite_code)) {
      await event(db, account, 'code_wrong', { via: 'link' })
      return reply(403, { error: NO_MATCH })
    }
  } else {
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

// ---------------------------------------------------------------------------
// Stage 2: an open file (the borrower portal's sections)
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PUBLISHABLE = ['preapproval_letter', 'fee_worksheet', 'loan_comparison']

interface OpenFile {
  id: string
  organization_id: string
  stage: PortalStage
  purpose: string
  assigned_lo_id: string | null
}

/** The file in the request, when the signed-in person is a borrower on it and it's open (not nurture, closed or lost). */
async function openFile(db: SupabaseClient, account: AccountRow, loanId: unknown): Promise<OpenFile | Response> {
  if (typeof loanId !== 'string' || !UUID.test(loanId)) return reply(404, { error: NOT_YOURS })
  const [on, loan] = await Promise.all([
    db.from('loan_borrowers').select('loan_id').eq('loan_id', loanId).eq('contact_id', account.contact_id).maybeSingle(),
    db.from('loans').select('id, organization_id, stage, purpose, assigned_lo_id').eq('id', loanId).eq('organization_id', account.organization_id).maybeSingle(),
  ])
  if (on.error) throw new Error(on.error.message)
  if (loan.error) throw new Error(loan.error.message)
  const l = loan.data as OpenFile | null
  if (!on.data || !l || !viewFor(l.stage)) return reply(404, { error: NOT_YOURS })
  if (viewFor(l.stage) !== 'active') return reply(409, { error: NOT_OPEN, state: 'not_open' })
  return l
}

interface ItemRow {
  id: string
  label: string
  instructions: string | null
  status: UploadItem['status']
  reject_reason: string | null
  due_on: string | null
  kind: string
  document_id: string | null
}

/** Every request for this person on the file (waived ones left out), like a portal link's. */
async function itemsOf(db: SupabaseClient, account: AccountRow, l: OpenFile): Promise<ItemRow[]> {
  const r = await db.from('document_requests').select('id, label, instructions, status, reject_reason, due_on, kind, document_id').eq('loan_id', l.id).eq('contact_id', account.contact_id).neq('status', 'waived').order('requested_at')
  if (r.error) throw new Error(r.error.message)
  return r.data as ItemRow[]
}

/** The status step, published letters and estimates by home, and this person's home requests. */
async function portalView(db: SupabaseClient, account: AccountRow, l: OpenFile): Promise<PortalView> {
  const [milestones, person, settings, docs, homes, requests] = await Promise.all([
    db.from('loan_milestones').select('milestone').eq('loan_id', l.id),
    db.from('contacts').select('first_name').eq('id', account.contact_id).single(),
    db.from('messaging_settings').select('portal_stage_messages').eq('organization_id', l.organization_id).maybeSingle(),
    db.from('loan_documents').select('id, kind, file_name, property_id, published_at').eq('loan_id', l.id).not('published_at', 'is', null).in('kind', PUBLISHABLE).order('published_at', { ascending: false }),
    db.from('properties').select('id, address_line, city, list_price').eq('loan_id', l.id),
    db.from('portal_property_requests').select('id, property_id, address_line, price, status, wants_letter, wants_estimate, created_at').eq('loan_id', l.id).eq('contact_id', account.contact_id),
  ])
  const step = portalStep(l.stage, ((milestones.data ?? []) as { milestone: PortalMilestone }[]).map((m) => m.milestone))
  const custom = (settings.data as { portal_stage_messages: Record<string, unknown> } | null)?.portal_stage_messages ?? null
  const published: PortalDoc[] = ((docs.data ?? []) as { id: string; kind: PortalDoc['kind']; file_name: string; property_id: string | null; published_at: string }[]).map((d) => ({ id: d.id, kind: d.kind, name: d.file_name, propertyId: d.property_id, publishedAt: d.published_at }))
  const homeRows = ((homes.data ?? []) as { id: string; address_line: string; city: string | null; list_price: number | null }[]).map((h) => ({ id: h.id, address: h.city ? `${h.address_line}, ${h.city}` : h.address_line, price: h.list_price == null ? null : Number(h.list_price) }))
  const reqRows = ((requests.data ?? []) as { id: string; property_id: string | null; address_line: string; price: number; status: RequestStatus; wants_letter: boolean; wants_estimate: boolean; created_at: string }[]).map((r) => ({ id: r.id, propertyId: r.property_id, address: r.address_line, price: Number(r.price), status: r.status, wantsLetter: r.wants_letter, wantsEstimate: r.wants_estimate, createdAt: r.created_at }))
  return {
    borrowerFirstName: (person.data as { first_name: string } | null)?.first_name ?? '',
    step,
    stepMessage: stepMessage(step, custom),
    homes: groupByHome(homeRows, reqRows, published),
    isPurchase: l.purpose === 'purchase',
  }
}

async function fileView(db: SupabaseClient, account: AccountRow, l: OpenFile, opened: boolean) {
  const items = await itemsOf(db, account, l)
  const docs = items.length ? await db.from('loan_documents').select('document_request_id, file_name, created_at').in('document_request_id', items.map((i) => i.id)).order('created_at') : { data: [] }
  const files = (docs.data ?? []) as { document_request_id: string; file_name: string; created_at: string }[]
  if (opened) await event(db, account, 'opened', {}, l.id)
  const out: UploadItem[] = items.map((i) => ({
    id: i.id,
    label: i.label,
    instructions: i.instructions,
    status: i.status,
    rejectReason: i.status === 'rejected' ? i.reject_reason : null,
    dueOn: i.due_on,
    files: files.filter((f) => f.document_request_id === i.id).map((f) => ({ name: f.file_name, uploadedAt: f.created_at })),
  }))
  const [portal, lo] = await Promise.all([portalView(db, account, l), loCard(db, l.organization_id, l.assigned_lo_id)])
  return { items: out, portal, lo }
}

async function pdf(db: SupabaseClient, account: AccountRow, l: OpenFile, documentId: unknown): Promise<Response> {
  if (typeof documentId !== 'string' || !UUID.test(documentId)) return reply(400, { error: 'That document is not available.' })
  const doc = await db.from('loan_documents').select('storage_path').eq('id', documentId).eq('loan_id', l.id).not('published_at', 'is', null).in('kind', PUBLISHABLE).maybeSingle()
  const path = (doc.data as { storage_path: string } | null)?.storage_path
  if (!path) return reply(404, { error: 'That document is not available.' })
  const signed = await db.storage.from('loan-files').createSignedUrl(path, 60)
  if (signed.error || !signed.data) return reply(500, { error: 'The PDF could not open. Try again.' })
  await event(db, account, 'pdf', { documentId }, l.id)
  return reply(200, { url: signed.data.signedUrl })
}

async function homeRequest(db: SupabaseClient, account: AccountRow, l: OpenFile, raw: unknown): Promise<Response> {
  const input = (raw ?? {}) as Partial<HomeRequestInput>
  const req: HomeRequestInput = {
    address: String(input.address ?? '').slice(0, 200),
    city: String(input.city ?? '').slice(0, 100),
    state: String(input.state ?? '').toUpperCase(),
    zip: String(input.zip ?? ''),
    price: typeof input.price === 'number' && Number.isFinite(input.price) ? input.price : null,
    downMode: input.downMode === 'amount' ? 'amount' : 'percent',
    down: typeof input.down === 'number' && Number.isFinite(input.down) ? input.down : null,
    wantsLetter: input.wantsLetter === true,
    wantsEstimate: input.wantsEstimate === true,
    notes: String(input.notes ?? ''),
  }
  const problem = homeRequestProblem(req)
  if (problem) return reply(400, { error: problem })
  // Five requests an hour per account is plenty for a real borrower.
  const hourAgo = new Date(Date.now() - 3600_000).toISOString()
  const recent = await db.from('myhome_events').select('id', { count: 'exact', head: true }).eq('account_id', account.id).eq('kind', 'home_request').gte('created_at', hourAgo)
  if ((recent.count ?? 0) >= 5) return reply(429, { error: 'That is a lot of requests at once. Please wait a bit, or contact your loan officer.' })
  const r = await db.rpc('submit_myhome_request', {
    p_account: account.id,
    p_loan: l.id,
    p_address: req.address,
    p_city: req.city,
    p_state: req.state || 'TX',
    p_zip: req.zip,
    p_price: req.price,
    p_down_amount: req.downMode === 'amount' ? req.down : null,
    p_down_pct: req.downMode === 'percent' ? req.down : null,
    p_wants_letter: req.wantsLetter,
    p_wants_estimate: req.wantsEstimate,
    p_notes: req.notes,
  })
  if (r.error) return reply(400, { error: r.error.message })
  await event(db, account, 'home_request', { requestId: r.data }, l.id)
  return reply(200, { ok: true })
}

async function upload(db: SupabaseClient, account: AccountRow, l: OpenFile, body: Record<string, unknown>): Promise<Response> {
  if (typeof body.itemId !== 'string' || !UUID.test(body.itemId)) return reply(400, { error: 'Pick one of the items on this page.' })
  const item = (await itemsOf(db, account, l)).find((i) => i.id === body.itemId)
  if (!item) return reply(400, { error: 'Pick one of the items on this page.' })
  if (!canUpload(item.status)) return reply(409, { error: 'This item is already done. Nothing more is needed.' })
  const file = { name: String(body.fileName ?? ''), size: Number(body.size ?? 0), type: String(body.type ?? '') }
  const problem = fileProblem(file)
  if (problem) return reply(400, { error: problem })
  const folder = `${l.organization_id}/${l.id}`

  if (body.action === 'upload_url') {
    const path = `${folder}/${crypto.randomUUID()}-${safeFileName(file.name)}`
    const signed = await db.storage.from('loan-files').createSignedUploadUrl(path)
    if (signed.error || !signed.data) return reply(500, { error: 'The upload could not start. Try again.' })
    return reply(200, { path, token: signed.data.token })
  }

  // uploaded: the file must be in this file's folder and really there.
  const path = String(body.path ?? '')
  if (!path.startsWith(`${folder}/`) || path.includes('..')) return reply(400, { error: 'That upload is not for this file.' })
  const name = path.slice(folder.length + 1)
  const there = await db.storage.from('loan-files').list(folder, { search: name, limit: 1 })
  if (!(there.data ?? []).some((f) => f.name === name)) return reply(400, { error: "The file didn't finish uploading. Try again." })
  const doc = await db
    .from('loan_documents')
    .insert({ organization_id: l.organization_id, loan_id: l.id, contact_id: account.contact_id, kind: item.kind, file_name: file.name.slice(0, 200) || name, storage_path: path, content_type: file.type, size_bytes: file.size, document_request_id: item.id })
    .select('id')
    .single()
  if (doc.error) throw new Error(doc.error.message)
  const r = await db
    .from('document_requests')
    .update({ status: 'received', received_at: new Date().toISOString(), reviewed_at: null, reject_reason: null, ...(item.document_id ? {} : { document_id: (doc.data as { id: string }).id }) })
    .eq('id', item.id)
  if (r.error) throw new Error(r.error.message)
  await event(db, account, 'upload', { item: item.label }, l.id)
  return reply(200, { ok: true })
}

const FILE_ACTIONS = ['file', 'pdf', 'home_request', 'upload_url', 'uploaded']

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
    if (typeof body.action === 'string' && FILE_ACTIONS.includes(body.action)) {
      const account = await signedIn(db, request)
      if (account instanceof Response) return account
      const l = await openFile(db, account, body.loanId)
      if (l instanceof Response) return l
      if (body.action === 'file') return reply(200, await fileView(db, account, l, body.opened === true))
      if (body.action === 'pdf') return await pdf(db, account, l, body.documentId)
      if (body.action === 'home_request') return await homeRequest(db, account, l, body.request)
      return await upload(db, account, l, body)
    }
    return reply(400, { error: 'Unknown action.' })
  } catch (e) {
    return reply(500, { error: (e as Error).message })
  }
})
