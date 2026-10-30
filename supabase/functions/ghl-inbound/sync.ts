// Reading GHL's conversations, messages and contacts for the ghl-inbound
// Edge Function (Phase 2a, Connor 2026-10-29). Pure and import-free, so it's
// tested here and pasted with index.ts. Shapes are from HighLevel API v2's
// apps/conversations.json and apps/contacts.json.
//
// Only texts and emails are kept (not calls, chats or activity). Emails are
// stored as plain text, never as HTML. A GHL contact's SSN field is never
// read.

export type Channel = 'text' | 'email'

const TEXT_TYPES = new Set(['TYPE_SMS', 'TYPE_CAMPAIGN_SMS', 'TYPE_CAMPAIGN_MANUAL_SMS', 'TYPE_CUSTOM_SMS', 'TYPE_CUSTOM_PROVIDER_SMS'])
const EMAIL_TYPES = new Set(['TYPE_EMAIL', 'TYPE_CAMPAIGN_EMAIL', 'TYPE_CUSTOM_EMAIL', 'TYPE_CUSTOM_PROVIDER_EMAIL'])

export function channelOf(messageType: unknown): Channel | null {
  if (typeof messageType !== 'string') return null
  if (TEXT_TYPES.has(messageType)) return 'text'
  if (EMAIL_TYPES.has(messageType)) return 'email'
  return null
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** The standard carrier opt-out words, as the whole reply ("Stop", "STOP.", " unsubscribe "). */
export function isStopReply(body: string | null | undefined): boolean {
  const word = (body ?? '').trim().toLowerCase().replace(/[^a-z]/g, '')
  return ['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit'].includes(word)
}

export interface GhlContact {
  id: string
  firstName: string | null
  lastName: string | null
  name: string | null
  email: string | null
  phone: string | null
  /** GHL's Do Not Disturb, per channel (all channels when `dnd` is on). */
  dndText: boolean
  dndEmail: boolean
}

/** From GET /contacts/{id} ({ contact: {...} }). Keeps only what matching and opt-outs need. */
export function pickContact(body: unknown): GhlContact | null {
  const c = ((body as { contact?: unknown } | null)?.contact ?? body) as Record<string, unknown> | null
  if (!c || typeof c !== 'object' || !str(c.id)) return null
  const settings = (c.dndSettings ?? {}) as Record<string, { status?: unknown } | undefined>
  const blocked = (channel: string) => ['active', 'permanent'].includes(String(settings[channel]?.status ?? ''))
  const all = c.dnd === true
  return {
    id: str(c.id)!,
    firstName: str(c.firstName),
    lastName: str(c.lastName),
    name: str(c.contactName) ?? str(c.name) ?? str(c.fullNameLowerCase),
    email: str(c.email),
    phone: str(c.phone),
    dndText: all || blocked('SMS'),
    dndEmail: all || blocked('Email'),
  }
}

/** Test mode keeps only GHL contacts with the word TEST (capitals) in their name. */
export function isTestContact(c: Pick<GhlContact, 'firstName' | 'lastName' | 'name'>): boolean {
  return [c.firstName, c.lastName, c.name].some((n) => !!n && /\bTEST\b/.test(n))
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" }

/** An email's HTML as readable plain text: line breaks kept, tags and styles dropped. */
export function htmlToText(html: string | null | undefined): string {
  if (!html) return ''
  return html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#39|[a-z]+);/gi, (m, e: string) => ENTITIES[e.toLowerCase()] ?? m)
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface GhlMessage {
  id: string
  conversationId: string | null
  contactId: string | null
  channel: Channel
  direction: 'inbound' | 'outbound'
  body: string
  status: string | null
  sentAt: string
  userId: string | null
  /** For emails: the id to read the full email with (GET /conversations/messages/email/{id}). */
  emailId: string | null
}

/** From GET /conversations/{id}/messages. GHL sometimes nests the list one level deeper. */
export function pickMessages(body: unknown): GhlMessage[] {
  const top = (body as { messages?: unknown } | null)?.messages
  const list = Array.isArray(top) ? top : Array.isArray((top as { messages?: unknown } | null)?.messages) ? (top as { messages: unknown[] }).messages : []
  const out: GhlMessage[] = []
  for (const raw of list as Record<string, unknown>[]) {
    const channel = channelOf(raw?.messageType)
    const id = str(raw?.id)
    const direction = raw?.direction
    if (!channel || !id || (direction !== 'inbound' && direction !== 'outbound')) continue
    const date = str(raw.dateAdded)
    const emailIds = ((raw.meta as { email?: { messageIds?: unknown } } | undefined)?.email?.messageIds ?? []) as unknown[]
    out.push({
      id,
      conversationId: str(raw.conversationId),
      contactId: str(raw.contactId),
      channel,
      direction,
      body: channel === 'email' ? htmlToText(str(raw.body)) : (str(raw.body) ?? ''),
      status: str(raw.status),
      sentAt: date && !Number.isNaN(Date.parse(date)) ? new Date(date).toISOString() : new Date().toISOString(),
      userId: str(raw.userId),
      emailId: channel === 'email' ? (str(emailIds[0]) ?? id) : null,
    })
  }
  return out
}

export interface EmailDetail {
  subject: string | null
  body: string
  from: string | null
  to: string | null
}

/** From GET /conversations/messages/email/{id} ({ emailMessage: {...} } or the email itself). */
export function pickEmail(body: unknown): EmailDetail | null {
  const e = ((body as { emailMessage?: unknown } | null)?.emailMessage ?? body) as Record<string, unknown> | null
  if (!e || typeof e !== 'object') return null
  const to = Array.isArray(e.to) ? (e.to as unknown[]).filter((x) => typeof x === 'string').join(', ') : str(e.to)
  return { subject: str(e.subject), body: htmlToText(str(e.body)), from: str(e.from), to: to || null }
}

export interface ConversationRef {
  id: string
  contactId: string
  /** The contact's name as GHL lists it, so test mode can skip others without reading their record. */
  name: string | null
  lastMessageAt: number | null
}

/** From GET /conversations/search. */
export function pickConversations(body: unknown): ConversationRef[] {
  const list = (body as { conversations?: unknown } | null)?.conversations
  if (!Array.isArray(list)) return []
  return (list as Record<string, unknown>[])
    .filter((c) => str(c?.id) && str(c?.contactId))
    .map((c) => ({ id: str(c.id)!, contactId: str(c.contactId)!, name: str(c.fullName) ?? str(c.contactName), lastMessageAt: typeof c.lastMessageDate === 'number' ? c.lastMessageDate : null }))
}

/** The GHL contact id a workflow webhook is about: "contact_id" in GHL's standard payload. */
export function webhookContactId(body: unknown): string | null {
  const b = (body ?? {}) as Record<string, unknown>
  return str(b.contact_id) ?? str(b.contactId) ?? str((b.contact as { id?: unknown } | undefined)?.id) ?? str((b.customData as { contactId?: unknown } | undefined)?.contactId)
}

/** Constant-time comparison for the webhook key (same rule as lead intake: at least 16 characters). */
export function secretMatches(given: string | null, expected: string | undefined): boolean {
  if (!given || !expected || expected.length < 16) return false
  let diff = given.length ^ expected.length
  for (let i = 0; i < Math.max(given.length, expected.length); i++) diff |= (given.charCodeAt(i) || 0) ^ (expected.charCodeAt(i) || 0)
  return diff === 0
}
