// MyHome (/myhome) talks only to the `myhome` Edge Function, signed in on its
// own Supabase client (createMyHomeClient), never the staff one. The MyHome
// code reaches the borrower only through Connor's GHL email.
import type { EmailOtpType, SupabaseClient } from '@supabase/supabase-js'
import { putSignedUpload, type PortalCall, type UploadReply } from '@/lib/api/documentUpload'
import { createMyHomeClient, supabase } from '@/lib/supabase'
import type { PortalView } from '../../../supabase/functions/document-upload/portal'
import type { UploadItem, UploadLo } from '../../../supabase/functions/document-upload/rules'
import type { AskKind, AssetInput, GoalUpdateKind, MyHomeAssets, MyHomeBudget, MyHomeBudgetItem, MyHomeClosed, MyHomeMe, MyHomeNurture, StartGoal } from '../../../supabase/functions/myhome/rules'

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

let previewLoan: string | null = null

/**
 * The MyHome tab's "See what they see" (Connor, 2026-11-24): while set, every
 * call goes to the function's read-only `preview` action on the TEAM login,
 * for this file's primary borrower. Writes come back refused with a note.
 */
export function setMyHomePreview(loanId: string | null) {
  previewLoan = loanId
}

async function call<T>(body: Record<string, unknown>): Promise<MyHomeReply<T>> {
  const c = previewLoan ? supabase : myHomeClient()
  if (previewLoan && c) body = { action: 'preview', loanId: previewLoan, inner: body.action, documentId: body.documentId }
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

/** "Start something new" (Step C): a prefilled application; returns the resume code /apply keeps on this device. */
export const startNew = (loanId: string, goal: StartGoal) => call<{ resume?: string }>({ action: 'start_new', loanId, goal })

/** "I made an extra payment": logs it (date and amount) on the closed loan. */
export const recordExtraPayment = (loanId: string, paidOn: string, amount: number) => call<{ id?: string }>({ action: 'extra_payment', loanId, paidOn, amount })

/** Takes back a logged extra payment (a mistake). */
export const removeExtraPayment = (loanId: string, paymentId: string) => call<{ ok?: boolean }>({ action: 'remove_payment', loanId, paymentId })

/** A Nurture file's goals (Nurture goals Phase 1). */
export const fetchNurture = (loanId: string, opened: boolean) => call<Partial<MyHomeNurture>>({ action: 'nurture', loanId, opened })

/** A goal update: a balance, contribution, score, payment, note, or "I reached this goal". Returns the goal's new value. */
export const sendGoalUpdate = (loanId: string, v: { goalId: string; kind: GoalUpdateKind; amount?: number | null; on?: string | null; note?: string | null }) =>
  call<{ value?: number }>({ action: 'goal_update', loanId, ...v })

/** A one-minute link to their plan's Roadmap PDF. */
export const planPdfUrl = (loanId: string, documentId: string) => call<{ url?: string }>({ action: 'plan_pdf', loanId, documentId })

/** "Tell {LO} I did this" on a milestone (an update for the LO to verify). */
export const reportMilestone = (loanId: string, milestoneId: string, note: string | null) => call<{ id?: string }>({ action: 'milestone_done', loanId, milestoneId, note })

/** "Homes I like" on a Nurture purchase file: saves a home to the file (no numbers requested). */
export const addHome = (loanId: string, v: { address: string; city: string | null; zip: string | null; price: number | null; link: string | null; notes: string | null }) =>
  call<{ id?: string }>({ action: 'home_add', loanId, ...v })

/** Which of their accounts a savings goal counts (empty = they type the balance). */
export const followAssets = (loanId: string, goalId: string, assetIds: string[]) => call<{ ok?: boolean }>({ action: 'goal_follow', loanId, goalId, assetIds })

/** My assets (Phase 2): their own accounts, the same on every file. */
export const fetchAssets = () => call<Partial<MyHomeAssets>>({ action: 'assets' })

/** Adds an account (no assetId) or changes one. */
export const saveAsset = (v: AssetInput & { assetId?: string | null }) => call<{ id?: string }>({ action: 'asset_save', ...v })

/** Removes an account from MyHome (its history stays). */
export const removeAsset = (assetId: string) => call<{ ok?: boolean }>({ action: 'asset_remove', assetId })

/** My budget (Phase 3): settings, items and entries. */
export const fetchBudget = () => call<Partial<MyHomeBudget>>({ action: 'budget' })

export const saveBudgetSettings = (v: { startingCash: number | null; startingOn: string | null; monthlySavings: number | null }) => call<{ id?: null }>({ action: 'budget_settings', ...v })

/** Adds (no itemId) or changes an income or expense. */
export const saveBudgetItem = (v: Omit<MyHomeBudgetItem, 'id'> & { itemId?: string | null }) => call<{ id?: string }>({ action: 'budget_item_save', ...v })

export const removeBudgetItem = (itemId: string) => call<{ id?: null }>({ action: 'budget_item_remove', itemId })

/** What really happened: for a scheduled date (itemId + plannedOn) or something unplanned (kind + name). */
export const saveBudgetEntry = (v: { itemId: string | null; plannedOn: string | null; kind: 'income' | 'expense'; name: string | null; amount: number; on: string | null }) =>
  call<{ id?: string }>({ action: 'budget_entry_save', ...v })

export const removeBudgetEntry = (entryId: string) => call<{ id?: null }>({ action: 'budget_entry_remove', entryId })

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
