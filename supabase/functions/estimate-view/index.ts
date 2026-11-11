// MPS HQ: the estimate-view Edge Function (build plan Phase 7). The public
// page /e/{token} talks only to this. Verify JWT is OFF: there's no sign-in;
// the long random token in the link and a 24-hour viewing session (after the
// borrower types an email that matches a borrower on the file) are the keys.
// It uses the service role, so it checks everything itself:
//   open   the link's state and the loan officer's card (nothing about the loan)
//   email  matches the typed email (never says whether it's on file); 5 wrong
//          in an hour lock the link for the hour; a match starts a session
//   view   the frozen copy of the options, with the session
//   pdf    a one-minute link to an option's estimate PDF, with the session
//   pick   "I'm interested in this one": recorded on the share (a database
//          trigger adds a note and notifies the loan officer)
// Never sends a message. Never returns SSNs, accounts, credit or income.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import { NOT_VERIFIED, SESSION_HOURS, emailMatches, expiredText, isLocked, sessionValid, shareState, type ShareLo, type ShareSnapshot } from './rules.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const TOKEN = /^[0-9a-f]{32,128}$/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface ShareRow {
  id: string
  organization_id: string
  loan_id: string
  snapshot: ShareSnapshot
  expires_at: string
  revoked_at: string | null
  first_opened_at: string | null
  views: number
  picked_estimate_id: string | null
  session_hash: string | null
  session_expires_at: string | null
}

const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

async function loadShare(db: SupabaseClient, token: unknown): Promise<ShareRow | null> {
  if (typeof token !== 'string' || !TOKEN.test(token)) return null
  const r = await db.from('estimate_shares').select('id, organization_id, loan_id, snapshot, expires_at, revoked_at, first_opened_at, views, picked_estimate_id, session_hash, session_expires_at').eq('token', token).maybeSingle()
  if (r.error) throw new Error(r.error.message)
  return (r.data as ShareRow | null) ?? null
}

const event = (db: SupabaseClient, s: ShareRow, kind: string) => db.from('estimate_share_events').insert({ organization_id: s.organization_id, share_id: s.id, kind })

/** The loan officer's card: name, NMLS, phone, email, and the headshot from Pages if there is one. */
async function loCard(db: SupabaseClient, s: ShareRow): Promise<ShareLo> {
  const loan = await db.from('loans').select('assigned_lo_id').eq('id', s.loan_id).maybeSingle()
  const loId = (loan.data as { assigned_lo_id: string | null } | null)?.assigned_lo_id ?? null
  if (!loId) return { name: 'MPS Mortgage', nmls: null, phone: null, email: null, photoUrl: null }
  const [prof, link] = await Promise.all([
    db.from('profiles').select('full_name, email, nmls, phone').eq('id', loId).maybeSingle(),
    db.from('ghl_user_links').select('ghl_number, ghl_email').eq('organization_id', s.organization_id).eq('profile_id', loId).maybeSingle(),
  ])
  const p = prof.data as { full_name: string | null; email: string; nmls: string | null; phone: string | null } | null
  const l = link.data as { ghl_number: string | null; ghl_email: string | null } | null
  let photoUrl: string | null = null
  const files = await db.storage.from('page-assets').list(`${s.organization_id}/headshots`, { search: loId, limit: 5 })
  const file = (files.data ?? []).find((f) => f.name.startsWith(loId))
  if (file) photoUrl = db.storage.from('page-assets').getPublicUrl(`${s.organization_id}/headshots/${file.name}`).data.publicUrl
  return { name: p?.full_name || 'Your loan officer', nmls: p?.nmls ?? null, phone: l?.ghl_number ?? p?.phone ?? null, email: l?.ghl_email ?? p?.email ?? null, photoUrl }
}

/** The session the page presents, checked against the share. */
async function withSession(db: SupabaseClient, body: Record<string, unknown>): Promise<ShareRow | Response> {
  const s = await loadShare(db, body.token)
  if (!s) return reply(404, { error: 'This link is not available.' })
  if (shareState({ expiresAt: s.expires_at, revokedAt: s.revoked_at }, new Date()) !== 'open') return reply(410, { state: 'expired' })
  const presented = typeof body.session === 'string' && body.session.length >= 32 ? await sha256(body.session) : null
  if (!sessionValid({ sessionHash: s.session_hash, sessionExpiresAt: s.session_expires_at }, presented, new Date())) return reply(401, { state: 'ask_email' })
  return s
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' })
  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  const db = admin()
  try {
    if (body.action === 'open') {
      const s = await loadShare(db, body.token)
      if (!s) return reply(404, { error: 'This link is not available.' })
      const lo = await loCard(db, s)
      const state = shareState({ expiresAt: s.expires_at, revokedAt: s.revoked_at }, new Date())
      if (state !== 'open') {
        await event(db, s, 'expired')
        return reply(200, { state: 'expired', lo, message: expiredText(lo.name) })
      }
      return reply(200, { state: 'ask_email', lo })
    }

    if (body.action === 'email') {
      const s = await loadShare(db, body.token)
      if (!s) return reply(404, { error: 'This link is not available.' })
      if (shareState({ expiresAt: s.expires_at, revokedAt: s.revoked_at }, new Date()) !== 'open') return reply(410, { state: 'expired' })
      const hourAgo = new Date(Date.now() - 3600_000).toISOString()
      const wrong = await db.from('estimate_share_events').select('id', { count: 'exact', head: true }).eq('share_id', s.id).eq('kind', 'email_wrong').gte('created_at', hourAgo)
      if (isLocked(wrong.count ?? 0)) {
        await event(db, s, 'locked')
        return reply(429, { error: 'Too many tries. Please wait an hour, or contact your loan officer.' })
      }
      const people = await db.from('loan_borrowers').select('contact:contacts ( email )').eq('loan_id', s.loan_id)
      const emails = ((people.data ?? []) as unknown as { contact: { email: string | null } | null }[]).map((p) => p.contact?.email ?? null)
      if (!emailMatches(String(body.email ?? ''), emails)) {
        await event(db, s, 'email_wrong')
        return reply(403, { error: NOT_VERIFIED })
      }
      const session = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('')
      await db
        .from('estimate_shares')
        .update({ session_hash: await sha256(session), session_expires_at: new Date(Date.now() + SESSION_HOURS * 3600_000).toISOString() })
        .eq('id', s.id)
      await event(db, s, 'email_ok')
      return reply(200, { session, hours: SESSION_HOURS })
    }

    if (body.action === 'view') {
      const s = await withSession(db, body)
      if (s instanceof Response) return s
      const now = new Date().toISOString()
      await db.from('estimate_shares').update({ first_opened_at: s.first_opened_at ?? now, last_opened_at: now, views: s.views + 1 }).eq('id', s.id)
      await event(db, s, 'opened')
      return reply(200, { state: 'open', snapshot: s.snapshot, picked: s.picked_estimate_id, lo: await loCard(db, s) })
    }

    if (body.action === 'pdf') {
      const s = await withSession(db, body)
      if (s instanceof Response) return s
      const option = s.snapshot.options.find((o) => o.estimateId === body.estimateId)
      if (!option?.pdfDocumentId) return reply(404, { error: 'There is no PDF for this option.' })
      const doc = await db.from('loan_documents').select('storage_path').eq('id', option.pdfDocumentId).eq('loan_id', s.loan_id).maybeSingle()
      const path = (doc.data as { storage_path: string } | null)?.storage_path
      if (!path) return reply(404, { error: 'That PDF is no longer on file.' })
      const signed = await db.storage.from('loan-files').createSignedUrl(path, 60)
      if (signed.error || !signed.data) return reply(500, { error: 'The PDF could not be opened. Try again.' })
      await event(db, s, 'pdf')
      return reply(200, { url: signed.data.signedUrl })
    }

    if (body.action === 'pick') {
      const s = await withSession(db, body)
      if (s instanceof Response) return s
      if (typeof body.estimateId !== 'string' || !UUID.test(body.estimateId) || !s.snapshot.options.some((o) => o.estimateId === body.estimateId)) return reply(400, { error: 'Pick one of the options shown.' })
      if (s.picked_estimate_id === body.estimateId) return reply(200, { picked: body.estimateId })
      const r = await db.from('estimate_shares').update({ picked_estimate_id: body.estimateId, picked_at: new Date().toISOString() }).eq('id', s.id)
      if (r.error) throw new Error(r.error.message)
      await event(db, s, 'picked')
      return reply(200, { picked: body.estimateId })
    }

    return reply(400, { error: 'Unknown action.' })
  } catch (e) {
    return reply(500, { error: (e as Error).message })
  }
})
