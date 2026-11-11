// Borrower upload links (UI pass Part 3): the rules the document-upload Edge
// Function follows and the shapes it returns. Pure, with no imports, so the
// function (Deno), the public page and the tests share it. The email check
// and session rules match shared estimates (estimate-view/rules.ts).

export const MAX_FILE_BYTES = 10 * 1024 * 1024
export const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif'] as const
export const WRONG_EMAIL_LIMIT = 5
export const SESSION_HOURS = 24
export const DEFAULT_LINK_DAYS = 14

export type ItemStatus = 'requested' | 'received' | 'reviewed' | 'rejected' | 'waived'

/** One item as the borrower sees it. */
export interface UploadItem {
  id: string
  label: string
  instructions: string | null
  /** requested / rejected = still needed; received = in, being reviewed; reviewed = accepted. */
  status: ItemStatus
  rejectReason: string | null
  dueOn: string | null
  files: { name: string; uploadedAt: string }[]
}

/** The loan officer's card on the page. */
export interface UploadLo {
  name: string
  nmls: string | null
  phone: string | null
  email: string | null
  photoUrl: string | null
}

export const normEmail = (e: string | null | undefined) => e?.trim().toLowerCase() || null

/** The typed email is the link's borrower's, or a co-borrower's on the same file. */
export function emailMatches(typed: string, borrowerEmails: (string | null)[]): boolean {
  const t = normEmail(typed)
  return !!t && borrowerEmails.some((e) => normEmail(e) === t)
}

export type LinkState = 'open' | 'expired' | 'revoked'

export function linkState(l: { expiresAt: string; revokedAt: string | null }, now: Date): LinkState {
  if (l.revokedAt) return 'revoked'
  return Date.parse(l.expiresAt) <= now.getTime() ? 'expired' : 'open'
}

export const isLocked = (wrongInLastHour: number) => wrongInLastHour >= WRONG_EMAIL_LIMIT

export function sessionValid(s: { sessionHash: string | null; sessionExpiresAt: string | null }, presentedHash: string | null, now: Date): boolean {
  return !!s.sessionHash && !!presentedHash && s.sessionHash === presentedHash && !!s.sessionExpiresAt && Date.parse(s.sessionExpiresAt) > now.getTime()
}

/** Whether a file can be uploaded: PDF or photo, up to 10 MB. Returns the reason when not. */
export function fileProblem(f: { size: number; type: string }): string | null {
  if (!(ALLOWED_TYPES as readonly string[]).includes(f.type.toLowerCase())) return 'Upload a PDF or a photo (JPG, PNG or HEIC).'
  if (f.size <= 0) return 'That file is empty.'
  if (f.size > MAX_FILE_BYTES) return 'That file is over 10 MB. Try a smaller photo or a PDF.'
  return null
}

/** A storage-safe file name that keeps the extension: "Bank Stmt (Jan).pdf" → "bank-stmt-jan.pdf". */
export function safeFileName(name: string): string {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 5) : ''
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'upload'
  return ext ? `${base}.${ext}` : base
}

/** An item still on the borrower's to-do list. */
export const stillNeeded = (s: ItemStatus) => s === 'requested' || s === 'rejected'

/** Items the borrower may upload to (anything not accepted or waived). */
export const canUpload = (s: ItemStatus) => s === 'requested' || s === 'rejected' || s === 'received'

export const expiredText = (loName: string) => `This link has expired. Contact ${loName} for a new one.`
export const NOT_VERIFIED = "We couldn't verify that email."
