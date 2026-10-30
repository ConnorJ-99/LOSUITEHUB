// GoHighLevel token check (Phase 0): the list of read-only calls the "ghl"
// Edge Function makes with the Private Integration Token, and how each answer
// is read. Pure and import-free so it can be tested and pasted with index.ts.
//
// Endpoints, Version headers and scopes are from HighLevel API v2's own
// OpenAPI specs (github.com/GoHighLevel/highlevel-api-docs, apps/*.json and
// docs/oauth/Scopes.md). Nothing here creates, changes or sends anything: the
// two "write" checks send a deliberately blank request to a record that
// doesn't exist, so GHL can only answer "not allowed" (scope missing) or
// "bad request" (scope there).

export const GHL_BASE = 'https://services.leadconnectorhq.com'

/** A made-up id no GHL record has; the write checks aim at it. */
export const NO_SUCH_ID = 'losuite-token-check-does-not-exist'

export type CheckKey = 'location' | 'users' | 'phone_numbers' | 'contacts_read' | 'contacts_write' | 'conversations_read' | 'messages_read' | 'messages_write'

export interface CheckPlan {
  key: CheckKey
  label: string
  scope: string
  method: 'GET' | 'POST' | 'PUT'
  version: '2021-07-28' | '2021-04-15'
  /** A blank request on purpose: a 400/404/422 answer means the scope is there. */
  dryRun: boolean
}

export const CHECKS: CheckPlan[] = [
  { key: 'location', label: 'Read the sub-account name', scope: 'locations.readonly', method: 'GET', version: '2021-07-28', dryRun: false },
  { key: 'users', label: 'Read GHL users', scope: 'users.readonly', method: 'GET', version: '2021-07-28', dryRun: false },
  { key: 'phone_numbers', label: 'Read phone numbers and who each is assigned to', scope: 'phonenumbers.read', method: 'GET', version: '2021-07-28', dryRun: false },
  { key: 'contacts_read', label: 'Look up a contact by email', scope: 'contacts.readonly', method: 'GET', version: '2021-07-28', dryRun: false },
  { key: 'contacts_write', label: 'Update a contact (blank test, changes nothing)', scope: 'contacts.write', method: 'PUT', version: '2021-07-28', dryRun: true },
  { key: 'conversations_read', label: 'Read conversations', scope: 'conversations.readonly', method: 'GET', version: '2021-04-15', dryRun: false },
  { key: 'messages_read', label: 'Read messages', scope: 'conversations/message.readonly', method: 'GET', version: '2021-04-15', dryRun: false },
  { key: 'messages_write', label: 'Send a message (blank test with no recipient, sends nothing)', scope: 'conversations/message.write', method: 'POST', version: '2021-04-15', dryRun: true },
]

export type CheckResult = 'works' | 'missing_scope' | 'bad_token' | 'failed'

export interface CheckOutcome {
  key: CheckKey
  label: string
  scope: string
  result: CheckResult
  httpStatus: number | null
  detail: string
}

/** GHL's error text, cut short. GHL errors never echo the token back. */
export function errorText(body: unknown): string {
  if (body && typeof body === 'object') {
    const m = (body as { message?: unknown }).message
    const text = Array.isArray(m) ? m.join('; ') : typeof m === 'string' ? m : ''
    if (text) return text.slice(0, 200)
  }
  return typeof body === 'string' ? body.slice(0, 200) : ''
}

/** Reads one answer. `status` is null when the call never got an answer (timeout, network). */
export function classify(plan: CheckPlan, status: number | null, body: unknown): Omit<CheckOutcome, 'key' | 'label' | 'scope'> {
  const text = errorText(body)
  if (status === null) return { result: 'failed', httpStatus: null, detail: text || 'No answer from GHL.' }
  if (status >= 200 && status < 300) return { result: 'works', httpStatus: status, detail: plan.dryRun ? 'Allowed.' : 'Works.' }
  if (status === 401 || status === 403) {
    if (/scope|not authorized|permission|forbidden/i.test(text) && !/invalid token|expired/i.test(text)) {
      return { result: 'missing_scope', httpStatus: status, detail: `Needs the "${plan.scope}" scope.` }
    }
    if (/invalid token|expired|jwt/i.test(text)) return { result: 'bad_token', httpStatus: status, detail: 'GHL did not accept the token.' }
    return { result: 'missing_scope', httpStatus: status, detail: `Refused (${text || 'no reason given'}). Most likely needs the "${plan.scope}" scope.` }
  }
  // The blank test requests are meant to be refused for their content, which proves the permission is there.
  if (plan.dryRun && (status === 400 || status === 404 || status === 422)) {
    return { result: 'works', httpStatus: status, detail: 'Allowed (GHL refused the blank test request itself, as planned).' }
  }
  return { result: 'failed', httpStatus: status, detail: text || `GHL answered ${status}.` }
}

export interface GhlUser {
  id: string
  name: string
  email: string | null
  phone: string | null
  /** The GHL phone number assigned to this user in this sub-account, if GHL says. */
  ghlNumber: string | null
  role: string | null
}

/** Keeps only what the report needs from GHL's user records. */
export function pickUsers(body: unknown, locationId: string): GhlUser[] {
  const list = (body as { users?: unknown } | null)?.users
  if (!Array.isArray(list)) return []
  return list.map((u: Record<string, unknown>) => {
    const lc = u.lcPhone as Record<string, unknown> | undefined
    const roles = u.roles as Record<string, unknown> | undefined
    const name = typeof u.name === 'string' && u.name ? u.name : [u.firstName, u.lastName].filter((x) => typeof x === 'string' && x).join(' ')
    return {
      id: String(u.id ?? ''),
      name,
      email: typeof u.email === 'string' ? u.email : null,
      phone: typeof u.phone === 'string' && u.phone ? u.phone : null,
      ghlNumber: lc && typeof lc[locationId] === 'string' && lc[locationId] ? (lc[locationId] as string) : null,
      role: roles ? [roles.type, roles.role].filter((x) => typeof x === 'string' && x).join(' ') || null : null,
    }
  })
}

export interface GhlNumber {
  number: string
  name: string | null
  isDefault: boolean
  /** The GHL user id the number is assigned to. */
  assignedUserId: string | null
  type: string | null
}

export function pickNumbers(body: unknown): GhlNumber[] {
  const list = (body as { numbers?: unknown } | null)?.numbers
  if (!Array.isArray(list)) return []
  return list.map((n: Record<string, unknown>) => ({
    number: String(n.phoneNumber ?? ''),
    name: typeof n.friendlyName === 'string' && n.friendlyName ? n.friendlyName : null,
    isDefault: n.isDefaultNumber === true,
    assignedUserId: typeof n.linkedUser === 'string' && n.linkedUser ? n.linkedUser : null,
    type: typeof n.type === 'string' ? n.type : null,
  }))
}

/**
 * The number GHL has assigned to a user. The phone-number list's
 * `linkedUser` is GHL's own assignment; the user's `lcPhone` for this
 * sub-account is the backup when that list can't be read. Null = GHL shows
 * no number for them, so nothing will text from one.
 */
export function assignedNumber(user: GhlUser, numbers: GhlNumber[]): string | null {
  return numbers.find((n) => n.assignedUserId === user.id && n.number)?.number ?? user.ghlNumber
}

/** The path only, for the call log: never the query string. */
export function logEndpoint(path: string): string {
  return path.split('?')[0]
}

/** Scopes to add in GHL, from the checks that came back "missing scope". */
export function missingScopes(outcomes: CheckOutcome[]): string[] {
  return [...new Set(outcomes.filter((o) => o.result === 'missing_scope').map((o) => o.scope))]
}
