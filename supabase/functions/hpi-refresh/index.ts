// MPS HQ: the hpi-refresh Edge Function (MyHome closed view Step B,
// docs/plans/myhome.md section 5). Loads the FHFA House Price Index for the
// two DFW areas (Dallas 19124, Fort Worth 23104; all-transactions, quarterly)
// into home_price_index, which MyHome's home value estimate reads.
// - Who: the weekly timer (scheduled_hpi_refresh(), ?key= the webhook secret)
//   or an owner or admin pressing "Refresh now" in Settings (their login).
// - Where from: FHFA's master file (about 17 MB, read line by line, keeping
//   only our two places), else FRED's copies of the same series.
// - Every run is logged in home_price_index_runs. Verify JWT is ON (the timer
//   sends the anon key, like the other timers).
// Never sends anything, and reads nothing about borrowers.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import { FHFA_URL, SERIES_IDS, complete, fhfaRow, fredRows, fredUrl, latestLabel, mightMatter, type IndexRow } from './hpi.ts'
import { secretMatches } from '../ghl-inbound/sync.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const AGENT = { 'User-Agent': 'MPS-HQ home value index' }

/** FHFA's master file, read as it downloads, keeping only our two places' rows. */
async function fromFhfa(): Promise<IndexRow[]> {
  const res = await fetch(FHFA_URL, { headers: AGENT })
  if (!res.ok || !res.body) throw new Error(`FHFA answered ${res.status}.`)
  const rows: IndexRow[] = []
  let rest = ''
  for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
    const lines = (rest + chunk).split('\n')
    rest = lines.pop() ?? ''
    for (const line of lines) {
      if (!mightMatter(line)) continue
      const r = fhfaRow(line)
      if (r) rows.push(r)
    }
  }
  if (rest && mightMatter(rest)) {
    const r = fhfaRow(rest)
    if (r) rows.push(r)
  }
  return rows
}

async function fromFred(): Promise<IndexRow[]> {
  const out: IndexRow[] = []
  for (const s of SERIES_IDS) {
    const res = await fetch(fredUrl(s), { headers: AGENT })
    if (!res.ok) throw new Error(`FRED answered ${res.status}.`)
    out.push(...fredRows(await res.text(), s))
  }
  return out
}

/** Who is asking: the timer's key, or an owner or admin's login. */
async function allowed(db: SupabaseClient, request: Request): Promise<boolean> {
  if (secretMatches(new URL(request.url).searchParams.get('key'), Deno.env.get('GHL_WEBHOOK_SECRET'))) return true
  const jwt = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!jwt) return false
  const u = await db.auth.getUser(jwt)
  if (u.error || !u.data.user) return false
  const m = await db.from('organization_members').select('role').eq('user_id', u.data.user.id).in('role', ['owner', 'admin']).limit(1)
  return (m.data ?? []).length > 0
}

async function refresh(db: SupabaseClient) {
  let source: 'fhfa' | 'fred' = 'fhfa'
  let rows: IndexRow[] = []
  let fhfaProblem: string | null = null
  try {
    rows = await fromFhfa()
    if (!complete(rows)) throw new Error('FHFA\'s file was missing one of the DFW areas.')
  } catch (e) {
    fhfaProblem = (e as Error).message
    source = 'fred'
    rows = await fromFred()
    if (!complete(rows)) throw new Error(`FHFA: ${fhfaProblem} FRED was missing one of the DFW areas too.`)
  }

  // New quarters = ones not loaded before (revised numbers for old quarters are updated too).
  const before = await db.from('home_price_index').select('series, year, quarter')
  if (before.error) throw new Error(before.error.message)
  const had = new Set(((before.data ?? []) as { series: string; year: number; quarter: number }[]).map((r) => `${r.series}:${r.year}:${r.quarter}`))
  const fresh = rows.filter((r) => !had.has(`${r.series}:${r.year}:${r.quarter}`)).length
  const now = new Date().toISOString()
  for (let i = 0; i < rows.length; i += 500) {
    const up = await db.from('home_price_index').upsert(rows.slice(i, i + 500).map((r) => ({ ...r, source, loaded_at: now })), { onConflict: 'series,year,quarter' })
    if (up.error) throw new Error(up.error.message)
  }
  const latest = latestLabel(rows)
  await db.from('home_price_index_runs').insert({ source, quarters: fresh, latest, problem: fhfaProblem ? `FHFA didn't work (${fhfaProblem}); used FRED.` : null })
  return { source, newQuarters: fresh, latest }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  try {
    if (!(await allowed(db, request))) return reply(403, { error: 'Only an owner or admin can refresh the home value index.' })
    return reply(200, await refresh(db))
  } catch (e) {
    const problem = (e as Error).message
    await db.from('home_price_index_runs').insert({ problem })
    return reply(500, { error: problem })
  }
})
