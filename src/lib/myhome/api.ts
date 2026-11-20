// MyHome (/myhome) talks only to the `myhome` Edge Function, signed in on its
// own Supabase client (createMyHomeClient), never the staff one. The MyHome
// code reaches the borrower only through Connor's GHL email.
import type { EmailOtpType, SupabaseClient } from '@supabase/supabase-js'
import { createMyHomeClient } from '@/lib/supabase'
import type { MyHomeMe } from '../../../supabase/functions/myhome/rules'

let client: SupabaseClient | null | undefined

/** The one MyHome client for the page (null in preview mode). */
export function myHomeClient(): SupabaseClient | null {
  if (client === undefined) client = createMyHomeClient()
  return client
}

export interface MyHomeReply<T> {
  status: number
  body: T & { error?: string; state?: string }
}

async function call<T>(body: Record<string, unknown>): Promise<MyHomeReply<T>> {
  const c = myHomeClient()
  if (!c) return { status: 0, body: { error: 'MyHome is not set up yet.' } as T & { error: string } }
  const { data, error } = await c.functions.invoke('myhome', { body })
  if (!error) return { status: 200, body: (data ?? {}) as MyHomeReply<T>['body'] }
  const ctx = (error as { context?: Response }).context
  if (ctx && typeof ctx.json === 'function') return { status: ctx.status, body: ((await ctx.json().catch(() => null)) ?? {}) as T & { error?: string } }
  return { status: 0, body: { error: 'Could not connect. Check your connection and try again.' } as T & { error: string } }
}

/**
 * Signs in with the email + MyHome code, or the personal link's token + email.
 * The function checks them and hands back a one-time key, traded here for a
 * session that MyHome keeps on this device. Returns the problem, or null.
 */
export async function signIn(v: { email: string; code?: string; invite?: string }): Promise<string | null> {
  const c = myHomeClient()
  if (!c) return 'MyHome is not set up yet.'
  const r = await call<{ tokenHash?: string; type?: string }>({ action: 'sign_in', ...v })
  if (r.status !== 200 || !r.body.tokenHash) return r.body.error ?? 'Could not sign you in. Try again.'
  const { error } = await c.auth.verifyOtp({ token_hash: r.body.tokenHash, type: (r.body.type ?? 'magiclink') as EmailOtpType })
  return error ? 'Could not sign you in. Try again.' : null
}

/** The signed-in borrower and their files. `fresh` = right after signing in (records the sign-in). */
export const fetchMe = (fresh = false) => call<Partial<MyHomeMe>>({ action: 'me', fresh })

export const hasSession = async () => !!(await myHomeClient()?.auth.getSession())?.data.session

export async function signOut() {
  await myHomeClient()?.auth.signOut()
}
