// MyHome from MPS-HQ's side (Stage 1, docs/plans/myhome.md): the primary
// borrower's MyHome account on a file, "Send MyHome code to GHL"
// (invite_to_myhome() makes the permanent code and link, then the ghl
// function writes them to the GHL contact and adds the tag that starts
// Connor's email workflow), "New code" and Turn off. Before the MyHome script
// has run, reads come back null.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { db, unwrap } from './client'

export interface MyHomeAccount {
  id: string
  contactId: string
  status: 'invited' | 'active' | 'off'
  codeSentAt: string | null
  invitedAt: string
  lastSignedInAt: string | null
}

const accountsKey = (contactIds: string[]) => ['myhomeAccounts', ...[...contactIds].sort()] as const

/** The MyHome accounts of these people. Null = the MyHome script hasn't run yet. */
export function useMyHomeAccounts(contactIds: string[]) {
  return useQuery({
    queryKey: accountsKey(contactIds),
    enabled: contactIds.length > 0,
    retry: false,
    queryFn: async (): Promise<MyHomeAccount[] | null> => {
      const r = await db().from('borrower_accounts').select('id, contact_id, status, code_sent_at, invited_at, last_signed_in_at').in('contact_id', contactIds)
      if (r.error) return null
      return (r.data as { id: string; contact_id: string; status: MyHomeAccount['status']; code_sent_at: string | null; invited_at: string; last_signed_in_at: string | null }[]).map((a) => ({
        id: a.id,
        contactId: a.contact_id,
        status: a.status,
        codeSentAt: a.code_sent_at,
        invitedAt: a.invited_at,
        lastSignedInAt: a.last_signed_in_at,
      }))
    },
  })
}

export type SendCodeResult = { sent: true } | { skipped: string }

/** Invites the person if needed (or makes a new code), then sends the code and link to their GHL contact with the tag. */
export function useSendMyHomeCode() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { organizationId: string; loanId: string; contactId: string; newCode?: boolean }): Promise<SendCodeResult> => {
      unwrap(await db().rpc('invite_to_myhome', { p_contact_id: v.contactId, p_new_code: v.newCode ?? false }))
      const { data, error } = await db().functions.invoke<SendCodeResult>('ghl', {
        body: { task: 'myhome_code', organizationId: v.organizationId, loanId: v.loanId, contactId: v.contactId, appUrl: window.location.origin },
      })
      if (error) {
        const detail = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null
        throw new Error(detail?.error ?? 'The MyHome code was not sent to GHL.')
      }
      return data as SendCodeResult
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['myhomeAccounts'] }),
  })
}

export function useTurnOffMyHome() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (accountId: string) => {
      unwrap(await db().rpc('turn_off_myhome', { p_account_id: accountId }))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['myhomeAccounts'] }),
  })
}

// ---------------------------------------------------------------------------
// Asks from MyHome on a file (Connor, 2026-11-23)
// ---------------------------------------------------------------------------

export type MyHomeAskKind = 'value_check' | 'refi_check' | 'equity_check' | 'start_new'

export interface MyHomeAsk {
  id: string
  kind: MyHomeAskKind
  createdAt: string
  handledAt: string | null
  /** Start something new: what they picked (purchase, refinance, equity). */
  goal?: string | null
}

export const ASK_LABEL: Record<MyHomeAskKind, string> = {
  value_check: "Asked you to check their home's value",
  refi_check: 'Asked you to check their refinance options',
  equity_check: 'Asked you to check their equity / HELOC options',
  start_new: 'Started a new application from MyHome',
}

const START_WORDS: Record<string, string> = { purchase: 'buy another home', refinance: 'refinance their home', equity: 'borrow against their equity' }

/** What an ask says ("Started a new application from MyHome to buy another home"). */
export const askLabel = (ask: Pick<MyHomeAsk, 'kind' | 'goal'>) => (ask.kind === 'start_new' && ask.goal && START_WORDS[ask.goal] ? `${ASK_LABEL.start_new} to ${START_WORDS[ask.goal]}` : ASK_LABEL[ask.kind])

const ASK_EVENTS = ['value_check_requested', 'refi_check_requested', 'equity_check_requested', 'start_new_requested']

const asksKey = (loanId: string) => ['myhomeAsks', loanId] as const

/** The borrower's MyHome asks on this file, newest first (open ones and the last few done). Null before the MyHome script. */
export function useMyHomeAsks(loanId: string) {
  return useQuery({
    queryKey: asksKey(loanId),
    retry: false,
    queryFn: async (): Promise<MyHomeAsk[] | null> => {
      const r = await db()
        .from('myhome_events')
        .select('id, kind, created_at, handled_at, detail')
        .eq('loan_id', loanId)
        .in('kind', ASK_EVENTS)
        .order('created_at', { ascending: false })
        .limit(10)
      if (r.error) return null
      return (r.data as { id: string; kind: string; created_at: string; handled_at: string | null; detail: { goal?: string } | null }[]).map((e) => ({
        id: e.id,
        kind: e.kind.replace(/_requested$/, '') as MyHomeAskKind,
        createdAt: e.created_at,
        handledAt: e.handled_at,
        goal: e.detail?.goal ?? null,
      }))
    },
  })
}

/** Marks an ask done (handle_myhome_ask()); with a value, first saves it on the home (dated by the database). */
export function useHandleMyHomeAsk(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { askId: string; homeId?: string; value?: number }) => {
      if (v.homeId && v.value != null) unwrap(await db().from('properties').update({ estimated_value: v.value }).eq('id', v.homeId).select('id'))
      unwrap(await db().rpc('handle_myhome_ask', { p_event: v.askId }))
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: asksKey(loanId) })
      queryClient.invalidateQueries({ queryKey: ['closedLoans'] })
      queryClient.invalidateQueries({ queryKey: ['properties', loanId] })
    },
  })
}

/** Extra payments the borrower logged in MyHome on this loan (not removed), oldest first. Null before the script. */
export function useMyHomeExtraPayments(loanId: string) {
  return useQuery({
    queryKey: ['myhomeExtraPayments', loanId],
    retry: false,
    queryFn: async (): Promise<{ id: string; paidOn: string; amount: number; loggedAt: string }[] | null> => {
      const r = await db().from('myhome_extra_payments').select('id, paid_on, amount, created_at').eq('loan_id', loanId).is('removed_at', null).order('paid_on')
      if (r.error) return null
      return (r.data as { id: string; paid_on: string; amount: number; created_at: string }[]).map((p) => ({ id: p.id, paidOn: p.paid_on, amount: Number(p.amount), loggedAt: p.created_at }))
    },
  })
}

// ---------------------------------------------------------------------------
// Today's MyHome box (nurture goals Phase 4): open asks and goal updates to verify
// ---------------------------------------------------------------------------

export interface MyHomeActivity {
  id: string
  loanId: string
  name: string
  what: string
  at: string
  kind: 'ask' | 'goal'
}

/** What borrowers sent from MyHome that waits for you, on files you can see: open asks and goal updates to verify (newest first). */
export function useMyHomeActivity() {
  return useQuery({
    queryKey: ['myhomeActivity'],
    retry: false,
    refetchInterval: 60_000,
    queryFn: async (): Promise<MyHomeActivity[]> => {
      const since = new Date(Date.now() - 60 * 86_400_000).toISOString()
      const [asks, goals] = await Promise.all([
        db().from('myhome_events').select('id, kind, created_at, loan_id, contact_id, detail').in('kind', ASK_EVENTS).is('handled_at', null).gte('created_at', since).order('created_at', { ascending: false }).limit(20),
        db().from('nurture_updates').select('id, loan_id, contact_id, summary, created_at').eq('source', 'myhome').eq('status', 'unverified').order('created_at', { ascending: false }).limit(20),
      ])
      const a = asks.error ? [] : (asks.data as { id: string; kind: string; created_at: string; loan_id: string | null; contact_id: string; detail: { goal?: string } | null }[]).filter((x) => x.loan_id)
      const g = goals.error ? [] : (goals.data as { id: string; loan_id: string; contact_id: string | null; summary: string | null; created_at: string }[])
      const ids = [...new Set([...a.map((x) => x.contact_id), ...g.map((x) => x.contact_id).filter((x): x is string => !!x)])]
      const people = ids.length ? (((await db().from('contacts').select('id, first_name, last_name').in('id', ids)).data ?? []) as { id: string; first_name: string; last_name: string | null }[]) : []
      const nameOf = (id: string | null) => {
        const p = people.find((x) => x.id === id)
        return p ? [p.first_name, p.last_name].filter(Boolean).join(' ') : 'A borrower'
      }
      return [
        ...a.map((x) => ({ id: x.id, loanId: x.loan_id!, name: nameOf(x.contact_id), what: askLabel({ kind: x.kind.replace(/_requested$/, '') as MyHomeAskKind, goal: x.detail?.goal ?? null }), at: x.created_at, kind: 'ask' as const })),
        // The summary starts with the person's name ("Maya TEST added $700 to savings…"); show what they did.
        ...g.map((x) => {
          const name = nameOf(x.contact_id)
          const full = x.summary ?? 'Sent a goal update'
          const s = full.startsWith(`${name} `) ? full.slice(name.length + 1) : full
          return { id: x.id, loanId: x.loan_id, name, what: s.charAt(0).toUpperCase() + s.slice(1), at: x.created_at, kind: 'goal' as const }
        }),
      ].sort((p, q) => q.at.localeCompare(p.at))
    },
  })
}
