import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { GuidelineAnswer } from '../../../supabase/functions/assistant/guidelineAnswer'
import type { ScenarioReading } from '../../../supabase/functions/assistant/scenarioRead'
import { questionQuery, rankPassages } from '@/lib/products/assistant'
import { invokeAssistant } from './assistant'
import { db, keys, unwrap } from './client'

/** Asks the assistant (Sonnet) to read a scenario sentence. Nothing is searched by AI. */
export function readScenario(sentence: string, loanId: string | null) {
  return invokeAssistant<{ reading: ScenarioReading; runId: string }>({ task: 'scenario_read', sentence, loanId }, 'The assistant could not read that.')
}

/** A guideline passage found for a question, with what's needed to cite it and open its PDF. */
export interface FoundPassage {
  id: string
  page: number
  sectionNumber: string | null
  heading: string | null
  body: string
  documentTitle: string
  storagePath: string | null
  lenderName: string
}

/** The most passages a question is answered from. */
export const PASSAGES_PER_QUESTION = 8

interface FoundRow {
  id: string
  page: number
  section_number: string | null
  heading: string | null
  body: string
  document: { title: string; storage_path: string | null; current: boolean; lender: { name: string } | null } | null
}

/**
 * The guideline passages that best match a question, from these programs'
 * current documents (or every lender's when none are given). Full-text
 * search, ranked here; no AI.
 */
export async function findPassages(question: string, programIds: string[]): Promise<FoundPassage[]> {
  const tsquery = questionQuery(question)
  if (!tsquery) return []
  let documentIds: string[] | null = null
  if (programIds.length) {
    const links = unwrap<{ document_id: string }[]>(await db().from('guideline_document_programs').select('document_id').in('program_id', programIds))
    documentIds = [...new Set(links.map((l) => l.document_id))]
    if (!documentIds.length) return []
  }
  let query = db()
    .from('guideline_passages')
    .select('id, page, section_number, heading, body, document:guideline_documents!inner(title, storage_path, current, lender:lenders(name))')
    .eq('document.current', true)
    .textSearch('search', tsquery, { config: 'english' })
  if (documentIds) query = query.in('document_id', documentIds)
  const rows = unwrap<FoundRow[]>(await query.limit(80))
  return rankPassages(question, rows, PASSAGES_PER_QUESTION).map((r) => ({
    id: r.id,
    page: r.page,
    sectionNumber: r.section_number,
    heading: r.heading,
    body: r.body,
    documentTitle: r.document?.title ?? 'Guidelines',
    storagePath: r.document?.storage_path ?? null,
    lenderName: r.document?.lender?.name ?? 'Unknown lender',
  }))
}

/** Asks the assistant (Opus) to answer from these passages only, quoting them. */
export function answerFromGuidelines(question: string, passageIds: string[], loanId: string | null, scenario: string | null) {
  return invokeAssistant<{ answer: GuidelineAnswer; runId: string }>({ task: 'guideline_answer', question, passageIds, loanId, scenario }, 'The assistant could not answer that.')
}

// ---------------------------------------------------------------------------
// Chats saved on a borrower file
// ---------------------------------------------------------------------------

export type ChatKind = 'text' | 'scenario' | 'results' | 'answer'

export interface ChatMessage {
  id: string
  chatId: string
  role: 'user' | 'assistant'
  kind: ChatKind
  body: string
  data: Record<string, unknown>
  aiRunId: string | null
  searchId: string | null
  createdAt: string
}

interface ChatRow {
  id: string
  chat_id: string
  role: ChatMessage['role']
  kind: ChatKind
  body: string
  data: Record<string, unknown>
  ai_run_id: string | null
  search_id: string | null
  created_at: string
}

/** Every saved chat message on a file, oldest first. */
export function useAssistantChats(loanId: string | null) {
  return useQuery({
    queryKey: keys.assistantChats(loanId ?? ''),
    enabled: !!loanId,
    queryFn: async () =>
      unwrap<ChatRow[]>(await db().from('assistant_messages').select('id, chat_id, role, kind, body, data, ai_run_id, search_id, created_at').eq('loan_id', loanId!).order('created_at')).map(
        (r): ChatMessage => ({ id: r.id, chatId: r.chat_id, role: r.role, kind: r.kind, body: r.body, data: r.data, aiRunId: r.ai_run_id, searchId: r.search_id, createdAt: r.created_at }),
      ),
  })
}

export type NewChatMessage = Omit<ChatMessage, 'id' | 'createdAt'>

/** Saves messages to a file's chat (they're never edited afterwards). */
export async function saveChatMessages(loanId: string, organizationId: string, messages: NewChatMessage[]) {
  if (!messages.length) return
  unwrap(
    await db()
      .from('assistant_messages')
      .insert(messages.map((m) => ({ organization_id: organizationId, loan_id: loanId, chat_id: m.chatId, role: m.role, kind: m.kind, body: m.body, data: m.data, ai_run_id: m.aiRunId, search_id: m.searchId })))
      .select('id'),
  )
}

export function useDeleteChat(loanId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (chatId: string) => {
      unwrap(await db().from('assistant_messages').delete().eq('loan_id', loanId).eq('chat_id', chatId).select('id'))
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.assistantChats(loanId) }),
  })
}

// ---------------------------------------------------------------------------
// Usage: AI messages vs free searches this month
// ---------------------------------------------------------------------------

export interface AssistantUsage {
  aiMessages: number
  freeSearches: number
}

/** This month (Dallas time): assistant AI calls, and searches that used no AI. */
export function useAssistantUsage() {
  return useQuery({
    queryKey: keys.assistantUsage,
    queryFn: async (): Promise<AssistantUsage> => {
      const month = `${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit' }).format(new Date())}-01T00:00:00-06:00`
      const [ai, searches] = await Promise.all([
        db().from('ai_runs').select('id', { count: 'exact', head: true }).in('task_type', ['scenario_read', 'guideline_answer']).gte('created_at', month),
        db().from('product_searches').select('id', { count: 'exact', head: true }).gte('created_at', month),
      ])
      if (ai.error) throw new Error(ai.error.message)
      if (searches.error) throw new Error(searches.error.message)
      return { aiMessages: ai.count ?? 0, freeSearches: searches.count ?? 0 }
    },
  })
}
