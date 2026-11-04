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
import { CHANGE_TOOL_RUNNERS, undoChange, type ChangeOutput } from './changeTools'
import { getBorrowerSummary, READ_TOOL_RUNNERS } from './readTools'
import { SEND_TOOL_RUNNERS } from './sendTools'

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
          : c.type === 'change'
            ? `[Changed: ${c.title}: ${c.lines.map((l) => `${l.label} ${l.before ? `${l.before} → ` : ''}${l.after}`).join('; ')}]`
            : c.type === 'message'
              ? `[Drafted a ${c.channel} to ${c.name} (shown with Send; not sent by you): ${c.subject ? `${c.subject}: ` : ''}${c.body.slice(0, 200)}]`
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
  create_fee_estimates: 'Pricing Fee Estimates with Smart Fees…',
  update_estimate: 'Updating the Fee Estimate…',
  set_selected_program: 'Selecting it for the file…',
  move_pipeline_stage: 'Moving the stage…',
  update_borrower_fields: 'Updating the file…',
  add_note: 'Adding the note…',
  create_task: 'Adding the task…',
  draft_message: 'Drafting the message…',
}

/** Runs one turn and saves both sides. Says whether anything on a file changed. */
export async function runTurn(t: TurnInput): Promise<{ changed: boolean }> {
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
  let changed = false
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
      const runner = READ_TOOL_RUNNERS[tool] ?? CHANGE_TOOL_RUNNERS[tool] ?? SEND_TOOL_RUNNERS[tool]
      let content: string
      let isError = false
      try {
        if (!runner) throw new Error(`The tool ${tool} isn't available yet.`)
        const out: ChangeOutput = await runner(input)
        content = typeof out.result === 'string' ? out.result : JSON.stringify(out.result)
        const fileId = typeof input.loan_id === 'string' ? input.loan_id : t.loanId
        // A change keeps what Undo needs; its card carries the action's id.
        const logged = unwrap<{ id: string }>(
          await db()
            .from('assistant_actions')
            .insert({ organization_id: t.organizationId, loan_id: fileId, tool, inputs: input, result: out.undo || out.pending ? out.result : { size: content.length }, status: out.pending ? 'pending' : 'done', undo: out.undo ?? null })
            .select('id')
            .single(),
        )
        if (out.undo) changed = true
        if (out.card) cards.push((out.undo || out.pending) && (out.card.type === 'change' || out.card.type === 'estimates' || out.card.type === 'message') ? { ...out.card, actionId: logged.id } : out.card)
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
  return { changed }
}

export function useSendToAssistant(loanId: string | null) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: runTurn,
    // A change shows everywhere at once: the file, the pipeline, estimates.
    onSuccess: (r) => (r.changed ? queryClient.invalidateQueries() : undefined),
    onSettled: () => queryClient.invalidateQueries({ queryKey: threadKey(loanId) }),
  })
}

/** Each change card's action status (done or undone), so Undo shows only once. */
export function useActionStatuses(ids: string[]) {
  const key = [...ids].sort().join(',')
  return useQuery({
    queryKey: ['assistant', 'actions', key],
    enabled: ids.length > 0,
    queryFn: async () => new Map(unwrap<{ id: string; status: string }[]>(await db().from('assistant_actions').select('id, status').in('id', ids)).map((r) => [r.id, r.status])),
  })
}

/** Marks a drafted message sent (with what actually went), from its card's Send. */
export function useMarkAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (v: { id: string; status: 'sent'; result: Record<string, unknown> }) => {
      unwrap(await db().from('assistant_actions').update({ status: v.status, result: v.result }).eq('id', v.id).select('id'))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['assistant', 'actions'] }),
  })
}

/** Undo one change: put back what was there, then mark it undone. */
export function useUndoAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (actionId: string) => {
      const a = unwrap<{ id: string; tool: string; undo: Record<string, unknown> | null; status: string } | null>(await db().from('assistant_actions').select('id, tool, undo, status').eq('id', actionId).maybeSingle())
      if (!a) throw new Error('That change was not found.')
      if (a.status === 'undone') throw new Error('That change was already undone.')
      if (!a.undo) throw new Error("That change can't be undone.")
      await undoChange(a.tool, a.undo)
      unwrap(await db().from('assistant_actions').update({ status: 'undone' }).eq('id', actionId).select('id'))
    },
    onSettled: () => queryClient.invalidateQueries(),
  })
}
