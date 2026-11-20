// "Send MyHome code to GHL" (MyHome Stage 1, Connor 2026-11-20): the GHL side
// of a MyHome invite. The ghl function writes the borrower's permanent MyHome
// code and personal link into two GHL custom fields on their contact, then
// adds the tag that starts Connor's GHL email workflow (taken off first, so
// pressing it again starts the workflow again). Pure, with no imports.

/** Connor's GHL custom fields: {{contact.home_management_code}} and {{contact.home_management_link}}. */
export const MYHOME_CODE_FIELD = 'home_management_code'
export const MYHOME_LINK_FIELD = 'home_management_link'
/** The tag his workflow starts on. */
export const MYHOME_TAG = 'home management code'

/** The app's own address, from the browser: https, or localhost while testing. Null when it isn't one. */
export function appOrigin(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  try {
    const u = new URL(raw)
    const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
    if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null
    return u.origin
  } catch {
    return null
  }
}

/** The personal link that never expires. */
export const myHomeLink = (origin: string, token: string) => `${origin}/myhome?invite=${token}`

/**
 * The two fields' GHL ids, from GET /locations/{id}/customFields. GHL lists
 * each field's key as "contact.home_management_code". Missing ones are left out.
 */
export function myHomeFieldIds(body: unknown): { code: string | null; link: string | null } {
  const list = (body as { customFields?: unknown } | null)?.customFields
  const fields = Array.isArray(list) ? (list as { id?: unknown; fieldKey?: unknown }[]) : []
  const idFor = (key: string) => {
    const f = fields.find((x) => typeof x.fieldKey === 'string' && (x.fieldKey === `contact.${key}` || x.fieldKey === key))
    return typeof f?.id === 'string' ? f.id : null
  }
  return { code: idFor(MYHOME_CODE_FIELD), link: idFor(MYHOME_LINK_FIELD) }
}

/**
 * At closing (Connor, 2026-11-20): before the Closed opportunity move starts
 * his closing email workflow, the primary borrower's code and link go into the
 * two fields, with no tag. No account yet → invite them first; turned off →
 * leave them alone; otherwise write the current code and link.
 */
export function myHomeAtClose(account: { status: string } | null): 'invite' | 'write' | 'off' {
  if (!account) return 'invite'
  return account.status === 'off' ? 'off' : 'write'
}

/** The PUT /contacts/{id} body: by id when GHL told us, else by key. */
export function myHomeFieldsBody(ids: { code: string | null; link: string | null }, code: string, link: string) {
  const one = (id: string | null, key: string, value: string) => (id ? { id, field_value: value } : { key, field_value: value })
  return { customFields: [one(ids.code, MYHOME_CODE_FIELD, code), one(ids.link, MYHOME_LINK_FIELD, link)] }
}
