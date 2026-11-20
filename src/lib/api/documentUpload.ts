// The public upload page talks only to the document-upload Edge Function
// (UI pass Part 3). No sign-in: the link's token, then a 24-hour session
// after the borrower confirms their email.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { PortalView } from '../../../supabase/functions/document-upload/portal'
import type { UploadItem, UploadLo } from '../../../supabase/functions/document-upload/rules'
import { db } from './client'

export interface UploadReply {
  status: number
  body: {
    state?: 'ask_email' | 'expired' | 'open'
    lo?: UploadLo
    message?: string
    error?: string
    session?: string
    items?: UploadItem[]
    path?: string
    token?: string
    ok?: boolean
    /** 'portal' = the borrower portal; 'request' = a one-off document request. */
    kind?: 'portal' | 'request'
    portal?: PortalView
    /** A one-minute PDF link (portal). */
    url?: string
  }
}

/**
 * How the portal's sections reach the server: `/u/{token}` adds the link's
 * token and session (document-upload), MyHome adds the file (myhome). 401 or
 * 410 back means "signed out or no longer available".
 */
export type PortalCall = (body: Record<string, unknown>) => Promise<UploadReply>

export const portalGone = (status: number) => status === 401 || status === 410

export async function callDocumentUpload(body: Record<string, unknown>): Promise<UploadReply> {
  const { data, error } = await db().functions.invoke('document-upload', { body })
  if (!error) return { status: 200, body: (data ?? {}) as UploadReply['body'] }
  const ctx = (error as { context?: Response }).context
  if (ctx && typeof ctx.json === 'function') return { status: ctx.status, body: ((await ctx.json().catch(() => null)) ?? {}) as UploadReply['body'] }
  return { status: 0, body: { error: 'Could not connect. Check your connection and try again.' } }
}

/** Puts the file where the function's one-time upload link points (MyHome passes its own client). */
export async function putSignedUpload(path: string, token: string, file: File, client: SupabaseClient = db()) {
  const r = await client.storage.from('loan-files').uploadToSignedUrl(path, token, file, { contentType: file.type })
  if (r.error) throw new Error('The upload did not finish. Try again.')
}

const KEY = (token: string) => `mps-upload-session:${token.slice(0, 16)}`

export function savedUploadSession(token: string): string | null {
  try {
    return localStorage.getItem(KEY(token))
  } catch {
    return null
  }
}

export function saveUploadSession(token: string, session: string | null) {
  try {
    if (session) localStorage.setItem(KEY(token), session)
    else localStorage.removeItem(KEY(token))
  } catch {
    // Private window: they confirm their email again next time.
  }
}
