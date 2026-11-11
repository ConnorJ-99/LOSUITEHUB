// The public shared-estimates page talks only to the estimate-view Edge
// Function (build plan Phase 7). No sign-in: the link's token, then a 24-hour
// session after the borrower confirms their email.
// Deployed in Supabase as "estimate-views" (2026-11-11); the code lives in
// supabase/functions/estimate-view and redeploys go to that same name.
import type { ShareLo, ShareSnapshot } from '../../../supabase/functions/estimate-view/rules'
import { db } from './client'

export interface ViewReply {
  status: number
  body: {
    state?: 'ask_email' | 'expired' | 'open'
    lo?: ShareLo
    message?: string
    error?: string
    session?: string
    snapshot?: ShareSnapshot
    picked?: string | null
    url?: string
  }
}

export async function callEstimateView(body: Record<string, unknown>): Promise<ViewReply> {
  const { data, error } = await db().functions.invoke('estimate-views', { body })
  if (!error) return { status: 200, body: (data ?? {}) as ViewReply['body'] }
  const ctx = (error as { context?: Response }).context
  if (ctx && typeof ctx.json === 'function') return { status: ctx.status, body: ((await ctx.json().catch(() => null)) ?? {}) as ViewReply['body'] }
  return { status: 0, body: { error: 'Could not connect. Check your connection and try again.' } }
}

const KEY = (token: string) => `mps-estimate-session:${token.slice(0, 16)}`

/** The viewing session for this link on this device (none in a private window). */
export function savedSession(token: string): string | null {
  try {
    return localStorage.getItem(KEY(token))
  } catch {
    return null
  }
}

export function saveSession(token: string, session: string | null) {
  try {
    if (session) localStorage.setItem(KEY(token), session)
    else localStorage.removeItem(KEY(token))
  } catch {
    // Private window: they confirm their email again next time.
  }
}
