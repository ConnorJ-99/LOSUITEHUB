// MPS HQ Loan Officer Assistant: a Supabase Edge Function (Deno), Verify JWT
// ON (Connor, 2026-11-03). It only talks to Claude: the app sends the chat,
// this adds who's asking, today's date, the lenders and programs, and the
// rules (tools.ts), and returns Claude's answer. When Claude asks for a tool,
// the app runs it in the browser as the signed-in person (same code as the
// app's own screens, same access rules) and sends the result back here.
// Nothing is changed or sent from this function. The Anthropic key lives in
// Edge Function secrets (ANTHROPIC_API_KEY); the model is ASSISTANT_MODEL (an
// optional secret) or tools.ts's default. Every call is logged in ai_runs.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import Anthropic from 'npm:@anthropic-ai/sdk@1.3.0'
import { ASSISTANT_MODEL, buildSystem, checkMessages, TOOLS, type ChatContext } from './tools.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' })

  const auth = request.headers.get('Authorization')
  if (!auth) return reply(401, { error: 'Sign in first.' })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: userData, error: userError } = await db.auth.getUser(auth.replace(/^Bearer\s+/i, ''))
  if (userError || !userData.user) return reply(401, { error: 'Your session expired. Sign in again.' })
  const userId = userData.user.id

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return reply(503, { code: 'no_key', error: 'API key not set: add ANTHROPIC_API_KEY under Edge Functions → Secrets in Supabase, then try again.' })

  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  if (body.task === 'status') return reply(200, { ready: true })

  const organizationId = str(body.organizationId, 64)
  const member = await db.from('organization_members').select('role').eq('organization_id', organizationId).eq('user_id', userId).maybeSingle()
  if (member.error || !member.data) return reply(403, { error: "You aren't on this company's team." })

  const checked = checkMessages(body.messages)
  if ('error' in checked) return reply(400, { error: checked.error })

  // The file the chat is in: re-read as the person (Row Level Security), so a file they can't see is refused.
  const page = (body.page ?? {}) as Record<string, unknown>
  const loanId = str(page.loanId, 64) || null
  if (loanId) {
    const seen = await db.from('loans').select('id').eq('id', loanId).maybeSingle()
    if (!seen.data) return reply(403, { error: 'That file was not found, or it is not yours.' })
  }

  const [profile, lenders] = await Promise.all([
    db.from('profiles').select('full_name, email').eq('id', userId).maybeSingle(),
    db.from('lenders').select('name, programs ( name )').order('name').limit(60),
  ])
  const p = profile.data as { full_name: string | null; email: string } | null
  const stages = Array.isArray(body.stages) ? (body.stages as { id?: unknown; label?: unknown }[]).slice(0, 30).map((s) => ({ id: str(s?.id, 40), label: str(s?.label, 60) })).filter((s) => s.id) : []
  const ctx: ChatContext = {
    userName: p?.full_name || p?.email || 'the loan officer',
    role: (member.data as { role: string }).role,
    today: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date()),
    file: loanId ? { loanId, borrowerName: str(page.borrowerName, 120) || 'this borrower', summary: str(page.summary, 4000) } : null,
    stages,
    lenders: ((lenders.data ?? []) as { name: string; programs: { name: string }[] | null }[]).map((l) => ({ name: l.name, programs: (l.programs ?? []).map((x) => x.name) })),
  }

  const model = Deno.env.get('ASSISTANT_MODEL') || ASSISTANT_MODEL
  const run = await db.from('ai_runs').insert({ organization_id: organizationId, loan_id: loanId, task_type: 'assistant_chat', input_ref: { loanId, messages: checked.messages.length }, model, created_by: userId }).select('id').single()
  const runId = (run.data as { id: string } | null)?.id ?? null

  try {
    const anthropic = new Anthropic({ apiKey })
    const res = await anthropic.messages.create({
      model,
      max_tokens: 2500,
      system: buildSystem(ctx),
      tools: TOOLS,
      messages: checked.messages,
    } as never)
    const r = res as unknown as { content: unknown[]; stop_reason: string; model: string; usage: { input_tokens: number; output_tokens: number } }
    if (runId) await db.from('ai_runs').update({ status: 'succeeded', output: { stop_reason: r.stop_reason }, model: r.model, input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens }).eq('id', runId)
    return reply(200, { content: r.content, stopReason: r.stop_reason })
  } catch (e) {
    const message = (e as Error).message
    if (runId) await db.from('ai_runs').update({ status: 'failed', error: message.slice(0, 500) }).eq('id', runId)
    const status = (e as { status?: number }).status
    if (status === 401) return reply(503, { code: 'bad_key', error: 'The Anthropic API key was refused. Check ANTHROPIC_API_KEY in Edge Functions → Secrets.' })
    if (/credit balance/i.test(message)) return reply(503, { code: 'no_credit', error: 'The Anthropic account has no credit left. Add credit at console.anthropic.com → Plans & Billing, then try again.' })
    if (status === 429) return reply(503, { code: 'busy', error: 'Too many requests to Anthropic right now. Wait a minute and try again.' })
    return reply(502, { error: 'The assistant could not answer just now. Try again in a moment.' })
  }
})
