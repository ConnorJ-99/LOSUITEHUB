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
// Closed view, Step A (a closed file; Connor 2026-11-20):
//   closed     the home, closed date and loan type/term, monthly payment,
//              insurance renewal, homestead, Connor's own value with its date,
//              Zillow and the county appraisal district, the documents Connor
//              published on the file, open asks, and that file's loan officer
//   closed_pdf a one-minute link to one of those documents
//   ask        "Ask Connor to check my value" (myhome_ask(): a note and his notice)
// Closed view, Step C (Connor 2026-11-24):
//   closed     also sends options: which cards show (myhome_settings) and
//              "You may be able to save about $X/mo" (refi.ts: the loan against
//              the latest Refi Watch benchmark; no rate ever leaves here)
//   ask        also refi_check and equity_check
//   start_new  "Start something new": a standalone application prefilled with
//              their name, email, phone and what they picked, assigned to the
//              file's LO (myhome_start_application()); returns the resume code
//              the /apply page keeps on the device
// My assets (nurture goals Phase 2; any file view, the accounts are the person's):
//   assets       their accounts with balance history
//   asset_save   add or change one (myhome_asset_save(): no account numbers;
//                savings goals that follow it catch up)
//   asset_remove hide one (its history stays)
//   goal_follow  which accounts a savings goal counts (Nurture files only)
// My budget (Phase 3; optional, on the person, any file view):
//   budget       settings, income and expense items, entries (13 months)
//   budget_settings / budget_item_save / budget_item_remove /
//   budget_entry_save / budget_entry_remove   (the myhome_budget_* functions)
// Preview (Connor, 2026-11-24: "allow the loan officers to view the borrower's
// view of MyHome on the MyHome tab"):
//   preview    a team login (not a MyHome one) who can see the file under RLS
//              reads what its primary borrower sees on it: inner = me (this
//              file only), file, closed, nurture, pdf or closed_pdf. Read only:
//              nothing is recorded (no opened/pdf events, no sign-in) and every
//              other action is refused.
// Never sends anything: the code and link reach the borrower only through
// Connor's GHL email ("Send MyHome code to GHL", the ghl function).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import { ASK_KINDS, ASSET_CATEGORIES, BUDGET_SCHEDULE_VALUES, START_GOALS, CODE_LENGTH, GOAL_UPDATE_KINDS, INVITE_TOKEN, LINK_GONE, LOCKED, NOT_OPEN, NOT_SIGNED_IN, NOT_YOURS, NO_MATCH, STAFF_EMAIL, TURNED_OFF, areaForCounty, cleanCode, countyName, emailLooksValid, fileLabel, isLocked, loanLine, normEmail, orderFiles, pickAccount, sameCode, viewFor, zillowUrl, type AccountMatch, type AccountStatus, type AskKind, type AssetCategory, type BudgetSchedule, type StartGoal, type MyHomeAssets, type MyHomeBudget, type GoalUpdateKind, type MyHomeClosed, type MyHomeFile, type MyHomeGoal, type MyHomeLo, type MyHomeMe, type MyHomeNurture, type MyHomeView } from './rules.ts'
import { groupByHome, homeRequestProblem, portalStep, stepMessage, type HomeRequestInput, type PortalDoc, type PortalMilestone, type PortalStage, type PortalView, type RequestStatus } from '../document-upload/portal.ts'
import { canUpload, fileProblem, safeFileName, type UploadItem } from '../document-upload/rules.ts'
import { STEPS, blankAnswers, withPurpose } from '../apply/form.ts'
import { pricingStale, refiSavings, valueNow, type RefiBenchmarkRow } from './refi.ts'

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
  /** A team member's read-only preview: nothing is recorded. */
  preview?: boolean
}

const event = async (db: SupabaseClient, a: Pick<AccountRow, 'id' | 'organization_id' | 'contact_id' | 'preview'>, kind: string, detail: Record<string, unknown> = {}, loanId: string | null = null) => {
  if (a.preview) return
  await db.from('myhome_events').insert({ organization_id: a.organization_id, account_id: a.id, contact_id: a.contact_id, loan_id: loanId, kind, detail })
}

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
  mortgage_type: string | null
  term_months: number | null
  program_name: string | null
}

/** The borrower and their files; a preview (onlyLoan) shows that one file and records nothing. */
async function me(db: SupabaseClient, account: AccountRow, fresh: boolean, onlyLoan: string | null = null): Promise<MyHomeMe> {
  const now = new Date().toISOString()
  if (account.status === 'invited' && !account.preview) await db.from('borrower_accounts').update({ status: 'active', activated_at: now }).eq('id', account.id)
  if (fresh && !account.preview) {
    await db.from('borrower_accounts').update({ last_signed_in_at: now }).eq('id', account.id)
    await event(db, account, 'signed_in')
  }

  const [person, on] = await Promise.all([
    db.from('contacts').select('first_name').eq('id', account.contact_id).single(),
    db.from('loan_borrowers').select('loan_id').eq('contact_id', account.contact_id),
  ])
  const loanIds = ((on.data ?? []) as { loan_id: string }[]).map((x) => x.loan_id).filter((id) => !onlyLoan || id === onlyLoan)
  const loans = loanIds.length
    ? ((await db.from('loans').select('id, stage, purpose, closing_date, created_at, assigned_lo_id, subject_property_id, mortgage_type, term_months, program_name').in('id', loanIds).eq('organization_id', account.organization_id)).data ?? []) as LoanRow[]
    : []
  const homeIds = loans.map((l) => l.subject_property_id).filter((x): x is string => !!x)
  const homes = homeIds.length ? (((await db.from('properties').select('id, address_line, city').in('id', homeIds)).data ?? []) as { id: string; address_line: string; city: string | null }[]) : []

  const files = orderFiles(
    loans.flatMap((l): (MyHomeFile & { lo: string | null })[] => {
      const view = viewFor(l.stage)
      if (!view) return []
      const home = homes.find((h) => h.id === l.subject_property_id) ?? null
      return [{ loanId: l.id, view, purpose: l.purpose, stage: l.stage, address: home?.address_line ?? null, city: home?.city ?? null, closingDate: l.closing_date, createdAt: l.created_at, loanLine: loanLine({ purpose: l.purpose, mortgageType: l.mortgage_type, termMonths: l.term_months, programName: l.program_name }), lo: l.assigned_lo_id }]
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

/** The file in the request, when the signed-in person is a borrower on it and it has the view asked for (open: not nurture, closed or lost). */
async function fileFor(db: SupabaseClient, account: AccountRow, loanId: unknown, want: MyHomeView): Promise<OpenFile | Response> {
  if (typeof loanId !== 'string' || !UUID.test(loanId)) return reply(404, { error: NOT_YOURS })
  const [on, loan] = await Promise.all([
    db.from('loan_borrowers').select('loan_id').eq('loan_id', loanId).eq('contact_id', account.contact_id).maybeSingle(),
    db.from('loans').select('id, organization_id, stage, purpose, assigned_lo_id').eq('id', loanId).eq('organization_id', account.organization_id).maybeSingle(),
  ])
  if (on.error) throw new Error(on.error.message)
  if (loan.error) throw new Error(loan.error.message)
  const l = loan.data as OpenFile | null
  if (!on.data || !l || !viewFor(l.stage)) return reply(404, { error: NOT_YOURS })
  if (viewFor(l.stage) !== want) return reply(409, { error: NOT_OPEN, state: 'not_open' })
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

// ---------------------------------------------------------------------------
// Closed view, Step A: the home, the loan, Connor's value, links, published documents, asks
// ---------------------------------------------------------------------------

/**
 * Step B: the FHFA index for the home's area when it closed and now, with the
 * starting value (a purchase's price, else the appraised value at closing).
 * Null outside the covered counties, with no starting value or closing date,
 * or before the index is loaded. A home that closed after the latest published
 * quarter starts from that quarter (no growth yet).
 */
async function indexFor(db: SupabaseClient, county: string | null, closedOn: string | null, purpose: string, price: number | null, appraised: number | null): Promise<MyHomeClosed['index']> {
  const area = areaForCounty(county)
  const purchase = purpose === 'purchase' && Number(price ?? 0) > 0
  const base = purchase ? Number(price) : Number(appraised ?? 0)
  if (!area || !closedOn || !(base > 0)) return null
  const r = await db.from('home_price_index').select('year, quarter, index, loaded_at').eq('series', area.series).order('year', { ascending: false }).order('quarter', { ascending: false })
  if (r.error) return null
  const rows = (r.data ?? []) as { year: number; quarter: number; index: number; loaded_at: string }[]
  const latest = rows[0]
  if (!latest) return null
  const year = Number(closedOn.slice(0, 4))
  const quarter = Math.floor((Number(closedOn.slice(5, 7)) - 1) / 3) + 1
  const at = rows.find((x) => x.year === year && x.quarter === quarter) ?? (year * 4 + quarter > latest.year * 4 + latest.quarter ? latest : null)
  if (!at) return null
  return {
    base,
    baseKind: purchase ? 'purchase' : 'appraised',
    baseIndex: Number(at.index),
    latestIndex: Number(latest.index),
    latestQuarter: `${latest.year} Q${latest.quarter}`,
    loadedOn: latest.loaded_at.slice(0, 10),
    area: area.area,
    nearest: area.nearest,
  }
}

async function closedView(db: SupabaseClient, account: AccountRow, l: OpenFile, opened: boolean): Promise<MyHomeClosed> {
  const loan = await db
    .from('loans')
    .select('closing_date, funding_date, purpose, mortgage_type, term_months, program_name, monthly_payment, subject_property_id, purchase_price, appraised_value, loan_amount, note_rate, first_payment_date')
    .eq('id', l.id)
    .single()
  if (loan.error) throw new Error(loan.error.message)
  const ln = loan.data as {
    closing_date: string | null
    funding_date: string | null
    purpose: string
    mortgage_type: string | null
    term_months: number | null
    program_name: string | null
    monthly_payment: number | null
    subject_property_id: string | null
    purchase_price: number | null
    appraised_value: number | null
    loan_amount: number | null
    note_rate: number | null
    first_payment_date: string | null
  }
  const dayAgo = new Date(Date.now() - 86_400_000).toISOString()
  const [home, docs, asks, lo, paid] = await Promise.all([
    ln.subject_property_id
      ? db.from('properties').select('address_line, city, state, zip, county, insurance_renewal_date, homestead_filed, estimated_value, estimated_value_on, annual_taxes, annual_insurance').eq('id', ln.subject_property_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    db.from('loan_documents').select('id, file_name, published_at').eq('loan_id', l.id).not('published_at', 'is', null).order('published_at', { ascending: false }),
    db.from('myhome_events').select('kind, created_at').eq('account_id', account.id).eq('loan_id', l.id).in('kind', ASK_KINDS.map((k) => `${k}_requested`)).is('handled_at', null).gte('created_at', dayAgo),
    loCard(db, l.organization_id, l.assigned_lo_id),
    db.from('myhome_extra_payments').select('id, paid_on, amount').eq('loan_id', l.id).eq('account_id', account.id).is('removed_at', null).order('paid_on'),
  ])
  if (home.error) throw new Error(home.error.message)
  const h = home.data as { address_line: string; city: string | null; state: string | null; zip: string | null; county: string | null; insurance_renewal_date: string | null; homestead_filed: boolean | null; estimated_value: number | null; estimated_value_on: string | null; annual_taxes: number | null; annual_insurance: number | null } | null
  const county = countyName(h?.county)
  const links: MyHomeClosed['links'] = []
  if (h) links.push({ label: 'Zillow', url: zillowUrl({ line: h.address_line, city: h.city, state: h.state, zip: h.zip }) })
  if (county) {
    // The county's appraisal district, from Quick Links.
    const cad = await db.from('quick_links').select('url').eq('organization_id', l.organization_id).eq('category', 'county_tax').eq('name', county).maybeSingle()
    const url = (cad.data as { url: string | null } | null)?.url
    if (url && url.startsWith('https://')) links.push({ label: `${county} CAD`, url })
  }
  const asked: MyHomeClosed['asked'] = {}
  for (const a of (asks.data ?? []) as { kind: string; created_at: string }[]) {
    const k = a.kind.replace(/_requested$/, '') as AskKind
    const prior = asked[k]
    if (!prior || prior < a.created_at) asked[k] = a.created_at
  }
  if (opened) await event(db, account, 'opened', {}, l.id)
  const closedOn = ln.closing_date ?? ln.funding_date
  const index = await indexFor(db, county, closedOn, ln.purpose, ln.purchase_price, ln.appraised_value)
  const extraPaid = ((paid.data ?? []) as { amount: number }[]).reduce((sum, x) => sum + Number(x.amount), 0)
  const options = await closedOptions(db, account, l, ln, h, index, extraPaid)
  const loanAmount = Number(ln.loan_amount ?? 0)
  const ratePct = Number(ln.note_rate ?? 0)
  return {
    home: h ? { line: h.address_line, city: h.city, state: h.state, zip: h.zip, county } : null,
    closedOn,
    index,
    balance: loanAmount > 0 && ratePct > 0 && ln.term_months ? { loanAmount, ratePct, termMonths: ln.term_months, firstPaymentDate: ln.first_payment_date, closingDate: ln.closing_date } : null,
    loanLine: loanLine({ purpose: ln.purpose, mortgageType: ln.mortgage_type, termMonths: ln.term_months, programName: ln.program_name }),
    monthlyPayment: ln.monthly_payment == null ? null : Number(ln.monthly_payment),
    annualTaxes: h?.annual_taxes == null ? null : Number(h.annual_taxes),
    annualInsurance: h?.annual_insurance == null ? null : Number(h.annual_insurance),
    insuranceRenewsOn: h?.insurance_renewal_date ?? null,
    homesteadFiled: h?.homestead_filed ?? null,
    value: h?.estimated_value != null && Number(h.estimated_value) > 0 ? { amount: Number(h.estimated_value), on: h.estimated_value_on } : null,
    links,
    extraPaid: ((paid.data ?? []) as { id: string; paid_on: string; amount: number }[]).map((x) => ({ id: x.id, paidOn: x.paid_on, amount: Number(x.amount) })),
    documents: ((docs.data ?? []) as { id: string; file_name: string; published_at: string }[]).map((d) => ({ id: d.id, name: d.file_name, publishedAt: d.published_at })),
    asked,
    options,
    lo,
  }
}

/** Step C: which cards show, and the refinance savings line (worked out here so no rate reaches the page). */
async function closedOptions(
  db: SupabaseClient,
  account: AccountRow,
  l: OpenFile,
  ln: { purpose: string; mortgage_type: string | null; term_months: number | null; loan_amount: number | null; note_rate: number | null; first_payment_date: string | null },
  h: { estimated_value: number | null; estimated_value_on: string | null } | null,
  index: MyHomeClosed['index'],
  extraPaid: number,
): Promise<MyHomeClosed['options']> {
  const st = await db.from('myhome_settings').select('refi_card, equity_card, start_new, min_monthly_savings').eq('organization_id', l.organization_id).maybeSingle()
  const set = st.data as { refi_card: boolean; equity_card: boolean; start_new: boolean; min_monthly_savings: number } | null
  const options = { refiCard: set?.refi_card ?? true, equityCard: set?.equity_card ?? true, startNew: set?.start_new ?? true, refiMonthly: null as number | null }
  if (!options.refiCard || !ln.note_rate || !ln.term_months || !ln.loan_amount) return options
  const [scenarios, prices, runs, score] = await Promise.all([
    db.from('refi_benchmark_scenarios').select('id, program, purpose, fico, ltv, active').eq('organization_id', l.organization_id),
    db.from('refi_benchmarks').select('scenario_id, rate, benchmark_date, created_at').eq('organization_id', l.organization_id).order('created_at', { ascending: false }).limit(300),
    db.from('refi_benchmark_runs').select('status, created_at').eq('organization_id', l.organization_id).order('created_at', { ascending: false }).limit(20),
    db.from('loan_borrowers').select('estimated_credit_score').eq('loan_id', l.id).eq('contact_id', account.contact_id).maybeSingle(),
  ])
  if (scenarios.error || prices.error) return options
  const latest = new Map<string, { rate: number; on: string }>()
  for (const p of (prices.data ?? []) as { scenario_id: string; rate: number; benchmark_date: string }[]) if (!latest.has(p.scenario_id)) latest.set(p.scenario_id, { rate: Number(p.rate), on: p.benchmark_date })
  const rows: RefiBenchmarkRow[] = ((scenarios.data ?? []) as { id: string; program: 'conventional' | 'fha'; purpose: 'rate_term' | 'streamline'; fico: number; ltv: number | null; active: boolean }[]).map((x) => ({
    program: x.program,
    purpose: x.purpose,
    fico: Number(x.fico),
    ltv: x.ltv == null ? null : Number(x.ltv),
    active: x.active,
    rate: latest.get(x.id)?.rate ?? null,
    pricedOn: latest.get(x.id)?.on ?? null,
  }))
  const value = valueNow(h?.estimated_value != null && Number(h.estimated_value) > 0 ? { amount: Number(h.estimated_value), on: h.estimated_value_on } : null, index)
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' })
  const stale = pricingStale(((runs.data ?? []) as { status: string; created_at: string }[]).map((r) => ({ status: r.status, createdAt: r.created_at })))
  options.refiMonthly = refiSavings(
    {
      mortgageType: ln.mortgage_type,
      purpose: ln.purpose,
      ratePct: Number(ln.note_rate),
      termMonths: ln.term_months,
      loanAmount: Number(ln.loan_amount),
      firstPaymentDate: ln.first_payment_date,
      extraPaid,
      value,
      creditScore: (score.data as { estimated_credit_score: number | null } | null)?.estimated_credit_score ?? null,
    },
    rows,
    { today, stale, minimum: Number(set?.min_monthly_savings ?? 100) },
  )
  return options
}

/** "Start something new": a prefilled standalone application for the file's LO; the page gets the resume code (only its hash is kept). */
async function startNew(db: SupabaseClient, account: AccountRow, l: OpenFile, goal: unknown): Promise<Response> {
  if (typeof goal !== 'string' || !START_GOALS.includes(goal as StartGoal)) return reply(400, { error: "Pick what you'd like to do." })
  const c = await db.from('contacts').select('first_name, last_name, email, phone').eq('id', account.contact_id).single()
  const p = c.data as { first_name: string; last_name: string | null; email: string | null; phone: string | null } | null
  const answers = blankAnswers()
  answers.borrower = { ...answers.borrower, firstName: p?.first_name ?? '', lastName: p?.last_name ?? '', email: p?.email ?? '', phone: p?.phone ?? '' }
  answers.loan = withPurpose({ ...answers.loan, goal: goal === 'purchase' ? 'purchase' : goal === 'refinance' ? 'refinance_rate_term' : 'equity' })
  const resume = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(resume))), (b) => b.toString(16).padStart(2, '0')).join('')
  const r = await db.rpc('myhome_start_application', { p_account: account.id, p_loan: l.id, p_goal: goal, p_resume_hash: hash, p_answers: answers, p_step: STEPS[0].id })
  if (r.error) return reply(400, { error: r.error.message })
  return reply(200, { resume })
}

/** A one-minute link to a document Connor published on the closed file. */
async function closedPdf(db: SupabaseClient, account: AccountRow, l: OpenFile, documentId: unknown): Promise<Response> {
  if (typeof documentId !== 'string' || !UUID.test(documentId)) return reply(400, { error: 'That document is not available.' })
  const doc = await db.from('loan_documents').select('storage_path').eq('id', documentId).eq('loan_id', l.id).not('published_at', 'is', null).maybeSingle()
  const path = (doc.data as { storage_path: string } | null)?.storage_path
  if (!path) return reply(404, { error: 'That document is not available.' })
  const signed = await db.storage.from('loan-files').createSignedUrl(path, 60)
  if (signed.error || !signed.data) return reply(500, { error: 'The document could not open. Try again.' })
  await event(db, account, 'pdf', { documentId }, l.id)
  return reply(200, { url: signed.data.signedUrl })
}

/** "Ask Connor to …": a note on the file and his notice (myhome_ask()); the same ask within a day only returns the first. */
async function ask(db: SupabaseClient, account: AccountRow, l: OpenFile, kind: unknown): Promise<Response> {
  if (typeof kind !== 'string' || !ASK_KINDS.includes(kind as AskKind)) return reply(400, { error: 'Unknown request.' })
  const r = await db.rpc('myhome_ask', { p_account: account.id, p_loan: l.id, p_kind: kind })
  if (r.error) return reply(400, { error: r.error.message })
  return reply(200, { askedAt: r.data })
}

const FILE_ACTIONS = ['file', 'pdf', 'home_request', 'upload_url', 'uploaded']
const CLOSED_ACTIONS = ['closed', 'closed_pdf', 'ask', 'extra_payment', 'remove_payment', 'start_new']
const NURTURE_ACTIONS = ['nurture', 'goal_update', 'goal_follow']
const ASSET_ACTIONS = ['assets', 'asset_save', 'asset_remove']
const BUDGET_ACTIONS = ['budget', 'budget_settings', 'budget_item_save', 'budget_item_remove', 'budget_entry_save', 'budget_entry_remove']

// ---------------------------------------------------------------------------
// Nurture goals (Phase 1, docs/plans/nurture-goals.md)
// ---------------------------------------------------------------------------

/** Their goals on the Nurture file (their own, not a co-borrower's), each with its history, and the LO card. */
async function nurtureView(db: SupabaseClient, account: AccountRow, l: OpenFile, opened: boolean): Promise<MyHomeNurture> {
  const [goals, updates, lo] = await Promise.all([
    db.from('nurture_goals').select('*').eq('loan_id', l.id).eq('contact_id', account.contact_id).order('sort_order').order('created_at'),
    db.from('nurture_goal_updates').select('goal_id, kind, amount, after_value, note, happened_on, account_id, created_at').eq('loan_id', l.id).order('created_at', { ascending: false }).limit(300),
    loCard(db, l.organization_id, l.assigned_lo_id),
  ])
  if (goals.error) throw new Error(goals.error.message)
  if (opened) await event(db, account, 'opened', {}, l.id)
  const hist = (updates.data ?? []) as { goal_id: string; kind: string; amount: number | null; after_value: number | null; note: string | null; happened_on: string; account_id: string | null }[]
  const n = (v: unknown) => (v == null ? null : Number(v))
  return {
    goals: (goals.data as Record<string, unknown>[]).map((g) => ({
      id: g.id as string,
      kind: g.kind as MyHomeGoal['kind'],
      label: g.label as string,
      debtType: (g.debt_type as string | null) ?? null,
      start: Number(g.start_value),
      target: Number(g.target_value),
      current: n(g.current_value),
      currentAt: (g.current_at as string | null) ?? null,
      verified: n(g.verified_value),
      targetDate: (g.target_date as string | null) ?? null,
      status: g.status as MyHomeGoal['status'],
      paused: g.paused as boolean,
      followsAssets: (g.follows_assets as string[] | null) ?? [],
      history: hist
        .filter((h) => h.goal_id === g.id && h.kind !== 'created')
        .map((h) => ({ kind: h.kind, amount: n(h.amount), after: n(h.after_value), note: h.note, on: h.happened_on, byBorrower: h.account_id != null })),
    })),
    lo,
  }
}

/** A borrower's goal update (myhome_goal_update(): the check, the history, the Updates card, a note, a notice only for big ones). */
async function goalUpdate(db: SupabaseClient, account: AccountRow, l: OpenFile, body: Record<string, unknown>): Promise<Response> {
  const kind = typeof body.kind === 'string' && GOAL_UPDATE_KINDS.includes(body.kind as GoalUpdateKind) ? body.kind : null
  if (typeof body.goalId !== 'string' || !UUID.test(body.goalId) || !kind) return reply(400, { error: 'Pick one of your goals.' })
  const amount = typeof body.amount === 'number' && Number.isFinite(body.amount) ? Math.round(body.amount * 100) / 100 : null
  const on = typeof body.on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.on) ? body.on : null
  const note = typeof body.note === 'string' ? body.note.slice(0, 500) : null
  // The goal must be on this file (the database checks it's this person's).
  const g = await db.from('nurture_goals').select('id').eq('id', body.goalId).eq('loan_id', l.id).maybeSingle()
  if (!g.data) return reply(404, { error: 'Pick one of your goals.' })
  const r = await db.rpc('myhome_goal_update', { p_account: account.id, p_goal: body.goalId, p_kind: kind, p_amount: amount, p_on: on, p_note: note })
  if (r.error) return reply(400, { error: r.error.message })
  return reply(200, { value: r.data })
}

// ---------------------------------------------------------------------------
// My assets (Phase 2): on the person, so every file view shows the same ones
// ---------------------------------------------------------------------------

async function assetsView(db: SupabaseClient, account: AccountRow): Promise<MyHomeAssets> {
  const [rows, hist] = await Promise.all([
    db.from('borrower_assets').select('id, nickname, institution, category, balance, balance_on, notes').eq('contact_id', account.contact_id).is('archived_at', null).order('sort_order').order('created_at'),
    db.from('borrower_asset_balances').select('asset_id, balance, balance_on').eq('contact_id', account.contact_id).order('balance_on', { ascending: false }).order('created_at', { ascending: false }).limit(500),
  ])
  if (rows.error) throw new Error(rows.error.message)
  const h = (hist.data ?? []) as { asset_id: string; balance: number; balance_on: string }[]
  return {
    assets: (rows.data as { id: string; nickname: string; institution: string | null; category: AssetCategory; balance: number; balance_on: string; notes: string | null }[]).map((a) => ({
      id: a.id,
      nickname: a.nickname,
      institution: a.institution,
      category: a.category,
      balance: Number(a.balance),
      balanceOn: a.balance_on,
      notes: a.notes,
      // The first history row is the current balance.
      history: h.filter((x) => x.asset_id === a.id).slice(1, 13).map((x) => ({ balance: Number(x.balance), on: x.balance_on })),
    })),
  }
}

async function assetSave(db: SupabaseClient, account: AccountRow, body: Record<string, unknown>): Promise<Response> {
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : null)
  const category = typeof body.category === 'string' && ASSET_CATEGORIES.some((c) => c.value === body.category) ? body.category : null
  const balance = typeof body.balance === 'number' && Number.isFinite(body.balance) ? Math.round(body.balance * 100) / 100 : null
  if (!category || balance == null) return reply(400, { error: 'Enter the account name, kind and balance.' })
  const assetId = typeof body.assetId === 'string' && UUID.test(body.assetId) ? body.assetId : null
  const on = typeof body.balanceOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.balanceOn) ? body.balanceOn : null
  const r = await db.rpc('myhome_asset_save', {
    p_account: account.id,
    p_asset: assetId,
    p_nickname: str(body.nickname, 200) ?? '',
    p_institution: str(body.institution, 200),
    p_category: category,
    p_balance: balance,
    p_on: on,
    p_notes: str(body.notes, 600),
  })
  if (r.error) return reply(400, { error: r.error.message })
  return reply(200, { id: r.data })
}

async function assetRemove(db: SupabaseClient, account: AccountRow, assetId: unknown): Promise<Response> {
  if (typeof assetId !== 'string' || !UUID.test(assetId)) return reply(400, { error: "That account isn't in your MyHome." })
  const r = await db.rpc('myhome_asset_remove', { p_account: account.id, p_asset: assetId })
  if (r.error) return reply(400, { error: r.error.message })
  return reply(200, { ok: true })
}

/** Which accounts a savings goal counts (myhome_goal_follow()). */
async function goalFollow(db: SupabaseClient, account: AccountRow, l: OpenFile, body: Record<string, unknown>): Promise<Response> {
  const ids = Array.isArray(body.assetIds) ? body.assetIds.filter((x): x is string => typeof x === 'string' && UUID.test(x)).slice(0, 25) : null
  if (typeof body.goalId !== 'string' || !UUID.test(body.goalId) || !ids) return reply(400, { error: 'Pick one of your goals.' })
  const g = await db.from('nurture_goals').select('id').eq('id', body.goalId).eq('loan_id', l.id).maybeSingle()
  if (!g.data) return reply(404, { error: 'Pick one of your goals.' })
  const r = await db.rpc('myhome_goal_follow', { p_account: account.id, p_goal: body.goalId, p_assets: ids })
  if (r.error) return reply(400, { error: r.error.message })
  return reply(200, { ok: true })
}

// ---------------------------------------------------------------------------
// My budget (Phase 3)
// ---------------------------------------------------------------------------

async function budgetView(db: SupabaseClient, account: AccountRow): Promise<MyHomeBudget> {
  const since = new Date(Date.now() - 400 * 86_400_000).toISOString().slice(0, 10)
  const [settings, items, entries] = await Promise.all([
    db.from('budget_settings').select('starting_cash, starting_on, monthly_savings').eq('contact_id', account.contact_id).maybeSingle(),
    db.from('budget_items').select('id, kind, name, amount, schedule, every_days, next_on, category, notes, paused').eq('contact_id', account.contact_id).is('archived_at', null).order('kind').order('sort_order'),
    db.from('budget_entries').select('id, item_id, kind, name, amount, happened_on, planned_on').eq('contact_id', account.contact_id).is('removed_at', null).gte('happened_on', since).order('happened_on', { ascending: false }).limit(1000),
  ])
  if (items.error) throw new Error(items.error.message)
  const st = settings.data as { starting_cash: number | null; starting_on: string | null; monthly_savings: number | null } | null
  const n = (v: unknown) => (v == null ? null : Number(v))
  return {
    startingCash: n(st?.starting_cash),
    startingOn: st?.starting_on ?? null,
    monthlySavings: n(st?.monthly_savings),
    items: (items.data as Record<string, unknown>[]).map((i) => ({
      id: i.id as string,
      kind: i.kind as 'income' | 'expense',
      name: i.name as string,
      amount: Number(i.amount),
      schedule: i.schedule as BudgetSchedule,
      everyDays: n(i.every_days),
      nextOn: (i.next_on as string | null) ?? null,
      category: (i.category as string | null) ?? null,
      notes: (i.notes as string | null) ?? null,
      paused: i.paused as boolean,
    })),
    entries: ((entries.data ?? []) as Record<string, unknown>[]).map((e) => ({
      id: e.id as string,
      itemId: (e.item_id as string | null) ?? null,
      kind: e.kind as 'income' | 'expense',
      name: e.name as string,
      amount: Number(e.amount),
      on: e.happened_on as string,
      plannedOn: (e.planned_on as string | null) ?? null,
    })),
  }
}

/** The budget's saves: each checked again by its myhome_budget_* function. */
async function budgetSave(db: SupabaseClient, account: AccountRow, body: Record<string, unknown>): Promise<Response> {
  const money = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.round(v * 100) / 100 : null)
  const date = (v: unknown) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
  const id = (v: unknown) => (typeof v === 'string' && UUID.test(v) ? v : null)
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : null)
  const kind = body.kind === 'income' || body.kind === 'expense' ? body.kind : null
  let r
  if (body.action === 'budget_settings') {
    r = await db.rpc('myhome_budget_settings_save', { p_account: account.id, p_starting_cash: money(body.startingCash), p_starting_on: date(body.startingOn), p_monthly_savings: money(body.monthlySavings) })
  } else if (body.action === 'budget_item_save') {
    const schedule = typeof body.schedule === 'string' && BUDGET_SCHEDULE_VALUES.includes(body.schedule as BudgetSchedule) ? body.schedule : null
    if (!kind || !schedule) return reply(400, { error: 'Pick income or expense and how often it comes.' })
    const every = typeof body.everyDays === 'number' && Number.isInteger(body.everyDays) ? body.everyDays : null
    r = await db.rpc('myhome_budget_item_save', {
      p_account: account.id,
      p_item: id(body.itemId),
      p_kind: kind,
      p_name: str(body.name, 200) ?? '',
      p_amount: money(body.amount),
      p_schedule: schedule,
      p_every_days: every,
      p_next_on: date(body.nextOn),
      p_category: str(body.category, 40),
      p_notes: str(body.notes, 600),
      p_paused: body.paused === true,
    })
  } else if (body.action === 'budget_item_remove') {
    r = await db.rpc('myhome_budget_item_remove', { p_account: account.id, p_item: id(body.itemId) })
  } else if (body.action === 'budget_entry_save') {
    r = await db.rpc('myhome_budget_entry_save', { p_account: account.id, p_item: id(body.itemId), p_planned_on: date(body.plannedOn), p_kind: kind ?? 'expense', p_name: str(body.name, 200), p_amount: money(body.amount), p_on: date(body.on) })
  } else {
    r = await db.rpc('myhome_budget_entry_remove', { p_account: account.id, p_entry: id(body.entryId) })
  }
  if (r.error) return reply(400, { error: r.error.message })
  return reply(200, { id: r.data ?? null })
}

/** "I made an extra payment": logged with its date and amount (myhome_record_payment(): checks and a note on the file). */
async function extraPayment(db: SupabaseClient, account: AccountRow, l: OpenFile, body: Record<string, unknown>): Promise<Response> {
  const paidOn = typeof body.paidOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.paidOn) ? body.paidOn : null
  const amount = typeof body.amount === 'number' && Number.isFinite(body.amount) ? Math.round(body.amount * 100) / 100 : null
  if (!paidOn || !amount) return reply(400, { error: 'Enter the date and the amount you paid.' })
  const r = await db.rpc('myhome_record_payment', { p_account: account.id, p_loan: l.id, p_paid_on: paidOn, p_amount: amount })
  if (r.error) return reply(400, { error: r.error.message })
  return reply(200, { id: r.data })
}

async function removePayment(db: SupabaseClient, account: AccountRow, paymentId: unknown): Promise<Response> {
  if (typeof paymentId !== 'string' || !UUID.test(paymentId)) return reply(400, { error: "That payment isn't in your MyHome." })
  const r = await db.rpc('myhome_remove_payment', { p_account: account.id, p_payment: paymentId })
  if (r.error) return reply(400, { error: r.error.message })
  return reply(200, { ok: true })
}

// ---------------------------------------------------------------------------
// Preview: a team member sees the file the way its primary borrower does
// ---------------------------------------------------------------------------

const PREVIEW_READS: Record<string, MyHomeView | 'me' | 'assets' | 'budget'> = { me: 'me', assets: 'assets', budget: 'budget', file: 'active', pdf: 'active', closed: 'closed', closed_pdf: 'closed', nurture: 'nurture' }
const PREVIEW_ONLY = "This is a preview. The borrower can do this in their own MyHome; nothing changes from here."
const NOBODY = '00000000-0000-0000-0000-000000000000'

async function preview(db: SupabaseClient, request: Request, body: Record<string, unknown>): Promise<Response> {
  const jwt = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  const u = jwt ? await db.auth.getUser(jwt) : null
  const user = u?.data.user
  if (!user) return reply(401, { error: 'Sign in to MPS-HQ to preview MyHome.' })
  if (user.app_metadata?.myhome === true) return reply(403, { error: 'Only the MPS-HQ team can preview MyHome.' })
  const loanId = body.loanId
  if (typeof loanId !== 'string' || !UUID.test(loanId)) return reply(404, { error: "You can't see this file." })
  // The file rule decides, as the signed-in team member (RLS), never the service role.
  const staff = createClient(URL_, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${jwt}` } }, auth: { persistSession: false } })
  const seen = await staff.from('loans').select('id').eq('id', loanId).maybeSingle()
  if (!seen.data) return reply(404, { error: "You can't see this file." })
  const want = typeof body.inner === 'string' ? PREVIEW_READS[body.inner] : undefined
  if (!want) return reply(403, { error: PREVIEW_ONLY })

  const prim = await db.from('loan_borrowers').select('contact_id, organization_id').eq('loan_id', loanId).eq('role', 'primary').maybeSingle()
  const p = prim.data as { contact_id: string; organization_id: string } | null
  if (!p) return reply(404, { error: 'This file has no primary borrower yet.' })
  const acct = await db.from('borrower_accounts').select('id, status').eq('contact_id', p.contact_id).maybeSingle()
  const a = acct.data as { id: string; status: AccountStatus } | null
  const account: AccountRow = { id: a?.id ?? NOBODY, organization_id: p.organization_id, contact_id: p.contact_id, user_id: null, status: a?.status ?? 'invited', preview: true }

  if (want === 'me') return reply(200, await me(db, account, false, loanId))
  if (want === 'assets') return reply(200, await assetsView(db, account))
  if (want === 'budget') return reply(200, await budgetView(db, account))
  const l = await fileFor(db, account, loanId, want)
  if (l instanceof Response) return l
  if (body.inner === 'file') return reply(200, await fileView(db, account, l, false))
  if (body.inner === 'pdf') return await pdf(db, account, l, body.documentId)
  if (body.inner === 'closed') return reply(200, await closedView(db, account, l, false))
  if (body.inner === 'closed_pdf') return await closedPdf(db, account, l, body.documentId)
  return reply(200, await nurtureView(db, account, l, false))
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' })
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const db = admin()
  try {
    if (body.action === 'sign_in') return await signIn(db, body)
    if (body.action === 'preview') return await preview(db, request, body)
    if (body.action === 'me') {
      const account = await signedIn(db, request)
      if (account instanceof Response) return account
      return reply(200, await me(db, account, body.fresh === true))
    }
    if (typeof body.action === 'string' && FILE_ACTIONS.includes(body.action)) {
      const account = await signedIn(db, request)
      if (account instanceof Response) return account
      const l = await fileFor(db, account, body.loanId, 'active')
      if (l instanceof Response) return l
      if (body.action === 'file') return reply(200, await fileView(db, account, l, body.opened === true))
      if (body.action === 'pdf') return await pdf(db, account, l, body.documentId)
      if (body.action === 'home_request') return await homeRequest(db, account, l, body.request)
      return await upload(db, account, l, body)
    }
    if (typeof body.action === 'string' && CLOSED_ACTIONS.includes(body.action)) {
      const account = await signedIn(db, request)
      if (account instanceof Response) return account
      const l = await fileFor(db, account, body.loanId, 'closed')
      if (l instanceof Response) return l
      if (body.action === 'closed') return reply(200, await closedView(db, account, l, body.opened === true))
      if (body.action === 'closed_pdf') return await closedPdf(db, account, l, body.documentId)
      if (body.action === 'extra_payment') return await extraPayment(db, account, l, body)
      if (body.action === 'remove_payment') return await removePayment(db, account, body.paymentId)
      if (body.action === 'start_new') return await startNew(db, account, l, body.goal)
      return await ask(db, account, l, body.kind)
    }
    if (typeof body.action === 'string' && NURTURE_ACTIONS.includes(body.action)) {
      const account = await signedIn(db, request)
      if (account instanceof Response) return account
      const l = await fileFor(db, account, body.loanId, 'nurture')
      if (l instanceof Response) return l
      if (body.action === 'nurture') return reply(200, await nurtureView(db, account, l, body.opened === true))
      if (body.action === 'goal_follow') return await goalFollow(db, account, l, body)
      return await goalUpdate(db, account, l, body)
    }
    if (typeof body.action === 'string' && ASSET_ACTIONS.includes(body.action)) {
      const account = await signedIn(db, request)
      if (account instanceof Response) return account
      if (body.action === 'assets') return reply(200, await assetsView(db, account))
      if (body.action === 'asset_save') return await assetSave(db, account, body)
      return await assetRemove(db, account, body.assetId)
    }
    if (typeof body.action === 'string' && BUDGET_ACTIONS.includes(body.action)) {
      const account = await signedIn(db, request)
      if (account instanceof Response) return account
      if (body.action === 'budget') return reply(200, await budgetView(db, account))
      return await budgetSave(db, account, body)
    }
    return reply(400, { error: 'Unknown action.' })
  } catch (e) {
    return reply(500, { error: (e as Error).message })
  }
})
