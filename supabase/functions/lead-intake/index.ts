// LOSuite lead intake: a Supabase Edge Function (Deno) that receives web
// form submissions from the mps.mortgage website's own server function.
// Same fields and the same X-Intake-Secret header as the old app's
// /api/public/intake/lead, so switching the website over is a new address
// and secret only.
//
//   POST .../functions/v1/lead-intake           borrower leads
//   POST .../functions/v1/lead-intake/partner   realtor and builder inquiries
//
// Deploy with "Verify JWT" turned off: the website proves itself with the
// shared secret (LEAD_INTAKE_SECRET in Edge Function secrets), not a user
// login. The duplicate rules live in the database function intake_web_lead,
// which only this function's service role can run. A new lead also gets a
// drafted first text and email in its Action Queue for Connor to approve.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.118.0'
import { firstTouchDrafts } from './firstTouch.ts'
import { normalizeLead, secretMatches } from './normalize.ts'

/** Form submissions are small; anything bigger isn't a form. */
const MAX_BODY_BYTES = 100_000

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (request) => {
  if (request.method !== 'POST') return reply(405, { ok: false, error: 'Use POST.' })
  if (!secretMatches(request.headers.get('x-intake-secret'), Deno.env.get('LEAD_INTAKE_SECRET'))) {
    return reply(401, { ok: false, error: 'Missing or wrong X-Intake-Secret.' })
  }

  const raw = await request.text()
  if (raw.length > MAX_BODY_BYTES) return reply(413, { ok: false, error: 'Submission is too large.' })
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return reply(400, { ok: false, error: 'The body must be JSON.' })
  }

  const kind = new URL(request.url).pathname.replace(/\/+$/, '').endsWith('/partner') ? 'partner' : 'lead'
  const lead = normalizeLead(body, kind)
  if ('error' in lead) return reply(400, { ok: false, error: lead.error })

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data, error } = await db.rpc('intake_web_lead', {
    p_lead: {
      kind: lead.kind,
      first_name: lead.firstName,
      last_name: lead.lastName,
      email: lead.email,
      phone: lead.phone,
      purpose: lead.purpose,
      purchase_price: lead.purchasePrice,
      down_payment: lead.downPayment,
      cash_out: lead.cashOut,
      credit_score: lead.creditScore,
      timeline: lead.timeline,
      source: lead.source,
      form_type: lead.formType,
      assigned_to_email: lead.assignedToEmail,
      external_id: lead.externalId,
      tracking: lead.tracking,
      answers: lead.answers,
    },
  })
  if (error) {
    const known = /email or phone|No company/.test(error.message)
    return reply(known ? 400 : 500, { ok: false, error: known ? error.message : 'Could not save the submission. It can be sent again safely.' })
  }
  const result = data as { outcome: string; submission_id: string; loan_id?: string }
  if (result.loan_id && (result.outcome === 'new_lead' || result.outcome === 'new_loan_existing_person')) {
    // A failed draft never loses the lead: it's already saved.
    await queueFirstTouch(db, result.loan_id, lead).catch((e) => console.error('First-touch drafts failed:', (e as Error).message))
  }
  return reply(200, { ok: true, outcome: result.outcome, submission_id: result.submission_id, lead_id: result.loan_id ?? null })
})

/** Drafts the first text and email into the new lead's Action Queue, signed by its loan officer. */
async function queueFirstTouch(db: SupabaseClient, loanId: string, lead: Exclude<ReturnType<typeof normalizeLead>, { error: string }>) {
  const loan = await db.from('loans').select('organization_id, assigned_lo_id').eq('id', loanId).single()
  if (loan.error) throw loan.error
  const row = loan.data as { organization_id: string; assigned_lo_id: string | null }
  const [profile, org] = await Promise.all([
    row.assigned_lo_id ? db.from('profiles').select('full_name, nmls, phone').eq('id', row.assigned_lo_id).maybeSingle() : Promise.resolve({ data: null, error: null }),
    db.from('organizations').select('name, nmls').eq('id', row.organization_id).single(),
  ])
  const p = profile.data as { full_name: string | null; nmls: string | null; phone: string | null } | null
  const o = org.data as { name: string; nmls: string | null } | null
  const drafts = firstTouchDrafts(
    { firstName: lead.firstName, lastName: lead.lastName, email: lead.email, phone: lead.phone, formType: lead.formType, purpose: lead.purpose },
    { loName: p?.full_name ?? null, loNmls: p?.nmls ?? null, loPhone: p?.phone ?? null, companyName: o?.name ?? 'MPS Mortgage LLC', companyNmls: o?.nmls ?? '2501110' },
  )
  if (drafts.length === 0) return
  const insert = await db.from('action_items').insert(
    drafts.map((d) => ({
      organization_id: row.organization_id,
      loan_id: loanId,
      kind: 'draft_message',
      title: `First ${d.channel} to ${lead.firstName} (new web lead)`,
      payload: d,
      sources: [],
      confidence: null,
    })),
  )
  if (insert.error) throw insert.error
}
