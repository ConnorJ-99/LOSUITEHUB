// MPS-HQ Pages (Connor, 2026-11-06; docs/plans/pages.md): the public end of
// /p/{slug}. Deploy with "Verify JWT" turned OFF: visitors aren't signed in.
// Its own checks instead: the page must be published, a hidden honeypot
// field must be empty, and one IP may send 5 submissions in 10 minutes (the
// database counts by a one-way code of the IP; the IP itself is never kept).
//
//   POST { action: "upload", slug, submissionId, blockId, fileName, size, type }
//     → a one-time upload link into the private page-uploads bucket.
//   POST { action: "submit", slug, submissionId, answers, files, consent, source, website, t }
//     (t: a personal link's code; the answers go to that person and file, no matching)
//     → checks every answer (blocks.ts, the same rules the page shows), then
//       record_page_submission() runs the website's intake_web_lead(): match
//       by email or phone, new lead for the page owner or a note + task on the
//       open file, mapped answers as proposed updates, the owner notified.
//       Then, after answering the visitor: the person's GHL contact through
//       the ghl function's existing matching (test mode respected), and a
//       follow-up text and email drafted into the Action Queue. Nothing sends.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0'
import { MAX_FILE_BYTES, MAX_FILES_PER_FIELD, UPLOAD_TYPES, readSubmission, type Block, type PageSettings, type UploadedFile } from './blocks.ts'
import { PAGE_DRAFT_MODEL, PAGE_DRAFT_SCHEMA, PAGE_DRAFT_SYSTEM, buildPageDraftPrompt, pageDraftKey, readPageDraft, templateDrafts } from './pageDraft.ts'
import { complianceIssues, finalBody, type Signer } from '../assistant/followUp.ts'

const MAX_BODY_BYTES = 200_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

interface PageRow {
  id: string
  organization_id: string
  owner_id: string | null
  title: string
  blocks: Block[]
  settings: PageSettings
}

const admin = () => createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

async function loadPage(db: SupabaseClient, slug: unknown): Promise<PageRow | null> {
  if (typeof slug !== 'string' || !slug.trim()) return null
  const r = await db.from('pages').select('id, organization_id, owner_id, title, blocks, settings').eq('slug', slug.trim().toLowerCase()).eq('status', 'published').maybeSingle()
  if (r.error) throw new Error(r.error.message)
  return (r.data as PageRow | null) ?? null
}

/** A one-way code of the visitor's IP: enough to count, never reversible to the address. */
async function ipHash(request: Request): Promise<string | null> {
  const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || request.headers.get('x-real-ip') || ''
  if (!ip) return null
  const salt = Deno.env.get('PAGE_IP_SALT') ?? Deno.env.get('SUPABASE_URL') ?? 'mps-hq'
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${ip}`))
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

const safeName = (name: string) => name.replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '-').slice(-80) || 'file'

async function upload(db: SupabaseClient, body: Record<string, unknown>) {
  const page = await loadPage(db, body.slug)
  if (!page) return reply(404, { error: 'This page is not available.' })
  const sid = String(body.submissionId ?? '')
  const block = page.blocks.find((b) => b.id === body.blockId)
  if (!UUID.test(sid) || !block || block.type !== 'file') return reply(400, { error: 'That upload is not part of this form.' })
  const size = Number(body.size)
  const type = String(body.type ?? '')
  if (!(size > 0 && size <= MAX_FILE_BYTES)) return reply(400, { error: 'Files can be up to 10 MB.' })
  if (!UPLOAD_TYPES.includes(type)) return reply(400, { error: 'Upload a PDF or a photo (JPG, PNG, HEIC).' })
  const prefix = `${page.organization_id}/${page.id}/${sid}`
  const existing = await db.storage.from('page-uploads').list(prefix, { limit: 100 })
  if ((existing.data?.length ?? 0) >= MAX_FILES_PER_FIELD * 4) return reply(400, { error: 'That is the most files this form takes.' })
  // A submission that's already in can't get more files.
  const done = await db.from('page_submissions').select('id').eq('id', sid).maybeSingle()
  if (done.data) return reply(400, { error: 'This form was already sent.' })
  const path = `${prefix}/${crypto.randomUUID().slice(0, 8)}-${safeName(String(body.fileName ?? 'file'))}`
  const signed = await db.storage.from('page-uploads').createSignedUploadUrl(path)
  if (signed.error) return reply(500, { error: 'The upload could not start. Try again.' })
  return reply(200, { path, token: signed.data.token, signedUrl: signed.data.signedUrl })
}

async function submit(request: Request, db: SupabaseClient, body: Record<string, unknown>) {
  const page = await loadPage(db, body.slug)
  if (!page) return reply(404, { error: 'This page is not available.' })
  const success = { ok: true, successTitle: page.settings.successTitle ?? null, successMessage: page.settings.successMessage ?? null, redirectUrl: page.settings.redirectUrl ?? null }

  // The honeypot: a field people never see. Bots fill it; we pretend it worked.
  if (typeof body.website === 'string' && body.website.trim()) return reply(200, success)

  const sid = String(body.submissionId ?? '')
  if (!UUID.test(sid)) return reply(400, { error: 'Reload the page and try again.' })

  // Files: only ones uploaded for this submission, and only if they are really there.
  const prefix = `${page.organization_id}/${page.id}/${sid}/`
  const sent = (typeof body.files === 'object' && body.files ? body.files : {}) as Record<string, UploadedFile[]>
  const listed = await db.storage.from('page-uploads').list(prefix.slice(0, -1), { limit: 100 })
  const present = new Set((listed.data ?? []).map((o) => `${prefix}${o.name}`))
  const files: Record<string, UploadedFile[]> = {}
  for (const [blockId, list] of Object.entries(sent)) {
    if (!Array.isArray(list)) continue
    files[blockId] = list
      .filter((f) => f && typeof f.path === 'string' && f.path.startsWith(prefix) && present.has(f.path))
      .map((f) => ({ path: f.path, name: String(f.name ?? '').slice(0, 120), size: Number(f.size) || 0, type: String(f.type ?? '') }))
  }

  const answers = (typeof body.answers === 'object' && body.answers ? body.answers : {}) as Record<string, unknown>
  const consent = page.settings.consent !== false && body.consent === true
  // A personal link (?t=): the database checks it and ties the answers to that person.
  const linkToken = typeof body.t === 'string' && /^[0-9a-f]{64}$/.test(body.t) ? body.t : null
  const read = readSubmission(page.blocks, answers, files, consent, { linked: !!linkToken })
  if (Object.keys(read.errors).length) return reply(400, { error: 'Please check the highlighted answers.', errors: read.errors })

  const src = (typeof body.source === 'object' && body.source ? body.source : {}) as Record<string, unknown>
  const source: Record<string, string> = {}
  for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'referrer']) {
    if (typeof src[k] === 'string' && src[k]) source[k] = (src[k] as string).slice(0, 300)
  }

  const recorded = await db.rpc('record_page_submission', {
    p_page_id: page.id,
    p_sub: { id: sid, data: read.data, files: read.files, mapped: read.mapped, answers: read.answers, source, ip_hash: await ipHash(request), link_token: linkToken },
  })
  if (recorded.error) {
    const m = recorded.error.message
    if (m.includes('rate_limited')) return reply(429, { error: 'Thanks! We already have a few submissions from you. Please try again in a few minutes.' })
    if (m.includes('page_not_found')) return reply(404, { error: 'This page is not available.' })
    if (m.includes('link_invalid')) return reply(400, { error: 'This personal link has expired or was switched off. Ask your loan officer for a new one.' })
    if (/email or phone/.test(m)) return reply(400, { error: 'Please add your email or phone so we can reach you.' })
    console.error('record_page_submission failed:', m)
    return reply(500, { error: 'Your answers could not be saved. Please try again.' })
  }
  const r = recorded.data as { outcome: string; contact_id: string | null; loan_id: string | null; organization_id: string; owner_id: string | null }
  if (r.outcome !== 'already_received') {
    const after = followThrough(db, page, sid, r, read.answers, read.mapped).catch((e) => console.error('Page follow-through failed:', (e as Error).message))
    // Answer the visitor now; finish GHL and the drafts in the background.
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } }).EdgeRuntime
    if (runtime) runtime.waitUntil(after)
    else await after
  }
  return reply(200, success)
}

/** GHL contact and the drafted follow-up. A problem here never loses the submission. */
async function followThrough(db: SupabaseClient, page: PageRow, sid: string, r: { outcome: string; contact_id: string | null; loan_id: string | null; organization_id: string }, answers: Record<string, string>, mapped: Record<string, string>) {
  if (!r.contact_id || !r.loan_id) return
  const [ghl, drafts] = await Promise.allSettled([linkGhl(r.organization_id, r.contact_id, r.loan_id), draftFollowUp(db, page, sid, r, answers, mapped)])
  const ghlResult = ghl.status === 'fulfilled' ? ghl.value : `error: ${(ghl.reason as Error).message}`
  await db.from('page_submissions').update({ ghl_result: ghlResult.slice(0, 500) }).eq('id', sid)
  if (drafts.status === 'rejected') console.error('Page drafts failed:', (drafts.reason as Error).message)
}

/** The ghl function's own contact matching (server to server, with the timer key). */
async function linkGhl(organizationId: string, contactId: string, loanId: string): Promise<string> {
  const key = Deno.env.get('GHL_WEBHOOK_SECRET')
  if (!key) return 'skipped: GHL_WEBHOOK_SECRET is not set for page-submit'
  const res = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/ghl?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('SUPABASE_ANON_KEY') ?? ''}` },
    body: JSON.stringify({ task: 'page_contact', organizationId, contactId, loanId }),
    signal: AbortSignal.timeout(20_000),
  })
  const out = (await res.json().catch(() => ({}))) as { linked?: boolean; created?: boolean; skipped?: string; error?: string }
  if (!res.ok) return `error: ${out.error ?? res.status}`
  if (out.skipped) return `skipped: ${out.skipped}`
  return out.created ? 'created' : 'linked'
}

async function draftFollowUp(db: SupabaseClient, page: PageRow, sid: string, r: { outcome: string; contact_id: string | null; loan_id: string | null; organization_id: string }, answers: Record<string, string>, mapped: Record<string, string>) {
  const [person, loan, org] = await Promise.all([
    db.from('contacts').select('first_name, email, phone, sms_opted_out_at, email_opted_out_at').eq('id', r.contact_id!).single(),
    db.from('loans').select('assigned_lo_id').eq('id', r.loan_id!).single(),
    db.from('organizations').select('name, nmls').eq('id', r.organization_id).single(),
  ])
  const p = person.data as { first_name: string | null; email: string | null; phone: string | null; sms_opted_out_at: string | null; email_opted_out_at: string | null } | null
  if (!p) return
  const lo = (loan.data as { assigned_lo_id: string | null } | null)?.assigned_lo_id ?? null
  const profile = lo ? await db.from('profiles').select('full_name, nmls, phone').eq('id', lo).maybeSingle() : { data: null }
  const pr = profile.data as { full_name: string | null; nmls: string | null; phone: string | null } | null
  const o = org.data as { name: string; nmls: string | null } | null
  const signer: Signer = { loName: pr?.full_name ?? null, loNmls: pr?.nmls ?? null, loPhone: pr?.phone ?? null, companyName: o?.name ?? 'MPS Mortgage LLC', companyNmls: o?.nmls ?? '2501110' }
  const facts = { firstName: p.first_name ?? mapped.first_name ?? '', pageTitle: page.title, outcome: r.outcome, answers, loName: pr?.full_name ?? null }

  let words = templateDrafts(facts, signer.companyName)
  let confidence: 'high' | 'medium' | 'low' | null = null
  let aiRunId: string | null = null
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (apiKey) {
    const run = await db.from('ai_runs').insert({ organization_id: r.organization_id, loan_id: r.loan_id, task_type: 'page_follow_up', input_ref: { pageId: page.id, submissionId: sid }, model: PAGE_DRAFT_MODEL, created_by: null }).select('id').single()
    aiRunId = (run.data as { id: string } | null)?.id ?? null
    try {
      const res = await new Anthropic({ apiKey }).beta.messages.create({
        model: PAGE_DRAFT_MODEL,
        max_tokens: 2000,
        system: PAGE_DRAFT_SYSTEM,
        messages: [{ role: 'user', content: buildPageDraftPrompt(facts) }],
        output_config: { effort: 'low', format: { type: 'json_schema', schema: PAGE_DRAFT_SCHEMA } },
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      } as never)
      const out = res as unknown as { stop_reason: string; model: string; usage: { input_tokens: number; output_tokens: number }; content: { type: string; text?: string }[] }
      let parsed: unknown = null
      try {
        parsed = JSON.parse(out.content.flatMap((b) => (b.type === 'text' && b.text ? [b.text] : [])).join(''))
      } catch {
        // Unreadable: the template is used.
      }
      const ai = out.stop_reason === 'end_turn' ? readPageDraft(parsed) : { error: out.stop_reason }
      const issues = 'error' in ai ? [`unusable answer (${ai.error})`] : [...complianceIssues('text', { subject: null, body: ai.text }), ...complianceIssues('email', { subject: ai.subject, body: ai.email })]
      if (!('error' in ai) && !issues.length) {
        words = { text: ai.text, subject: ai.subject, email: ai.email }
        confidence = ai.confidence
      }
      if (aiRunId) {
        await db
          .from('ai_runs')
          .update(confidence ? { status: 'succeeded', output: words, model: out.model, input_tokens: out.usage.input_tokens, output_tokens: out.usage.output_tokens } : { status: 'failed', error: `Template used instead: ${issues.join(' ')}`.slice(0, 500), model: out.model })
          .eq('id', aiRunId)
      }
    } catch (e) {
      if (aiRunId) await db.from('ai_runs').update({ status: 'failed', error: (e as Error).message.slice(0, 500) }).eq('id', aiRunId)
    }
  }

  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())
  const name = p.first_name ?? 'them'
  const items = []
  if (p.phone && !p.sms_opted_out_at) {
    items.push({ channel: 'text' as const, to: p.phone, subject: null, body: words.text })
  }
  if (p.email && !p.email_opted_out_at) {
    items.push({ channel: 'email' as const, to: p.email, subject: words.subject, body: finalBody('email', words.email, signer) })
  }
  for (const d of items) {
    const ins = await db.from('action_items').insert({
      organization_id: r.organization_id,
      loan_id: r.loan_id,
      kind: 'draft_message',
      title: `Follow up by ${d.channel} with ${name} (${page.title})`,
      payload: { ...d, contactId: r.contact_id, pageId: page.id, submissionId: sid, template: confidence === null },
      sources: [{ label: `${page.title} form`, quote: Object.entries(answers).slice(0, 6).map(([k, v]) => `${k}: ${v}`).join(' · ').slice(0, 500) }],
      confidence,
      ai_run_id: confidence ? aiRunId : null,
      due_on: today,
      source_key: pageDraftKey(sid, d.channel),
    })
    // A duplicate key means it was already drafted.
    if (ins.error && !ins.error.message.includes('duplicate')) throw new Error(ins.error.message)
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' })
  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) return reply(413, { error: 'That is too much to send at once.' })
  let body: Record<string, unknown>
  try {
    body = JSON.parse(raw)
  } catch {
    return reply(400, { error: 'The body must be JSON.' })
  }
  try {
    const db = admin()
    if (body.action === 'upload') return await upload(db, body)
    if (body.action === 'submit') return await submit(request, db, body)
    return reply(400, { error: 'Unknown action.' })
  } catch (e) {
    console.error('page-submit failed:', (e as Error).message)
    return reply(500, { error: 'Something went wrong. Please try again.' })
  }
})
