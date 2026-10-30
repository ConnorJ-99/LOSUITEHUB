import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { useAuth } from '@/lib/auth/context'
import type { MessageChannel } from './assistant'
import { db, unwrap } from './client'

// GHL texts and emails in LOSuite (Phase 2b, Connor 2026-10-29). The
// ghl-inbound Edge Function copies them in; the app only reads them, marks
// them read, and (admins) says who an unmatched one is from. Who sees what is
// decided by the database: a person's messages follow their file, and only
// admins see unmatched ones.

const msgKeys = {
  all: ['messages'] as const,
  thread: (ids: string) => ['messages', 'thread', ids] as const,
  people: (loanId: string) => ['messages', 'people', loanId] as const,
  unread: ['messages', 'unread'] as const,
  inbox: ['messages', 'inbox'] as const,
  needsMatching: ['messages', 'needsMatching'] as const,
  consent: (ids: string) => ['messages', 'consent', ids] as const,
}

export type MatchedBy = 'ghl_id' | 'email' | 'phone' | 'admin'
export type MatchReason = 'shared_email' | 'shared_phone' | 'email_phone_differ' | 'linked_to_other_ghl' | 'no_match'

export const MATCHED_BY_LABEL: Record<MatchedBy, string> = { ghl_id: 'GHL link', email: 'Email', phone: 'Phone', admin: 'An admin' }
export const MATCH_REASON_LABEL: Record<MatchReason, string> = {
  shared_email: 'More than one person has this email',
  shared_phone: 'More than one person has this phone (a shared number)',
  email_phone_differ: 'The email and the phone belong to different people',
  linked_to_other_ghl: 'The person found is already linked to a different GHL contact',
  no_match: 'Nobody in LOSuite has this email or phone',
}

export interface Message {
  id: string
  contactId: string | null
  loanId: string | null
  channel: MessageChannel
  direction: 'inbound' | 'outbound'
  subject: string | null
  body: string
  fromAddress: string | null
  toAddress: string | null
  status: string | null
  sentAt: string
  readAt: string | null
  matchStatus: 'matched' | 'needs_matching'
  matchedBy: MatchedBy | null
  matchReason: MatchReason | null
  candidateIds: string[]
  ghlContactId: string | null
  ghlContactName: string | null
  ghlContactEmail: string | null
  ghlContactPhone: string | null
}

const MESSAGE_SELECT =
  'id, contact_id, loan_id, channel, direction, subject, body, from_address, to_address, status, sent_at, read_at, match_status, matched_by, match_reason, candidate_ids, ghl_contact_id, ghl_contact_name, ghl_contact_email, ghl_contact_phone'

interface MessageRow {
  id: string
  contact_id: string | null
  loan_id: string | null
  channel: MessageChannel
  direction: 'inbound' | 'outbound'
  subject: string | null
  body: string
  from_address: string | null
  to_address: string | null
  status: string | null
  sent_at: string
  read_at: string | null
  match_status: 'matched' | 'needs_matching'
  matched_by: MatchedBy | null
  match_reason: MatchReason | null
  candidate_ids: string[] | null
  ghl_contact_id: string | null
  ghl_contact_name: string | null
  ghl_contact_email: string | null
  ghl_contact_phone: string | null
}

const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  contactId: r.contact_id,
  loanId: r.loan_id,
  channel: r.channel,
  direction: r.direction,
  subject: r.subject,
  body: r.body,
  fromAddress: r.from_address,
  toAddress: r.to_address,
  status: r.status,
  sentAt: r.sent_at,
  readAt: r.read_at,
  matchStatus: r.match_status,
  matchedBy: r.matched_by,
  matchReason: r.match_reason,
  candidateIds: r.candidate_ids ?? [],
  ghlContactId: r.ghl_contact_id,
  ghlContactName: r.ghl_contact_name,
  ghlContactEmail: r.ghl_contact_email,
  ghlContactPhone: r.ghl_contact_phone,
})

/** A borrower on the file, with what messaging needs to know about them. */
export interface FilePerson {
  id: string
  role: 'primary' | 'co_borrower'
  firstName: string
  lastName: string
  email: string | null
  phone: string | null
  phoneDigits: string | null
  smsConsent: boolean | null
  emailConsent: boolean | null
  smsOptedOutAt: string | null
  emailOptedOutAt: string | null
  ghlContactId: string | null
}

export function useFilePeople(loanId: string) {
  return useQuery({
    queryKey: msgKeys.people(loanId),
    queryFn: async () => {
      const rows = unwrap<
        {
          role: 'primary' | 'co_borrower'
          contact: {
            id: string
            first_name: string
            last_name: string
            email: string | null
            phone: string | null
            phone_digits: string | null
            sms_consent: boolean | null
            email_consent: boolean | null
            sms_opted_out_at: string | null
            email_opted_out_at: string | null
            ghl_contact_id: string | null
          } | null
        }[]
      >(
        await db()
          .from('loan_borrowers')
          .select(
            'role, contact:contacts!loan_borrowers_contact_id_fkey ( id, first_name, last_name, email, phone, phone_digits, sms_consent, email_consent, sms_opted_out_at, email_opted_out_at, ghl_contact_id )',
          )
          .eq('loan_id', loanId),
      )
      return rows
        .filter((r) => r.contact)
        .map(
          ({ role, contact: c }): FilePerson => ({
            id: c!.id,
            role,
            firstName: c!.first_name,
            lastName: c!.last_name,
            email: c!.email,
            phone: c!.phone,
            phoneDigits: c!.phone_digits,
            smsConsent: c!.sms_consent,
            emailConsent: c!.email_consent,
            smsOptedOutAt: c!.sms_opted_out_at,
            emailOptedOutAt: c!.email_opted_out_at,
            ghlContactId: c!.ghl_contact_id,
          }),
        )
        .sort((a, b) => (a.role === b.role ? 0 : a.role === 'primary' ? -1 : 1))
    },
  })
}

/** Every text and email with these people, oldest first (the newest 300). */
export function useThread(contactIds: string[]) {
  const ids = [...contactIds].sort().join(',')
  return useQuery({
    queryKey: msgKeys.thread(ids),
    enabled: contactIds.length > 0,
    queryFn: async () => {
      const rows = unwrap<MessageRow[]>(await db().from('messages').select(MESSAGE_SELECT).in('contact_id', contactIds).order('sent_at', { ascending: false }).limit(300))
      return rows.map(toMessage).reverse()
    },
  })
}

/** Received messages nobody has opened yet (only the ones you can see). */
export function useUnreadCount() {
  const { state } = useAuth()
  return useQuery({
    queryKey: msgKeys.unread,
    enabled: state.status === 'signedIn',
    refetchInterval: 60_000,
    queryFn: async () => {
      const { count, error } = await db().from('messages').select('id', { count: 'exact', head: true }).eq('direction', 'inbound').is('read_at', null)
      if (error) throw new Error(error.message)
      return count ?? 0
    },
  })
}

/** Marks these people's received messages read (opening their Messages tab does this). */
export function useMarkRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (contactIds: string[]) => {
      let total = 0
      for (const id of contactIds) total += unwrap<number>(await db().rpc('mark_messages_read', { p_contact_id: id }))
      return total
    },
    onSuccess: (n) => {
      if (n > 0) queryClient.invalidateQueries({ queryKey: msgKeys.all })
    },
  })
}

export interface InboxRow {
  contactId: string
  name: string
  loanId: string | null
  last: Message
  unread: number
}

/** The latest message per person you can see, newest first, with how many are unread. */
export function useInbox() {
  return useQuery({
    queryKey: msgKeys.inbox,
    queryFn: async () => {
      const rows = unwrap<(MessageRow & { contact: { first_name: string; last_name: string } | null })[]>(
        await db()
          .from('messages')
          .select(`${MESSAGE_SELECT}, contact:contacts!messages_contact_id_fkey ( first_name, last_name )`)
          .eq('match_status', 'matched')
          .order('sent_at', { ascending: false })
          .limit(500),
      )
      const byPerson = new Map<string, InboxRow>()
      for (const r of rows) {
        const m = toMessage(r)
        if (!m.contactId) continue
        const row = byPerson.get(m.contactId) ?? { contactId: m.contactId, name: [r.contact?.first_name, r.contact?.last_name].filter(Boolean).join(' ') || 'Unknown', loanId: m.loanId, last: m, unread: 0 }
        if (m.direction === 'inbound' && !m.readAt) row.unread++
        byPerson.set(m.contactId, row)
      }
      return [...byPerson.values()]
    },
  })
}

export interface NeedsMatchingGroup {
  /** One GHL contact's waiting messages, newest first. */
  ghlContactId: string | null
  name: string | null
  email: string | null
  phone: string | null
  reason: MatchReason | null
  candidateIds: string[]
  messages: Message[]
}

/** Messages waiting for an admin to say who they're from, one group per GHL contact. Others see none. */
export function useNeedsMatching(enabled: boolean) {
  return useQuery({
    queryKey: msgKeys.needsMatching,
    enabled,
    queryFn: async () => {
      const rows = unwrap<MessageRow[]>(await db().from('messages').select(MESSAGE_SELECT).eq('match_status', 'needs_matching').order('sent_at', { ascending: false }).limit(300))
      const groups = new Map<string, NeedsMatchingGroup>()
      for (const m of rows.map(toMessage)) {
        const key = m.ghlContactId ?? m.id
        const g = groups.get(key) ?? { ghlContactId: m.ghlContactId, name: m.ghlContactName, email: m.ghlContactEmail, phone: m.ghlContactPhone, reason: m.matchReason, candidateIds: m.candidateIds, messages: [] }
        g.messages.push(m)
        groups.set(key, g)
      }
      return [...groups.values()]
    },
  })
}

/** An admin says who a waiting message is from; the rest from that GHL contact go too. */
export function useMatchMessage() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { messageId: string; contactId: string }) => unwrap<number>(await db().rpc('match_message', { p_message_id: v.messageId, p_contact_id: v.contactId })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: msgKeys.all }),
  })
}

export interface ConsentEvent {
  id: string
  contactId: string
  channel: MessageChannel
  change: 'opted_out' | 'restored' | 'granted'
  source: 'stop_reply' | 'ghl_dnd' | 'person'
  note: string | null
  createdAt: string
}

export function useConsentHistory(contactIds: string[]) {
  const ids = [...contactIds].sort().join(',')
  return useQuery({
    queryKey: msgKeys.consent(ids),
    enabled: contactIds.length > 0,
    queryFn: async () => {
      const rows = unwrap<{ id: string; contact_id: string; channel: MessageChannel; change: ConsentEvent['change']; source: ConsentEvent['source']; note: string | null; created_at: string }[]>(
        await db().from('consent_events').select('id, contact_id, channel, change, source, note, created_at').in('contact_id', contactIds).order('created_at', { ascending: false }).limit(20),
      )
      return rows.map((r): ConsentEvent => ({ id: r.id, contactId: r.contact_id, channel: r.channel, change: r.change, source: r.source, note: r.note, createdAt: r.created_at }))
    },
  })
}

/** Turns consent back on after an opt-out. Only a person can, with a note saying how they agreed again. */
export function useRestoreConsent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { contactId: string; channel: MessageChannel; note: string }) => {
      unwrap(await db().rpc('restore_consent', { p_contact_id: v.contactId, p_channel: v.channel, p_note: v.note }))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: msgKeys.all }),
  })
}

export interface CatchUpResult {
  conversations: number
  saved: number
  updated: number
  needsMatching: number
  skippedNotTest: number
  optOuts: number
  failed: number
  mode: 'test_only' | 'all'
  logError: string | null
}

/** Asks GHL for anything new since the last check (owners and admins). */
export function useCheckNewMessages() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      const { data, error } = await db().functions.invoke<CatchUpResult>('ghl-inbound', { body: { task: 'catch_up' } })
      if (error) {
        const detail = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null
        throw new Error(detail?.error ?? 'The check for new messages did not finish.')
      }
      return data as CatchUpResult
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: msgKeys.all }),
  })
}

/** Records that someone agreed to texts or email, with a note saying how. After an opt-out, use useRestoreConsent. */
export function useRecordConsent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { contactId: string; channel: MessageChannel; note: string }) => {
      unwrap(await db().rpc('record_consent', { p_contact_id: v.contactId, p_channel: v.channel, p_note: v.note }))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: msgKeys.all }),
  })
}

export interface SendResult {
  sent?: boolean
  alreadySent?: boolean
  status: string | null
  error?: string | null
  from?: string | null
  to?: string | null
}

/**
 * Sends one text or email through GHL. The server re-checks every rule
 * (consent, opt-outs, sending hours, test mode, the LO's confirmed number) and
 * uses the key so the same message can't go twice.
 */
export function useSendMessage() {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useMutation({
    mutationFn: async (v: { contactId: string; loanId: string; channel: MessageChannel; body: string; subject: string | null; idempotencyKey: string }) => {
      const { data, error } = await db().functions.invoke<SendResult>('ghl', { body: { task: 'send', organizationId: orgId, ...v } })
      if (error) {
        const detail = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null
        throw new Error(detail?.error ?? 'The message was not sent.')
      }
      return data as SendResult
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: msgKeys.all }),
  })
}
