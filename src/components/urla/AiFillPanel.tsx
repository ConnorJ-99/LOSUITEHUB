import { useEffect, useRef, useState } from 'react'
import { Loader2Icon, SparklesIcon, Undo2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { confirmAction } from '@/components/shared'
import type { FillFact, FillQuestion } from '../../../supabase/functions/assistant/summaryFill'
import {
  applyChange,
  markRunUndone,
  readCallNotes,
  saveFillNotes,
  saveRun,
  undoChanges,
  updateRun,
  useRefreshAfterFill,
  type AppliedChange,
} from '@/lib/api/aifill'
import { fillSummary, planFill, type Change, type FieldChange, type FillInput } from '@/lib/aifill/plan'
import { findQuote, NAV_GROUP, SECTION_DOT, SECTION_NAME } from '@/lib/aifill/sections'
import { resetAiFillAnim, setAiFillAnim } from '@/lib/aifill/animStore'
import { groupCounts } from './UrlaSectionNav'
import { AiFillPlayback, type AnimItem } from './AiFillPlayback'
import type { Application } from '@/lib/api/urla'
import type { LoanProfile } from '@/lib/api/types'
import type { UrlaValidation } from '@/lib/loanfile/urla'

const draftKey = (loanId: string) => `mpshq.aifill.draft.${loanId}`
const readDraft = (loanId: string) => {
  try {
    return localStorage.getItem(draftKey(loanId)) ?? ''
  } catch {
    return ''
  }
}
const writeDraft = (loanId: string, text: string) => {
  try {
    if (text.trim()) localStorage.setItem(draftKey(loanId), text)
    else localStorage.removeItem(draftKey(loanId))
  } catch {
    // A private window or blocked storage: the draft just isn't kept.
  }
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date())

/** The last run per file while MPS HQ is open: reopening the panel shows it, with Undo. */
const lastResults = new Map<string, Result>()

interface Result {
  runId: string | null
  applied: AppliedChange[]
  conflicts: FieldChange[]
  questions: FillQuestion[]
  toNotes: string[]
  failed: string[]
  undone: boolean
}

function SectionTag({ section }: { section: FieldChange['section'] }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
      <span className={cn('size-2 rounded-full', SECTION_DOT[section])} />
      {SECTION_NAME(section)}
    </span>
  )
}

const AiTag = () => <span className="shrink-0 rounded bg-red-600 px-1.5 py-0.5 text-[0.625rem] font-bold text-white">AI</span>

/**
 * AI Fill (Connor, 2026-11-19): type or paste call notes, press the red
 * button, and the assistant fills the matching 1003 fields. Empty fields are
 * filled; different values wait for Replace / Keep; unclear items are quick
 * questions; anything with no 1003 place goes to the file's notes. Closed by
 * default; a right-side drawer on a computer, a bottom sheet on a phone.
 */
export function AiFillPanel({
  loan,
  app,
  isPurchase,
  validation,
  onClose,
}: {
  loan: LoanProfile
  app: Application
  isPurchase: boolean
  validation: UrlaValidation | null
  onClose: () => void
}) {
  const [notes, setNotes] = useState(() => readDraft(loan.id))
  const [reading, setReading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [result, setResultState] = useState<Result | null>(() => lastResults.get(loan.id) ?? null)
  const setResult = (r: Result | null) => {
    if (r) lastResults.set(loan.id, r)
    else lastResults.delete(loan.id)
    setResultState(r)
  }
  const primary = app.borrowers.find((b) => b.role === 'primary') ?? app.borrowers[0]
  const refresh = useRefreshAfterFill(loan.id, app.borrowers.map((b) => b.contactId))
  const area = useRef<HTMLTextAreaElement>(null)
  // The latest 1003 check, read after the reload to know where the counts end up.
  const validationRef = useRef(validation)
  validationRef.current = validation
  const [playback, setPlayback] = useState<{ notes: string; items: AnimItem[]; before: Record<string, number>; after: Record<string, number> } | null>(null)

  // Typed notes stay as a draft for this file until they're run or cleared.
  useEffect(() => {
    if (!result) writeDraft(loan.id, notes)
  }, [notes, loan.id, result])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !reading && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, reading])

  useEffect(() => area.current?.focus(), [])

  const input = (): FillInput => ({ app, loan: loan.details, isPurchase, today: today() })

  /** Saves the changes that fill empty fields (and new rows); different values wait for Connor. */
  const applyAll = async (changes: Change[]) => {
    const applied: AppliedChange[] = []
    const failed: string[] = []
    for (const c of changes.filter((x) => x.kind === 'new_row' || !x.conflict)) {
      try {
        applied.push(await applyChange(loan.id, loan.organizationId, c))
      } catch (e) {
        failed.push(`${c.display}: ${(e as Error).message}`)
      }
    }
    return { applied, failed, conflicts: changes.filter((x): x is FieldChange => x.kind === 'field' && x.conflict) }
  }

  const run = async () => {
    const text = notes.trim()
    if (!text) return
    setReading(true)
    // The nav's counts before anything changes, for the tick-down.
    const before = groupCounts(validationRef.current)
    try {
      const r = await readCallNotes(loan.id, text, app)
      const plan = planFill(r.facts, input())
      const { applied, failed, conflicts } = await applyAll(plan.changes)
      const leftovers = [...r.unmapped.map((u) => u.summary), ...plan.toNotes.map((t) => t.text)]
      try {
        await saveFillNotes({ organizationId: loan.organizationId, contactId: primary.contactId, loanId: loan.id, notes: text, leftovers })
      } catch (e) {
        failed.push(`Saving the notes: ${(e as Error).message}`)
      }
      const runId = await saveRun({ organizationId: loan.organizationId, loanId: loan.id, aiRunId: r.runId, notes: text, reading: r, applied })
      if (!runId) toast.warning("The AI fill worked, but its run wasn't saved (run the AI fill runs script). Undo still works until you leave this page.")
      writeDraft(loan.id, '')
      // Hold the nav at its old counts while the 1003 reloads, then play the cards into it.
      if (applied.length) setAiFillAnim({ counts: before, pulse: null })
      await refresh()
      await new Promise((ok) => setTimeout(ok, 80))
      const after = groupCounts(validationRef.current)
      const facts = new Map(r.facts.map((f) => [f.id, f]))
      const items: AnimItem[] = applied.map((a) => {
        const change = plan.changes.find((c) => c.key === a.key)
        const raw = change?.factIds.map((id) => facts.get(id)?.sourceText).find(Boolean) ?? ''
        const section = a.section as AnimItem['section']
        return { key: a.key, section, group: NAV_GROUP[section], raw, range: raw ? findQuote(text, raw) : null, label: a.kind === 'field' ? `${a.label} · ${a.display}` : a.display }
      })
      setResult({ runId, applied, conflicts, questions: r.ambiguous, toNotes: leftovers, failed, undone: false })
      if (items.length) setPlayback({ notes: text, items, before, after })
      else resetAiFillAnim()
      if (!r.facts.length && !r.ambiguous.length) toast.info("The assistant didn't find anything for the 1003 in those notes.")
    } catch (e) {
      resetAiFillAnim()
      toast.error((e as Error).message)
    } finally {
      setReading(false)
    }
  }

  /** Saves more changes on this run (a Replace or an answered question). */
  const addToRun = async (changes: Change[], drop: { conflictKey?: string; questionId?: string }) => {
    if (!result) return
    setBusy(true)
    try {
      const forced = changes.map((c) => (c.kind === 'field' && drop.conflictKey === c.key ? { ...c, conflict: false } : c))
      const { applied, failed, conflicts } = await applyAll(forced)
      const all = [...result.applied, ...applied]
      await updateRun(result.runId, all)
      setResult({
        ...result,
        applied: all,
        failed: [...result.failed, ...failed],
        conflicts: [...result.conflicts.filter((c) => c.key !== drop.conflictKey), ...conflicts],
        questions: result.questions.filter((q) => q.id !== drop.questionId),
      })
      refresh()
    } finally {
      setBusy(false)
    }
  }

  const answer = (q: FillQuestion, i: number) => {
    const choice = q.choices[i]
    const fact: FillFact = { id: `${q.id}-a`, section: 'borrower', fieldPath: choice.fieldPath, record: q.record, contactId: q.contactId, value: choice.value, sourceText: q.sourceText, displayLabel: choice.label, confidence: 'high' }
    const plan = planFill([fact], input())
    if (!plan.changes.length) {
      setResult(result && { ...result, questions: result.questions.filter((x) => x.id !== q.id), toNotes: [...result.toNotes, ...plan.toNotes.map((t) => t.text)] })
      return
    }
    void addToRun(plan.changes, { questionId: q.id })
  }

  const undo = async () => {
    if (!result) return
    if (!(await confirmAction('Undo this AI fill? Every value it filled goes back to what it was, and rows it added are removed. The notes stay on the file.', { confirmLabel: 'Undo AI fill' }))) return
    setBusy(true)
    try {
      const problems = await undoChanges(loan.id, result.applied)
      await markRunUndone(result.runId)
      setResult({ ...result, undone: true, conflicts: [], questions: [] })
      refresh()
      if (problems.length) toast.error(`Some changes couldn't be undone: ${problems.join('; ')}`)
      else toast.success('AI fill undone.')
    } finally {
      setBusy(false)
    }
  }

  const summary = result ? fillSummary(result.applied as unknown as Change[]) : null
  const missing = validation?.issues ?? []
  const stillMissing = validation?.totalMissing ?? 0

  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="AI Fill">
      <button type="button" aria-label="Close AI Fill" className={cn('absolute inset-0 transition-colors duration-300', playback ? 'bg-transparent' : 'bg-black/20')} onClick={() => !reading && onClose()} />
      <div
        className={cn(
          'absolute flex flex-col bg-card shadow-2xl transition-[max-height] duration-300',
          // While cards fly, a phone's sheet drops to 40% so the section nav stays in view.
          'inset-x-0 bottom-0 rounded-t-2xl',
          playback ? 'max-h-[40svh]' : 'max-h-[85svh]',
          'md:inset-x-auto md:top-0 md:right-0 md:bottom-0 md:max-h-none md:w-[440px] md:rounded-none md:rounded-l-2xl',
        )}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <SparklesIcon className="size-4 text-red-600" />
            <h2 className="font-semibold">AI Fill</h2>
            <span className="text-xs text-muted-foreground">from call notes</span>
          </div>
          <Button size="icon" variant="ghost" aria-label="Close" disabled={reading} onClick={onClose}>
            <XIcon />
          </Button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {!result ? (
            <>
              <textarea
                ref={area}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                disabled={reading}
                rows={10}
                placeholder="Type or paste call notes…"
                aria-label="Call notes"
                className="w-full resize-y rounded-lg border bg-background px-3 py-2 text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
              />
              <p className="text-xs text-muted-foreground">
                Fills empty 1003 fields for {app.borrowers.map((b) => b.person.firstName).join(' and ')}. Values already there are never changed without asking. Your notes are saved to the file.
              </p>
            </>
          ) : playback ? (
            <AiFillPlayback notes={playback.notes} items={playback.items} before={playback.before} after={playback.after} onDone={() => setPlayback(null)} />
          ) : (
            <div className="space-y-4">
              <div className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
                {result.undone ? (
                  <p className="font-medium">Undone. The 1003 is back to how it was.</p>
                ) : (
                  <p className="font-medium">
                    Filled {summary!.fields} field{summary!.fields === 1 ? '' : 's'} across {summary!.sections} section{summary!.sections === 1 ? '' : 's'} · {stillMissing} still missing
                  </p>
                )}
              </div>

              {!result.undone && result.conflicts.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Different from what's on the 1003</p>
                  {result.conflicts.map((c) => (
                    <div key={c.key} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
                      <p>
                        <span className="font-medium">{c.label}:</span> AI found a different value: {c.beforeDisplay} → <span className="font-medium">{c.display}</span>
                      </p>
                      <div className="mt-1.5 flex gap-2">
                        <Button size="xs" disabled={busy} onClick={() => void addToRun([c], { conflictKey: c.key })}>
                          Replace
                        </Button>
                        <Button size="xs" variant="outline" disabled={busy} onClick={() => setResult({ ...result, conflicts: result.conflicts.filter((x) => x.key !== c.key) })}>
                          Keep
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {!result.undone && result.questions.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Quick questions</p>
                  {result.questions.map((q) => (
                    <div key={q.id} className="rounded-lg border px-3 py-2 text-sm">
                      <p className="font-medium">{q.question}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">"{q.sourceText}"</p>
                      <div className="mt-1.5 flex flex-wrap gap-2">
                        {q.choices.map((c, i) => (
                          <Button key={c.label} size="xs" variant="outline" disabled={busy} onClick={() => answer(q, i)}>
                            {c.label}
                          </Button>
                        ))}
                        <Button size="xs" variant="ghost" disabled={busy} onClick={() => setResult({ ...result, questions: result.questions.filter((x) => x.id !== q.id) })}>
                          Skip
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {result.applied.length > 0 && (
                <div>
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{result.undone ? 'Was filled' : 'Filled by AI'}</p>
                  <ul className={cn('mt-1 divide-y', result.undone && 'opacity-50')}>
                    {result.applied.map((a) => (
                      <li key={a.key} className="flex items-center justify-between gap-2 py-2 text-sm">
                        <span className="flex min-w-0 items-center gap-2">
                          <AiTag />
                          <span className="min-w-0 break-words">{a.kind === 'field' ? `${a.label}: ${a.display}` : `New: ${a.display}`}</span>
                        </span>
                        <SectionTag section={a.section as FieldChange['section']} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {!result.undone && missing.length > 0 && (
                <div>
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Still need to ask</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {[...new Set(missing.map((i) => i.field))].slice(0, 12).map((f) => (
                      <span key={f} className="rounded-full bg-orange-100 px-2.5 py-1 text-xs font-medium text-orange-800">
                        {f}
                      </span>
                    ))}
                    {new Set(missing.map((i) => i.field)).size > 12 && <span className="px-1 py-1 text-xs text-muted-foreground">and more</span>}
                  </div>
                </div>
              )}

              {result.toNotes.length > 0 && (
                <div>
                  <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Saved to the file's notes</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
                    {result.toNotes.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}

              {result.failed.length > 0 && (
                <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
                  <p className="font-medium">Not saved:</p>
                  <ul className="list-disc pl-5">
                    {result.failed.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className={cn('flex items-center justify-between gap-2 border-t px-4 py-3', playback && 'hidden')}>
          {!result ? (
            <>
              {notes.trim() ? (
                <Button variant="ghost" size="sm" disabled={reading} onClick={() => setNotes('')}>
                  Clear
                </Button>
              ) : (
                <span />
              )}
              <Button className="bg-red-600 text-white hover:bg-red-700" disabled={!notes.trim() || reading} onClick={() => void run()}>
                {reading ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
                {reading ? 'Reading…' : 'AI Fill'}
              </Button>
            </>
          ) : (
            <>
              {!result.undone && result.applied.length > 0 ? (
                <Button variant="outline" size="sm" className="text-red-700" disabled={busy} onClick={() => void undo()}>
                  <Undo2Icon />
                  Undo AI fill
                </Button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={busy} onClick={() => { setResult(null); setNotes('') }}>
                  Add more notes
                </Button>
                <Button size="sm" onClick={onClose}>
                  Done
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
