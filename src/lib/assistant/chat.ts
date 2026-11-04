// The Loan Officer Assistant's chat (Phase 1). One turn: save what was said,
// ask the assistant-chat Edge Function, and whenever Claude asks for a tool,
// run it here in the browser as the signed-in person (readTools.ts: the
// app's own queries, so a loan officer only ever reaches their own files),
// log it in assistant_actions, send the result back, and repeat until Claude
// answers. The answer and its cards are saved in assistant_chat_messages.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FunctionsHttpError } from '@supabase/supabase-js'
import { db, unwrap } from '@/lib/api/client'
import { STAGES } from '@/lib/pipeline/stages'
import { isCard, type AssistantCard } from './cards'
import { getBorrowerSummary, READ_TOOL_RUNNERS } from './readTools'

/** Tool rounds in one turn before the assistant has to answer. */
const MAX_ROUNDS = 6
/** Earlier messages sent along with a new one. */
const HISTORY_SENT = 20

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  body: string
  cards: AssistantCard[]
  viaVoice: boolean
  createdAt: string
}

const threadKey = (loanId: string | null) => ['assistant', 'thread', loanId ?? 'general'] as const

/** This person's thread: in a file (loanId) or the general one (null), oldest first. */
export function useAssistantThread(loanId: string | null) {
  return useQuery({
    queryKey: threadKey(loanId),
    queryFn: async (): Promise<ChatMessage[]> => {
      let q = db().from('assistant_chat_messages').select('id, role, body, cards, via_voice, created_at').order('created_at', { ascending: false }).limit(100)
      q = loanId ? q.eq('loan_id', loanId) : q.is('loan_id', null)
      const rows = unwrap<{ id: string; role: 'user' | 'assistant'; body: string; cards: unknown; via_voice: boolean; created_at: string }[]>(await q)
      return rows.reverse().map((r) => ({ id: r.id, role: r.role, body: r.body, cards: Array.isArray(r.cards) ? r.cards.filter(isCard) : [], viaVoice: r.via_voice, createdAt: r.created_at }))
    },
  })
}

export function useClearThread(loanId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async () => {
      let q = db().from('assistant_chat_messages').delete()
      q = loanId ? q.eq('loan_id', loanId) : q.is('loan_id', null)
      unwrap(await q)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: threadKey(loanId) }),
  })
}

/** A problem with a clear message for the person (the key isn't set, the session ran out, …). */
export class AssistantError extends Error {
  readonly code: string | null
  constructor(message: string, code: string | null = null) {
    super(message)
    this.code = code
  }
}

type Block = { type: string; [k: string]: unknown }
type ApiMessage = { role: 'user' | 'assistant'; content: string | Block[] }

/** What earlier messages say, as plain text for the model (cards become one line each). */
function historyText(m: ChatMessage): string {
  const cards = m.cards.map((c) =>
    c.type === 'borrowers'
      ? `[Showed a list: ${c.title}: ${c.items.slice(0, 15).map((i) => `${i.name} (loan ${i.loanId})`).join(', ')}]`
      : c.type === 'summary'
        ? `[Showed ${c.name}'s summary (loan ${c.loanId}): ${c.status}]`
        : c.type === 'estimates'
          ? `[Showed ${c.items.length} Fee Estimates for loan ${c.loanId}]`
          : `[Asked: ${c.question}]`,
  )
  return [m.body, ...cards].filter(Boolean).join('\n') || '(no text)'
}

async function ask(body: Record<string, unknown>): Promise<{ content: Block[]; stopReason: string }> {
  const { data, error } = await db().functions.invoke<{ content: Block[]; stopReason: string }>('assistant-chat', { body })
  if (error) {
    const detail = error instanceof FunctionsHttpError ? await error.context.json().catch(() => null) : null
    if (['no_key', 'bad_key', 'no_credit', 'busy'].includes(detail?.code)) throw new AssistantError(detail.error, detail.code)
    if (!(error instanceof FunctionsHttpError)) throw new AssistantError('The assistant isn\'t reachable. If it was just added, the assistant-chat function may not be deployed yet.', 'unreachable')
    throw new AssistantError(detail?.error ?? 'The assistant could not answer just now.')
  }
  return data!
}

export interface TurnInput {
  organizationId: string
  loanId: string | null
  borrowerName: string | null
  history: ChatMessage[]
  text: string
  viaVoice: boolean
  onWorking?: (what: string) => void
}

const WORKING: Record<string, string> = {
  find_borrower: 'Finding the borrower…',
  get_borrower_summary: 'Reading the file…',
  list_borrowers: 'Looking through your files…',
  list_estimates: 'Reading the Fee Estimates…',
}

/** Runs one turn and saves both sides. Returns the assistant's saved message. */
export async function runTurn(t: TurnInput): Promise<void> {
  const saveMessage = async (role: 'user' | 'assistant', body: string, cards: AssistantCard[], viaVoice = false) =>
    unwrap(await db().from('assistant_chat_messages').insert({ organization_id: t.organizationId, loan_id: t.loanId, role, body, cards, via_voice: viaVoice }).select('id'))
  await saveMessage('user', t.text, [], t.viaVoice)

  // The file the chat is in, summarized with the same read the get_borrower_summary tool uses.
  let summary = ''
  if (t.loanId) {
    const s = await getBorrowerSummary({ loan_id: t.loanId }).catch(() => null)
    summary = s ? JSON.stringify(s.result).slice(0, 4000) : ''
  }
  const messages: ApiMessage[] = [...t.history.slice(-HISTORY_SENT).map((m) => ({ role: m.role, content: historyText(m) })), { role: 'user', content: t.text }]
  // The API wants turns to alternate and start with the person: merge neighbours from the same side.
  const merged: ApiMessage[] = []
  for (const m of messages) {
    const prev = merged[merged.length - 1]
    if (prev && prev.role === m.role && typeof prev.content === 'string' && typeof m.content === 'string') prev.content = `${prev.content}\n\n${m.content}`
    else merged.push({ ...m })
  }
  while (merged.length && merged[0].role !== 'user') merged.shift()

  const cards: AssistantCard[] = []
  const texts: string[] = []
  for (let round = 0; round < MAX_ROUNDS; round++) {
    t.onWorking?.(round === 0 ? 'Thinking…' : 'Putting it together…')
    const res = await ask({
      organizationId: t.organizationId,
      page: t.loanId ? { loanId: t.loanId, borrowerName: t.borrowerName, summary } : {},
      stages: STAGES.map((s) => ({ id: s.value, label: s.label })),
      messages: merged,
    })
    const said = res.content.filter((b) => b.type === 'text').map((b) => String(b.text ?? '').trim()).filter(Boolean)
    texts.push(...said)
    const calls = res.content.filter((b) => b.type === 'tool_use')
    if (res.stopReason !== 'tool_use' || !calls.length) break

    merged.push({ role: 'assistant', content: res.content })
    const results: Block[] = []
    for (const call of calls) {
      const tool = String(call.name)
      const input = (call.input ?? {}) as Record<string, unknown>
      t.onWorking?.(WORKING[tool] ?? 'Working…')
      const runner = READ_TOOL_RUNNERS[tool]
      let content: string
      let isError = false
      try {
        if (!runner) throw new Error(`The tool ${tool} isn't available yet.`)
        const out = await runner(input)
        if (out.card) cards.push(out.card)
        content = typeof out.result === 'string' ? out.result : JSON.stringify(out.result)
        await db().from('assistant_actions').insert({ organization_id: t.organizationId, loan_id: typeof input.loan_id === 'string' ? input.loan_id : t.loanId, tool, inputs: input, result: { size: content.length }, status: 'done' })
      } catch (e) {
        isError = true
        content = (e as Error).message
        await db().from('assistant_actions').insert({ organization_id: t.organizationId, loan_id: t.loanId, tool, inputs: input, status: 'failed', error: content.slice(0, 500) })
      }
      results.push({ type: 'tool_result', tool_use_id: call.id, content: content.slice(0, 30_000), ...(isError ? { is_error: true } : {}) })
    }
    merged.push({ role: 'user', content: results })
  }
  const answer = texts.join('\n\n') || (cards.length ? 'Here you go.' : "I couldn't finish that. Try asking another way.")
  await saveMessage('assistant', answer, cards)
}

export function useSendToAssistant(loanId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: runTurn,
    onSettled: () => queryClient.invalidateQueries({ queryKey: threadKey(loanId) }),
  })
}
