import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { useAuth } from '@/lib/auth/context'
import { db, keys, unwrap } from './client'

export type MessageChannel = 'text' | 'email'

export interface MessageTemplate {
  id: string
  name: string
  channel: MessageChannel
  subject: string | null
  body: string
}

const TEMPLATE_SELECT = 'id, name, channel, subject, body'

/** Connor's saved texts and emails, which the assistant personalizes. */
export function useMessageTemplates() {
  return useQuery({
    queryKey: keys.templates,
    queryFn: async () => unwrap<MessageTemplate[]>(await db().from('message_templates').select(TEMPLATE_SELECT).order('name')),
  })
}

export type TemplateDraft = Omit<MessageTemplate, 'id'> & { id: string | null }

export function useSaveTemplate() {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useMutation({
    mutationFn: async (t: TemplateDraft) => {
      const row = { name: t.name.trim(), channel: t.channel, subject: t.channel === 'email' ? t.subject?.trim() || null : null, body: t.body.trim() }
      if (!row.name || !row.body) throw new Error('A template needs a name and a message.')
      if (t.channel === 'email' && !row.subject) throw new Error('An email template needs a subject.')
      const result = t.id ? await db().from('message_templates').update(row).eq('id', t.id).select('id') : await db().from('message_templates').insert({ ...row, organization_id: orgId }).select('id')
      if (result.error?.code === '23505') throw new Error('A template with that name already exists.')
      if (unwrap<{ id: string }[]>(result).length === 0) throw new Error('You do not have permission to change this template.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.templates }),
  })
}

export function useDeleteTemplate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await db().from('message_templates').delete().eq('id', id).select('id'))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.templates }),
  })
}

export interface FollowUpAsk {
  channel: MessageChannel
  templateId: string | null
  instructions: string | null
}

export interface AiStatus {
  ready: boolean
  /** Why not: the Anthropic key isn't added yet, or the function can't be reached. */
  reason?: 'no_key' | 'unreachable'
}

/**
 * Whether AI features can run. The Anthropic key will be added later
 * (Connor, 2026-10-27), so every AI button asks this first and, when it's
 * not ready, points to the way to do the job without AI. Asked once a
 * session; no AI call is made.
 */
export function useAiStatus() {
  return useQuery({
    queryKey: keys.aiStatus,
    staleTime: 10 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<AiStatus> => {
      const { error } = await db().functions.invoke('assistant', { body: { task: 'status' } })
      if (!error) return { ready: true }
      if (error instanceof FunctionsHttpError) {
        const detail = await error.context.json().catch(() => null)
        // Any other answer means the key is there (an older deploy doesn't know "status").
        return String(detail?.error ?? '').includes('not set up yet') ? { ready: false, reason: 'no_key' } : { ready: true }
      }
      return { ready: false, reason: 'unreachable' }
    },
  })
}

/** Calls the "assistant" Edge Function. Its errors are plain English, so they're passed through as-is. */
export async function invokeAssistant<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await db().functions.invoke<T>('assistant', { body })
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const detail = await error.context.json().catch(() => null)
      throw new Error(detail?.error ?? fallback)
    }
    throw new Error(error.message.includes('Failed to send') ? 'The assistant is not deployed yet, or the connection failed.' : error.message)
  }
  return data as T
}

/**
 * Asks the assistant to draft a follow-up.
 * The draft lands in this file's Action Queue; nothing is sent.
 */
export function useDraftFollowUp(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (ask: FollowUpAsk) => invokeAssistant<{ actionId: string }>({ task: 'follow_up', loanId, ...ask }, 'The assistant could not draft this message.'),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: keys.queue(loanId) })
      queryClient.invalidateQueries({ queryKey: keys.today })
    },
  })
}
