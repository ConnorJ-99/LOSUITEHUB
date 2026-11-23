// MyHome (/myhome) talks only to the `myhome` Edge Function, signed in on its
// own Supabase client (createMyHomeClient), never the staff one. The MyHome
// code reaches the borrower only through Connor's GHL email.
import type { EmailOtpType, SupabaseClient } from '@supabase/supabase-js'
import { putSignedUpload, type PortalCall, type UploadReply } from '@/lib/api/documentUpload'
import { createMyHomeClient } from '@/lib/supabase'
import type { PortalView } from '../../../supabase/functions/document-upload/portal'
import type { UploadItem, UploadLo } from '../../../supabase/functions/document-upload/rules'
import type { AskKind, MyHomeClosed, MyHomeMe } from '../../../supabase/functions/myhome/rules'

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

/** An open file (Stage 2): the borrower portal's sections, its checklist and that file's loan officer. */
export interface MyHomeFileView {
  items: UploadItem[]
  portal: PortalView
  lo: UploadLo
}

/** One open file's view. `opened` = the borrower just picked it (recorded once, not on every refresh). */
export const fetchFile = (loanId: string, opened: boolean) => call<Partial<MyHomeFileView>>({ action: 'file', loanId, opened })

/**
 * The portal sections' server call for one file. "This loan isn't open
 * anymore" (409) reads like the portal's "no longer available" (410), so the
 * page reloads the borrower's files.
 */
export const fileCall =
  (loanId: string): PortalCall =>
  async (body) => {
    const r = await call<UploadReply['body']>({ ...body, loanId })
    return { status: r.status === 409 ? 410 : r.status, body: r.body as UploadReply['body'] }
  }

/** A closed file's view (closed view Step A). `opened` = the borrower just picked it. */
export const fetchClosed = (loanId: string, opened: boolean) => call<Partial<MyHomeClosed>>({ action: 'closed', loanId, opened })

/** A one-minute link to a document published on the closed file. */
export const closedDocumentUrl = (loanId: string, documentId: string) => call<{ url?: string }>({ action: 'closed_pdf', loanId, documentId })

/** "Ask {LO} to check my value" (and, later, refi and equity checks). Returns when it was asked. */
export const askLo = (loanId: string, kind: AskKind) => call<{ askedAt?: string }>({ action: 'ask', loanId, kind })

/** "I made an extra payment": logs it (date and amount) on the closed loan. */
export const recordExtraPayment = (loanId: string, paidOn: string, amount: number) => call<{ id?: string }>({ action: 'extra_payment', loanId, paidOn, amount })

/** Takes back a logged extra payment (a mistake). */
export const removeExtraPayment = (loanId: string, paymentId: string) => call<{ ok?: boolean }>({ action: 'remove_payment', loanId, paymentId })

/** Uploads go through MyHome's own client, never the staff one. */
export const putMyHomeUpload = (path: string, token: string, file: File) => {
  const c = myHomeClient()
  if (!c) throw new Error('MyHome is not set up yet.')
  return putSignedUpload(path, token, file, c)
}

export const hasSession = async () => !!(await myHomeClient()?.auth.getSession())?.data.session

export async function signOut() {
  await myHomeClient()?.auth.signOut()
}
