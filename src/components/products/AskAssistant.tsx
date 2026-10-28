import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { BookOpenIcon, ExternalLinkIcon, MessageSquareIcon, PlusIcon, SearchIcon, SparklesIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { AiOffNote, Card, confirmAction } from '@/components/shared'
import { useAiStatus } from '@/lib/api/assistant'
import { keys } from '@/lib/api/client'
import { openGuidelinePdf, useLogSearch } from '@/lib/api/products'
import { answerFromGuidelines, findPassages, readScenario, saveChatMessages, useAssistantChats, useAssistantUsage, useDeleteChat, type NewChatMessage } from '@/lib/api/productAssistant'
import { relativeTime } from '@/lib/dates'
import { applyReading, readChips, resultSummary, type ResultSummary } from '@/lib/products/assistant'
import { search } from '@/lib/products/engine'
import { scenarioLabel } from '@/lib/products/scenarioForm'
import type { Catalog, Scenario } from '@/lib/products/types'
import type { GuidelineAnswer } from '../../../supabase/functions/assistant/guidelineAnswer'
import { NOT_COVERED } from '../../../supabase/functions/assistant/guidelineAnswer'
import type { ScenarioReading } from '../../../supabase/functions/assistant/scenarioRead'

/** What a cited passage needs on screen (kept in the saved chat). */
interface CitedPassage {
  id: string
  lenderName: string
  documentTitle: string
  page: number
  sectionNumber: string | null
  storagePath: string | null
}

type Item =
  | { key: string; role: 'user'; kind: 'text'; body: string }
  | { key: string; role: 'assistant'; kind: 'scenario'; body: string; data: { reading: ScenarioReading; scenario: Scenario } }
  | { key: string; role: 'assistant'; kind: 'results'; body: string; data: { summary: ResultSummary; scenario: Scenario; programIds: string[] } }
  | { key: string; role: 'assistant'; kind: 'answer'; body: string; data: { answer: GuidelineAnswer; passages: CitedPassage[]; scope: string; noAi?: boolean } }
  | { key: string; role: 'assistant'; kind: 'error'; body: string }

const EXAMPLES = ['DSCR closed-end second, investment SFR in Frisco worth $500k, owes $250k, wants $100k, 740 FICO', 'Conventional purchase, $450k, 5% down, 720, primary SFR, first-time buyer']

interface Props {
  catalog: Catalog
  loanId: string | null
  organizationId: string | null
  borrowerName: string | null
  /** Where a reading starts from: the borrower file, or a blank form. */
  start: Scenario
  /** Opens the scenario in the search form, or straight to its full results. */
  onOpenInForm: (s: Scenario, results: boolean) => void
  onAdd?: (programIds: string[]) => void
  adding?: boolean
}

/** Ask the assistant (mockup 02): type the scenario, check what it read, and the same rule-based search runs. Guideline questions are answered from the lenders' text with citations. */
export function AskAssistant({ catalog, loanId, organizationId, borrowerName, start, onOpenInForm, onAdd, adding }: Props) {
  const [chatId, setChatId] = useState<string>(() => crypto.randomUUID())
  const [items, setItems] = useState<Item[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState<'read' | 'ask' | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const logSearch = useLogSearch()
  const chats = useAssistantChats(loanId)
  const deleteChat = useDeleteChat(loanId ?? '')
  const usage = useAssistantUsage()
  const ai = useAiStatus()
  const aiOff = ai.data?.ready === false
  const queryClient = useQueryClient()

  const lastScenario = [...items].reverse().find((i): i is Extract<Item, { kind: 'results' }> => i.kind === 'results')
  const hasSearch = !!lastScenario
  const key = () => crypto.randomUUID()

  /** Shows the new messages and, on a borrower file, saves them to its chat. */
  const add = async (next: Item[], links: { aiRunId?: string | null; searchId?: string | null } = {}) => {
    setItems((old) => [...old, ...next])
    if (!loanId || !organizationId) return
    const saved: NewChatMessage[] = next
      .filter((i) => i.kind !== 'error')
      .map((i) => ({ chatId, role: i.role, kind: i.kind as NewChatMessage['kind'], body: i.body, data: 'data' in i ? (i.data as unknown as Record<string, unknown>) : {}, aiRunId: i.role === 'assistant' ? (links.aiRunId ?? null) : null, searchId: i.kind === 'results' ? (links.searchId ?? null) : null }))
    try {
      await saveChatMessages(loanId, organizationId, saved)
      queryClient.invalidateQueries({ queryKey: keys.assistantChats(loanId) })
    } catch (e) {
      toast.error(`Couldn't save the chat on the file: ${(e as Error).message}`)
    }
  }
  const fail = (e: unknown) => setItems((old) => [...old, { key: key(), role: 'assistant', kind: 'error', body: (e as Error).message }])

  const find = async () => {
    const sentence = text.trim()
    if (!sentence) return
    setText('')
    setBusy('read')
    const asked: Item = { key: key(), role: 'user', kind: 'text', body: sentence }
    try {
      const { reading, runId } = await readScenario(sentence, loanId)
      // A follow-up sentence refines the last search.
      const scenario = applyReading(lastScenario?.data.scenario ?? start, reading.read)
      const result = search(scenario, catalog)
      const summary = resultSummary(scenario, result)
      const searchId = await logSearch.mutateAsync({ scenario, result, loanId, source: 'assistant' }).catch(() => null)
      setSelected([])
      await add(
        [
          asked,
          { key: key(), role: 'assistant', kind: 'scenario', body: 'I read this as', data: { reading, scenario } },
          { key: key(), role: 'assistant', kind: 'results', body: `${result.eligible.length} program${result.eligible.length === 1 ? '' : 's'} fit`, data: { summary, scenario, programIds: result.eligible.map((r) => r.program.id) } },
        ],
        { aiRunId: runId, searchId },
      )
    } catch (e) {
      setItems((old) => [...old, asked])
      fail(e)
    } finally {
      setBusy(null)
      usage.refetch()
    }
  }

  const ask = async () => {
    const question = text.trim()
    if (!question) return
    setText('')
    setBusy('ask')
    const asked: Item = { key: key(), role: 'user', kind: 'text', body: question }
    // Questions are about the programs that fit the last search, or every lender's guidelines before a search.
    const programIds = lastScenario?.data.programIds ?? []
    const scope = programIds.length ? `the ${programIds.length} program${programIds.length === 1 ? '' : 's'} that fit` : "every lender's guidelines"
    try {
      const found = await findPassages(question, programIds)
      const passages: CitedPassage[] = found.map((p) => ({ id: p.id, lenderName: p.lenderName, documentTitle: p.documentTitle, page: p.page, sectionNumber: p.sectionNumber, storagePath: p.storagePath }))
      if (found.length === 0) {
        // Nothing to quote: say so without spending an AI call.
        await add([asked, { key: key(), role: 'assistant', kind: 'answer', body: NOT_COVERED, data: { answer: { covered: false, answer: NOT_COVERED, citations: [] }, passages: [], scope, noAi: true } }])
        return
      }
      const { answer, runId } = await answerFromGuidelines(question, found.map((p) => p.id), loanId, lastScenario ? scenarioLabel(lastScenario.data.scenario) : null)
      await add([asked, { key: key(), role: 'assistant', kind: 'answer', body: answer.answer, data: { answer, passages: passages.filter((p) => answer.citations.some((c) => c.passageId === p.id)), scope } }], { aiRunId: runId })
    } catch (e) {
      setItems((old) => [...old, asked])
      fail(e)
    } finally {
      setBusy(null)
      usage.refetch()
    }
  }

  const newChat = () => {
    setChatId(crypto.randomUUID())
    setItems([])
    setSelected([])
  }
  const openChat = (id: string) => {
    const saved = (chats.data ?? []).filter((m) => m.chatId === id)
    setChatId(id)
    setSelected([])
    setItems(saved.map((m) => ({ key: m.id, role: m.role, kind: m.kind, body: m.body, data: m.data }) as Item))
  }
  const savedChats = Object.values(
    (chats.data ?? []).reduce<Record<string, { id: string; first: string; at: string; count: number }>>((acc, m) => {
      acc[m.chatId] ??= { id: m.chatId, first: m.body, at: m.createdAt, count: 0 }
      acc[m.chatId].count++
      return acc
    }, {}),
  ).reverse()

  const primary = hasSearch ? ask : find

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
      <Card contentClassName="flex min-h-[540px] flex-col gap-4">
        <div className="flex-1 space-y-4">
          {aiOff && (
            <div className="space-y-2">
              <AiOffNote what="Ask the assistant" reason={ai.data?.reason} instead={<>Until then, Search by parameters does the same search with no AI, and each program's details have a guideline text search.{loanId ? ' Saved chats on this file still open.' : ''}</>} />
              <Button size="sm" variant="outline" onClick={() => onOpenInForm(start, false)}>
                <SearchIcon />
                Search by parameters
              </Button>
            </div>
          )}
          {items.length === 0 && !aiOff && (
            <div className="space-y-3 py-6 text-center">
              <SparklesIcon className="mx-auto size-6 text-primary" />
              <p className="font-medium">Describe the scenario in plain English</p>
              <p className="mx-auto max-w-md text-sm text-muted-foreground">
                The assistant only reads your sentence into the search form. You check what it read, and the same rule-based search as the form runs. Then ask guideline questions; answers quote the lender with page numbers.
              </p>
              <div className="flex flex-wrap justify-center gap-2 pt-1">
                {EXAMPLES.map((e) => (
                  <button key={e} type="button" onClick={() => setText(e)} className="rounded-full border px-3 py-1 text-left text-xs text-muted-foreground hover:bg-muted">
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}
          {items.map((item) => (
            <Message key={item.key} item={item} selected={selected} onSelect={setSelected} onOpenInForm={onOpenInForm} />
          ))}
          {busy && <p className="text-sm text-muted-foreground">{busy === 'read' ? 'Reading your scenario…' : 'Looking through the guidelines…'}</p>}
        </div>

        {selected.length > 0 && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">
            <span className="mr-auto">{selected.length} selected</span>
            {onAdd && borrowerName ? (
              <Button size="sm" variant="secondary" disabled={adding} onClick={() => onAdd(selected)}>
                {adding ? 'Adding…' : `Add to ${borrowerName} for pricing →`}
              </Button>
            ) : (
              <span className="text-xs opacity-80">Start from a borrower to add these for pricing.</span>
            )}
          </div>
        )}

        <div className="space-y-2 border-t pt-3">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                if (!busy && !aiOff) primary()
              }
            }}
            rows={2}
            maxLength={1000}
            placeholder={hasSearch ? 'Ask about the guidelines (e.g. “Can it close in an LLC?”), or describe a change to the scenario' : 'e.g. DSCR closed-end second, investment SFR in Frisco, worth $500k, owes $250k, 740'}
            className="w-full resize-none rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="flex flex-wrap justify-end gap-2">
            <Button size="sm" variant={hasSearch ? 'outline' : 'default'} disabled={!!busy || !text.trim() || aiOff} onClick={find}>
              <SearchIcon />
              {hasSearch ? 'Change the scenario' : 'Find programs'}
            </Button>
            <Button size="sm" variant={hasSearch ? 'default' : 'outline'} disabled={!!busy || !text.trim() || aiOff} onClick={ask}>
              <BookOpenIcon />
              Ask the guidelines
            </Button>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        {loanId && (
          <Card
            title="Chats on this file"
            action={
              <Button size="xs" variant="ghost" onClick={newChat}>
                <PlusIcon />
                New
              </Button>
            }
          >
            {savedChats.length === 0 ? (
              <p className="text-sm text-muted-foreground">Chats you start from {borrowerName ?? 'this borrower'} are saved here.</p>
            ) : (
              <ul className="space-y-2">
                {savedChats.map((c) => (
                  <li key={c.id} className="flex items-start gap-2">
                    <button type="button" className={cn('min-w-0 flex-1 text-left', c.id === chatId && 'font-medium text-primary')} onClick={() => openChat(c.id)}>
                      <span className="flex items-center gap-1.5 text-sm">
                        <MessageSquareIcon className="size-3.5 shrink-0" />
                        <span className="truncate">{c.first}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">{relativeTime(c.at)}</span>
                    </button>
                    <button
                      type="button"
                      aria-label="Delete chat"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={async () => (await confirmAction('Delete this chat from the file?', { confirmLabel: 'Delete', destructive: true })) && deleteChat.mutate(c.id, { onSuccess: () => c.id === chatId && newChat(), onError: (e) => toast.error(e.message) })}
                    >
                      <Trash2Icon className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        )}
        <Card title="Usage this month">
          <dl className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-xs text-muted-foreground">AI messages</dt>
              <dd className="text-lg font-semibold tabular-nums">{usage.data?.aiMessages ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Searches (no AI)</dt>
              <dd className="text-lg font-semibold tabular-nums">{usage.data?.freeSearches ?? '—'}</dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">Reading a sentence and answering a guideline question each use one AI message. The search itself never does.</p>
        </Card>
      </div>
    </div>
  )
}

function Message({ item, selected, onSelect, onOpenInForm }: { item: Item; selected: string[]; onSelect: (ids: string[]) => void; onOpenInForm: (s: Scenario, results: boolean) => void }) {
  if (item.kind === 'text') return <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">{item.body}</p>
  if (item.kind === 'error') return <p className="w-fit max-w-[85%] rounded-2xl rounded-bl-sm bg-destructive/10 px-4 py-2 text-sm text-destructive">{item.body}</p>

  if (item.kind === 'scenario') {
    const { reading, scenario } = item.data
    const chips = readChips(reading.read, reading.evidence)
    return (
      <div className="max-w-[92%] space-y-2 rounded-2xl rounded-bl-sm bg-muted px-4 py-3">
        <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">I read this as</p>
        <div className="flex flex-wrap gap-1.5">
          {chips.map((c) => (
            <span key={c.field} title={c.words ? `From “${c.words}”${c.check ? ' (not found word for word: check it)' : ''}` : undefined} className={cn('rounded-full border bg-card px-2.5 py-0.5 text-xs', c.check && 'border-amber-400 bg-amber-50 text-amber-900')}>
              {c.text}
              {c.check && ' ?'}
            </span>
          ))}
        </div>
        {reading.unclear.length > 0 && (
          <ul className="space-y-0.5 text-xs text-amber-900">
            {reading.unclear.map((q) => (
              <li key={q}>• {q}</li>
            ))}
          </ul>
        )}
        <button type="button" onClick={() => onOpenInForm(scenario, false)} className="text-xs font-medium text-primary hover:underline">
          Wrong? Edit it in the form →
        </button>
      </div>
    )
  }

  if (item.kind === 'results') {
    const { summary } = item.data
    const toggle = (id: string, on: boolean) => onSelect(on ? [...selected, id] : selected.filter((x) => x !== id))
    return (
      <div className="max-w-[92%] space-y-3 rounded-2xl rounded-bl-sm border px-4 py-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {summary.typeChips.map((c) => (
            <span key={c} className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">
              {c}
            </span>
          ))}
          <span className="text-xs text-muted-foreground">{summary.scenarioChips.join(' · ')}</span>
        </div>
        <p className="text-sm font-semibold">{item.body}</p>
        {summary.fits.length > 0 && (
          <ul className="space-y-1.5">
            {summary.fits.map((l) => (
              <li key={l.programId} className="flex items-start gap-2 text-sm">
                <input type="checkbox" aria-label={`Select ${l.lender} ${l.program}`} className="mt-1" checked={selected.includes(l.programId)} onChange={(e) => toggle(l.programId, e.target.checked)} />
                <span className="min-w-0 flex-1">
                  <span className="mr-1.5 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">Fits</span>
                  <span className="font-medium">{l.lender}</span> · {l.program}
                  {l.notSignedUp && <span className="ml-1.5 text-xs text-amber-700">Not signed up</span>}
                  <span className="block text-xs text-muted-foreground">{l.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        {summary.close.length > 0 && (
          <ul className="space-y-1.5">
            {summary.close.map((l) => (
              <li key={l.programId} className="text-sm">
                <span className="mr-1.5 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-800">Close</span>
                <span className="font-medium">{l.lender}</span> · {l.program}
                <span className="block text-xs text-destructive">{l.detail}</span>
                {l.fix && <span className="block text-xs text-emerald-700">To fit: {l.fix}</span>}
              </li>
            ))}
          </ul>
        )}
        {summary.notSearched && <p className="text-xs text-muted-foreground">{summary.notSearched}</p>}
        <button type="button" onClick={() => onOpenInForm(item.data.scenario, true)} className="text-xs font-medium text-primary hover:underline">
          See full results and details →
        </button>
      </div>
    )
  }

  const { answer, passages, scope, noAi } = item.data
  return (
    <div className="max-w-[92%] space-y-3 rounded-2xl rounded-bl-sm bg-muted px-4 py-3">
      <p className="text-sm whitespace-pre-line">{answer.answer}</p>
      {answer.citations.map((c, i) => {
        const p = passages.find((x) => x.id === c.passageId)
        return (
          <figure key={i} className="rounded-lg border-l-4 border-primary bg-card px-3 py-2">
            <blockquote className="text-sm italic">“{c.quote}”</blockquote>
            {p && (
              <figcaption className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                <span>
                  {p.lenderName} · {p.documentTitle}
                  {p.sectionNumber ? ` §${p.sectionNumber}` : ''} · p.{p.page}
                </span>
                {p.storagePath && (
                  <button type="button" className="inline-flex items-center gap-1 font-medium text-primary hover:underline" onClick={() => openGuidelinePdf(p.storagePath!, p.page).catch((e: Error) => toast.error(e.message))}>
                    <ExternalLinkIcon className="size-3" />
                    Open guideline at p.{p.page}
                  </button>
                )}
              </figcaption>
            )}
          </figure>
        )
      })}
      <p className="text-[11px] text-muted-foreground">
        Searched {scope}.{noAi ? ' No matching text, so no AI was used.' : ''}
      </p>
    </div>
  )
}
