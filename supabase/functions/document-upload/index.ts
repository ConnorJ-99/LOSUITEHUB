// MPS HQ: the document-upload Edge Function (UI pass Part 3). The public
// page /u/{token} talks only to this. Verify JWT is OFF: there's no sign-in;
// the long random token in the link (stored only as a hash) and a 24-hour
// viewing session (after the borrower types an email that matches a borrower
// on the file) are the keys. It uses the service role, so it checks
// everything itself:
//   open        the link's state and the loan officer's card (nothing about the loan)
//   email       matches the typed email (never says whether it's on file); 5 wrong
//               in an hour lock the link for the hour; a match starts a session
//   view        the requested items with their instructions, status and files
//   upload_url  a one-time signed upload into the file's private folder, for an
//               item on this link (PDF or photo, up to 10 MB)
//   uploaded    records the upload on the Documents tab, tagged with the item,
//               and marks the item received
// Never sends a message. Never returns anything else about the loan.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import { NOT_VERIFIED, SESSION_HOURS, canUpload, emailMatches, expiredText, fileProblem, isLocked, linkState, safeFileName, sessionValid, type UploadItem, type UploadLo } from './rules.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const TOKEN = /^[0-9a-f]{64}$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface LinkRow {
  id: string
  organization_id: string
  loan_id: string
  contact_id: string
  expires_at: string
  revoked_at: string | null
  first_opened_at: string | null
  session_hash: string | null
  session_expires_at: string | null
}

const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function loadLink(db: SupabaseClient, token: unknown): Promise<LinkRow | null> {
  if (typeof token !== 'string' || !TOKEN.test(token)) return null
  const r = await db
    .from('document_upload_links')
    .select('id, organization_id, loan_id, contact_id, expires_at, revoked_at, first_opened_at, session_hash, session_expires_at')
    .eq('token_hash', await sha256(token.toLowerCase()))
    .maybeSingle()
  if (r.error) throw new Error(r.error.message)
  return (r.data as LinkRow | null) ?? null
}

const event = (db: SupabaseClient, l: LinkRow, kind: string) => db.from('document_link_events').insert({ organization_id: l.organization_id, link_id: l.id, kind })

/** The loan officer's card: name, NMLS, phone, email, and the headshot from Pages if there is one. */
async function loCard(db: SupabaseClient, l: LinkRow): Promise<UploadLo> {
  const loan = await db.from('loans').select('assigned_lo_id').eq('id', l.loan_id).maybeSingle()
  const loId = (loan.data as { assigned_lo_id: string | null } | null)?.assigned_lo_id ?? null
  if (!loId) return { name: 'MPS Mortgage', nmls: null, phone: null, email: null, photoUrl: null }
  const [prof, link] = await Promise.all([
    db.from('profiles').select('full_name, email, nmls, phone').eq('id', loId).maybeSingle(),
    db.from('ghl_user_links').select('ghl_number, ghl_email').eq('organization_id', l.organization_id).eq('profile_id', loId).maybeSingle(),
  ])
  const p = prof.data as { full_name: string | null; email: string; nmls: string | null; phone: string | null } | null
  const g = link.data as { ghl_number: string | null; ghl_email: string | null } | null
  let photoUrl: string | null = null
  const files = await db.storage.from('page-assets').list(`${l.organization_id}/headshots`, { search: loId, limit: 5 })
  const file = (files.data ?? []).find((f) => f.name.startsWith(loId))
  if (file) photoUrl = db.storage.from('page-assets').getPublicUrl(`${l.organization_id}/headshots/${file.name}`).data.publicUrl
  return { name: p?.full_name || 'Your loan officer', nmls: p?.nmls ?? null, phone: g?.ghl_number ?? p?.phone ?? null, email: g?.ghl_email ?? p?.email ?? null, photoUrl }
}

/** The session the page presents, checked against the link. */
async function withSession(db: SupabaseClient, body: Record<string, unknown>): Promise<LinkRow | Response> {
  const l = await loadLink(db, body.token)
  if (!l) return reply(404, { error: 'This link is not available.' })
  if (linkState({ expiresAt: l.expires_at, revokedAt: l.revoked_at }, new Date()) !== 'open') return reply(410, { state: 'expired' })
  const presented = typeof body.session === 'string' && body.session.length >= 32 ? await sha256(body.session) : null
  if (!sessionValid({ sessionHash: l.session_hash, sessionExpiresAt: l.session_expires_at }, presented, new Date())) return reply(401, { state: 'ask_email' })
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

async function itemsOf(db: SupabaseClient, l: LinkRow): Promise<ItemRow[]> {
  const r = await db.from('document_requests').select('id, label, instructions, status, reject_reason, due_on, kind, document_id').eq('link_id', l.id).neq('status', 'waived').order('requested_at')
  if (r.error) throw new Error(r.error.message)
  return r.data as ItemRow[]
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' })
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const db = admin()
  try {
    if (body.action === 'open') {
      const l = await loadLink(db, body.token)
      if (!l) return reply(404, { error: 'This link is not available.' })
      const lo = await loCard(db, l)
      if (linkState({ expiresAt: l.expires_at, revokedAt: l.revoked_at }, new Date()) !== 'open') {
        await event(db, l, 'expired')
        return reply(200, { state: 'expired', lo, message: expiredText(lo.name) })
      }
      return reply(200, { state: 'ask_email', lo })
    }

    if (body.action === 'email') {
      const l = await loadLink(db, body.token)
      if (!l) return reply(404, { error: 'This link is not available.' })
      if (linkState({ expiresAt: l.expires_at, revokedAt: l.revoked_at }, new Date()) !== 'open') return reply(410, { state: 'expired' })
      const hourAgo = new Date(Date.now() - 3600_000).toISOString()
      const wrong = await db.from('document_link_events').select('id', { count: 'exact', head: true }).eq('link_id', l.id).eq('kind', 'email_wrong').gte('created_at', hourAgo)
      if (isLocked(wrong.count ?? 0)) {
        await event(db, l, 'locked')
        return reply(429, { error: 'Too many tries. Please wait an hour, or contact your loan officer.' })
      }
      const people = await db.from('loan_borrowers').select('contact:contacts ( email )').eq('loan_id', l.loan_id)
      const emails = ((people.data ?? []) as unknown as { contact: { email: string | null } | null }[]).map((p) => p.contact?.email ?? null)
      if (!emailMatches(String(body.email ?? ''), emails)) {
        await event(db, l, 'email_wrong')
        return reply(403, { error: NOT_VERIFIED })
      }
      const session = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')
      await db
        .from('document_upload_links')
        .update({ session_hash: await sha256(session), session_expires_at: new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString() })
        .eq('id', l.id)
      await event(db, l, 'email_ok')
      return reply(200, { session, hours: SESSION_HOURS })
    }

    if (body.action === 'view') {
      const l = await withSession(db, body)
      if (l instanceof Response) return l
      const items = await itemsOf(db, l)
      const docs = items.length
        ? await db.from('loan_documents').select('document_request_id, file_name, created_at').in('document_request_id', items.map((i) => i.id)).order('created_at')
        : { data: [] }
      const files = (docs.data ?? []) as { document_request_id: string; file_name: string; created_at: string }[]
      const now = new Date().toISOString()
      await db.from('document_upload_links').update({ first_opened_at: l.first_opened_at ?? now, last_opened_at: now }).eq('id', l.id)
      await event(db, l, 'opened')
      const out: UploadItem[] = items.map((i) => ({
        id: i.id,
        label: i.label,
        instructions: i.instructions,
        status: i.status,
        rejectReason: i.status === 'rejected' ? i.reject_reason : null,
        dueOn: i.due_on,
        files: files.filter((f) => f.document_request_id === i.id).map((f) => ({ name: f.file_name, uploadedAt: f.created_at })),
      }))
      return reply(200, { state: 'open', items: out, lo: await loCard(db, l) })
    }

    if (body.action === 'upload_url' || body.action === 'uploaded') {
      const l = await withSession(db, body)
      if (l instanceof Response) return l
      if (typeof body.itemId !== 'string' || !UUID.test(body.itemId)) return reply(400, { error: 'Pick one of the items on this page.' })
      const item = (await itemsOf(db, l)).find((i) => i.id === body.itemId)
      if (!item) return reply(400, { error: 'Pick one of the items on this page.' })
      if (!canUpload(item.status)) return reply(409, { error: 'This item is already done. Nothing more is needed.' })
      const file = { name: String(body.fileName ?? ''), size: Number(body.size ?? 0), type: String(body.type ?? '') }
      const problem = fileProblem(file)
      if (problem) return reply(400, { error: problem })
      const folder = `${l.organization_id}/${l.loan_id}`

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
        .insert({ organization_id: l.organization_id, loan_id: l.loan_id, contact_id: l.contact_id, kind: item.kind, file_name: file.name.slice(0, 200) || name, storage_path: path, content_type: file.type, size_bytes: file.size, document_request_id: item.id })
        .select('id')
        .single()
      if (doc.error) throw new Error(doc.error.message)
      const now = new Date().toISOString()
      const r = await db
        .from('document_requests')
        .update({ status: 'received', received_at: now, reviewed_at: null, reject_reason: null, ...(item.document_id ? {} : { document_id: (doc.data as { id: string }).id }) })
        .eq('id', item.id)
      if (r.error) throw new Error(r.error.message)
      await event(db, l, 'upload')
      return reply(200, { ok: true })
    }

    return reply(400, { error: 'Unknown action.' })
  } catch (e) {
    return reply(500, { error: (e as Error).message })
  }
})
