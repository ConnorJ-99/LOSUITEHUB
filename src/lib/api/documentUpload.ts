// The public upload page talks only to the document-upload Edge Function
// (UI pass Part 3). No sign-in: the link's token, then a 24-hour session
// after the borrower confirms their email.
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
  }
}

export async function callDocumentUpload(body: Record<string, unknown>): Promise<UploadReply> {
  const { data, error } = await db().functions.invoke('document-upload', { body })
  if (!error) return { status: 200, body: (data ?? {}) as UploadReply['body'] }
  const ctx = (error as { context?: Response }).context
  if (ctx && typeof ctx.json === 'function') return { status: ctx.status, body: ((await ctx.json().catch(() => null)) ?? {}) as UploadReply['body'] }
  return { status: 0, body: { error: 'Could not connect. Check your connection and try again.' } }
}

/** Puts the file where the function's one-time upload link points. */
export async function putSignedUpload(path: string, token: string, file: File) {
  const r = await db().storage.from('loan-files').uploadToSignedUrl(path, token, file, { contentType: file.type })
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
