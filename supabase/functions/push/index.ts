// MPS HQ push notifications: a Supabase Edge Function (Deno), Inbox fully
// live Phase 2c (Connor, 2026-11-03). Verify JWT is OFF. Two tasks:
// - "public_key": the VAPID public key the app needs to turn push on in a
//   browser (public by design; no key needed).
// - "deliver" (?key=<GHL_WEBHOOK_SECRET>, called by the database when a
//   notification is made): sends that notification to each device its owner
//   turned push on for, with the standard web-push library and the VAPID keys
//   in Edge Function secrets (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY). Devices
//   the push service says are gone are removed. The message is only a title,
//   a short line and an in-app link.

import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import webpush from 'npm:web-push@3.6.7'
import { isGone, pushPayload, secretMatches, type NotificationRow } from './payload.ts'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (request.method !== 'POST') return reply(405, { error: 'Use POST.' })

  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const privateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  if (!publicKey || !privateKey) return reply(500, { error: 'Phone notifications are not set up yet: add VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY under Edge Functions → Secrets in Supabase.' })

  const body = ((await request.json().catch(() => null)) ?? {}) as Record<string, unknown>
  if (body.task === 'public_key') return reply(200, { publicKey })

  if (body.task !== 'deliver') return reply(400, { error: 'Unknown task.' })
  if (!secretMatches(new URL(request.url).searchParams.get('key'), Deno.env.get('GHL_WEBHOOK_SECRET'))) return reply(401, { error: 'Wrong or missing key.' })
  const notificationId = typeof body.notificationId === 'string' ? body.notificationId : null
  if (!notificationId) return reply(400, { error: 'Which notification?' })

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const found = await db.from('notifications').select('id, kind, title, body, link, user_id').eq('id', notificationId).maybeSingle()
  if (found.error) return reply(500, { error: found.error.message })
  const n = found.data as (NotificationRow & { user_id: string }) | null
  if (!n) return reply(404, { error: 'Notification not found.' })

  const devices = await db.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', n.user_id)
  if (devices.error) return reply(500, { error: devices.error.message })

  webpush.setVapidDetails('mailto:info@mps.mortgage', publicKey, privateKey)
  const payload = pushPayload(n)
  let delivered = 0
  let removed = 0
  let failed = 0
  for (const d of (devices.data ?? []) as { id: string; endpoint: string; p256dh: string; auth: string }[]) {
    try {
      await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload, { TTL: 24 * 3600, urgency: 'high' })
      delivered++
      await db.from('push_subscriptions').update({ last_used_at: new Date().toISOString() }).eq('id', d.id)
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      if (isGone(status)) {
        await db.from('push_subscriptions').delete().eq('id', d.id)
        removed++
      } else {
        failed++
        console.error('Push failed:', status, (e as Error).message)
      }
    }
  }
  return reply(200, { delivered, removed, failed })
})
