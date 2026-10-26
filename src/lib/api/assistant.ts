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

/**
 * Asks the assistant (the "assistant" Edge Function) to draft a follow-up.
 * The draft lands in this file's Action Queue; nothing is sent.
 */
export function useDraftFollowUp(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (ask: FollowUpAsk) => {
      const { data, error } = await db().functions.invoke<{ actionId: string }>('assistant', { body: { task: 'follow_up', loanId, ...ask } })
      if (error) {
        // The function explains what went wrong in plain English; show that.
        if (error instanceof FunctionsHttpError) {
          const detail = await error.context.json().catch(() => null)
          throw new Error(detail?.error ?? 'The assistant could not draft this message.')
        }
        throw new Error(error.message.includes('Failed to send') ? 'The assistant is not deployed yet, or the connection failed.' : error.message)
      }
      return data
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: keys.queue(loanId) })
      queryClient.invalidateQueries({ queryKey: keys.today })
    },
  })
}
