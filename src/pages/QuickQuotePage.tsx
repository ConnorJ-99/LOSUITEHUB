import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'
import { FilePlus2Icon, MailIcon, PlusIcon, PrinterIcon, SparklesIcon, Trash2Icon, UserCheckIcon, UserPlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, confirmAction, DateInput, TextArea } from '@/components/shared'
import { EmailQuoteDialog, type QuoteEmail } from '@/components/quickquote/EmailQuoteDialog'
import { OptionCard } from '@/components/quickquote/OptionCard'
import { QuotePreviewDialog } from '@/components/quickquote/QuotePreviewDialog'
import { SaveLeadDialog, type SavedLead } from '@/components/quickquote/SaveLeadDialog'
import { ScenarioPanel } from '@/components/quickquote/ScenarioPanel'
import { useQuotePdf } from '@/components/quickquote/useQuotePdf'
import { useQueryClient } from '@tanstack/react-query'
import { keys } from '@/lib/api/client'
import { saveGeneratedPdf } from '@/lib/api/documents'
import { useLoan } from '@/lib/api/loans'
import { useFeeTemplates } from '@/lib/api/pricing'
import { useCatalog } from '@/lib/api/products'
import { useProperties } from '@/lib/api/properties'
import { saveQuoteToLoan, useDeleteQuote, useEstimatedScore, useQuickQuote, useRecentQuotes, useSaveQuote, type QuickQuote } from '@/lib/api/quickQuotes'
import { useAuth } from '@/lib/auth/context'
import { formatIsoDate, relativeTime, todayIso } from '@/lib/dates'
import { QUICK_QUOTE_TEMPLATE, quoteFileName } from '@/lib/documents/quickQuote'
import { describeChanges, factChanges, leadOption, loanFactsFromQuote, scenarioFromLoan } from '@/lib/quickquote/handoff'
import {
  badgesFor,
  blankOption,
  blankScenario,
  MAX_OPTIONS,
  optionFigures,
  optionLetter,
  quoteProblems,
  recommendOnly,
  scoreFor,
  sortOptions,
  validThroughFrom,
  type OptionFigures,
  type QuoteOption,
  type QuoteScenario,
  type QuoteSortKey,
} from '@/lib/quickquote/quote'
import { sentQuoteNote } from '@/lib/quickquote/send'
import { optionFromProgram, suggestMissing, suggestPrograms } from '@/lib/quickquote/suggest'

const SORTS: { key: QuoteSortKey; label: string }[] = [
  { key: 'payment', label: 'Payment' },
  { key: 'cash', label: 'Cash to close' },
  { key: 'rate', label: 'Rate' },
]

const newId = () => crypto.randomUUID()

interface QuoteState {
  id: string | null
  contactId: string | null
  loanId: string | null
  /** Whose file it's on, for the header ("Saved to Jordan Reyes's file"). */
  fileName: string | null
  scenario: QuoteScenario
  options: QuoteOption[]
  note: string
  validThrough: string
  sentAt: string | null
}

const freshQuote = (): QuoteState => ({ id: null, contactId: null, loanId: null, fileName: null, scenario: blankScenario(), options: [], note: '', validThrough: validThroughFrom(todayIso()), sentAt: null })

const fromSaved = (q: QuickQuote): QuoteState => ({
  id: q.id,
  contactId: q.contactId,
  loanId: q.loanId,
  fileName: q.loanId ? q.scenario.borrower.name : null,
  scenario: { ...blankScenario(), ...q.scenario },
  options: q.options.map((o) => ({ ...blankOption(o.id), ...o })),
  note: q.note,
  validThrough: q.validThrough,
  sentAt: q.sentAt,
})

type LeadNext = 'stay' | 'prequal' | 'email'

function RecentQuotes({ currentId, onOpen, onNew }: { currentId: string | null; onOpen: (id: string) => void; onNew: () => void }) {
  const recent = useRecentQuotes()
  const remove = useDeleteQuote()
  return (
    <Card
      title="Your recent quotes"
      action={
        <Button size="sm" variant="outline" onClick={onNew}>
          <FilePlus2Icon />
          New
        </Button>
      }
    >
      {recent.isError ? (
        <p className="text-sm text-destructive">{(recent.error as Error).message}</p>
      ) : !recent.data?.length ? (
        <p className="text-sm text-muted-foreground">Quotes save on their own once they have a name.</p>
      ) : (
        <ul className="-my-1 divide-y">
          {recent.data.map((q) => (
            <li key={q.id} className={cn('flex items-center justify-between gap-2 py-1.5 text-sm', q.id === currentId && 'font-semibold')}>
              <button type="button" className="min-w-0 truncate text-left text-primary underline-offset-2 hover:underline" onClick={() => onOpen(q.id)}>
                {q.scenario.borrower?.name || 'No name'}
              </button>
              <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                {q.sentAt ? `Sent ${formatIsoDate(q.sentAt.slice(0, 10))}` : relativeTime(q.updatedAt)}
                {!q.loanId && (
                  <button
                    type="button"
                    title="Delete this quote"
                    className="rounded p-1 hover:bg-muted hover:text-destructive"
                    onClick={async () => {
                      if (!(await confirmAction(`Delete the quote for ${q.scenario.borrower?.name || 'no name'}? This can't be undone.`, { confirmLabel: 'Delete', destructive: true }))) return
                      remove.mutate(q.id, { onSuccess: () => q.id === currentId && onNew(), onError: (e) => toast.error(e.message) })
                    }}
                  >
                    <Trash2Icon className="size-3.5" />
                  </button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** Quick Quote: loan options in front of a new borrower before a full pre-qual. No pricing engine; rates are typed. */
export function QuickQuotePage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { state } = useAuth()
  const me = state.status === 'signedIn' ? state.user.id : null
  const paramId = params.get('id')
  const paramLoan = params.get('loan')

  const [q, setQ] = useState<QuoteState>(freshQuote)
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  const [sortedBy, setSortedBy] = useState<QuoteSortKey | null>(null)
  const [leadDialog, setLeadDialog] = useState<LeadNext | null>(null)
  const [emailing, setEmailing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [previewFile, setPreviewFile] = useState<Blob | null>(null)

  const saved = useQuickQuote(paramId)
  const fromLoan = useLoan(paramLoan ?? '')
  const homes = useProperties(paramLoan ?? '')
  const score = useEstimatedScore(paramLoan, fromLoan.data?.borrower?.id ?? null)
  const catalog = useCatalog()
  const fees = useFeeTemplates()
  const save = useSaveQuote()
  const pdf = useQuotePdf(me)
  const fileLoan = useLoan(q.loanId ?? '')
  const queryClient = useQueryClient()

  // Open a saved quote (?id=) or start one from a borrower file (?loan=).
  useEffect(() => {
    if (paramId && saved.data && loadedKey !== `id:${paramId}`) {
      setQ(fromSaved(saved.data))
      setLoadedKey(`id:${paramId}`)
    } else if (!paramId && paramLoan && fromLoan.data && homes.isSuccess && !score.isLoading && loadedKey !== `loan:${paramLoan}`) {
      const loan = fromLoan.data
      const home = homes.data?.find((h) => h.id === loan.details.subjectPropertyId) ?? null
      setQ({ ...freshQuote(), contactId: loan.borrower?.id ?? null, loanId: loan.id, fileName: loan.borrower ? `${loan.borrower.firstName} ${loan.borrower.lastName}` : null, scenario: scenarioFromLoan(loan, score.data ?? null, home) })
      setLoadedKey(`loan:${paramLoan}`)
    } else if (!paramId && !paramLoan && loadedKey !== null) {
      setQ(freshQuote())
      setLoadedKey(null)
    }
  }, [paramId, paramLoan, saved.data, fromLoan.data, homes.isSuccess, homes.data, score.isLoading, score.data, loadedKey])

  const templates = useMemo(() => fees.data ?? [], [fees.data])
  const figures = useMemo(() => {
    const m = new Map<string, OptionFigures>()
    for (const o of q.options) {
      const f = optionFigures(q.scenario, o, templates)
      if (f) m.set(o.id, f)
    }
    return m
  }, [q.scenario, q.options, templates])
  const badges = useMemo(() => badgesFor(q.options, figures), [q.options, figures])
  const problems = quoteProblems(q.scenario, q.options, figures)
  const onQuoteCount = q.options.filter((o) => o.onQuote).length

  // Save on its own a moment after a change, once the quote has a name.
  const latest = useRef(q)
  latest.current = q
  const [dirty, setDirty] = useState(false)
  // Saves run one at a time, so a second save waits for the first quote's id instead of adding a duplicate.
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  const version = useRef(0)
  const persist = (over: Partial<QuoteState> & { documentId?: string | null } = {}): Promise<string | null> => {
    const run = async () => {
      const seen = version.current
      const cur = { ...latest.current, ...over }
      if (!cur.scenario.borrower.name.trim()) return null
      const id = await save.mutateAsync({ id: cur.id, contactId: cur.contactId, loanId: cur.loanId, scenario: cur.scenario, options: cur.options, note: cur.note, validThrough: cur.validThrough, documentId: over.documentId, sentAt: over.sentAt })
      if (!cur.id) {
        setQ((x) => ({ ...x, id }))
        latest.current = { ...latest.current, id }
        setParams({ id }, { replace: true })
        setLoadedKey(`id:${id}`)
      }
      // A change made while this was saving still needs its own save.
      if (version.current === seen) setDirty(false)
      return id
    }
    const next = queue.current.catch(() => null).then(run)
    queue.current = next
    return next
  }
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => persist().catch((e) => toast.error((e as Error).message)), 1500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dirty, q])

  const change = (changes: Partial<QuoteState>) => {
    setQ((x) => ({ ...x, ...changes }))
    version.current++
    setDirty(true)
  }
  const setOptions = (options: QuoteOption[]) => {
    change({ options })
    setSortedBy(null)
  }
  const setOption = (o: QuoteOption) => setOptions(q.options.map((x) => (x.id === o.id ? o : x)))

  const startNew = () => {
    setQ(freshQuote())
    setLoadedKey(null)
    setSortedBy(null)
    setParams({}, { replace: false })
  }

  const suggest = () => {
    const missing = suggestMissing(q.scenario)
    if (missing.length) return toast.error(`Add the ${missing.join(', ')} first.`)
    if (!catalog.data) return toast.error('Your lenders are still loading.')
    const slots = MAX_OPTIONS - q.options.length
    if (slots <= 0) return toast.error(`A quote holds ${MAX_OPTIONS} options. Remove one to add another.`)
    const picks = suggestPrograms(q.scenario, catalog.data, q.options, slots)
    if (!picks.length) return toast.info('No program in your lender catalog fits this scenario. Add an option by hand, or check Product Search for why.')
    setOptions([...q.options, ...picks.map((r) => optionFromProgram(newId(), r))])
    toast.success(`Added ${picks.length} program${picks.length === 1 ? '' : 's'} that fit. Enter each rate and points.`)
  }

  const docInput = () => ({ scenario: q.scenario, options: q.options, figures, note: q.note, preparedOn: todayIso(), validThrough: q.validThrough })

  const preview = async () => {
    if (problems.length) return toast.error(problems[0])
    setBusy('preview')
    try {
      const made = await pdf.make(docInput())
      if (!made.ok) return toast.error(made.error)
      setPreviewFile(made.file)
      await persist()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  /** Writes the quote's deal into the file it's on, after asking when that replaces figures already there. */
  const copyToFile = async (): Promise<boolean> => {
    const loan = fileLoan.data
    if (!loan || !q.contactId) return false
    const facts = loanFactsFromQuote(q.scenario, leadOption(q.options))
    const changed = factChanges(loan.details, facts)
    if (changed.length && !(await confirmAction(`This changes ${q.fileName ?? 'the file'}'s ${describeChanges(loan.details, facts)}. Go ahead?`, { confirmLabel: 'Use the quote' }))) return false
    await saveQuoteToLoan(loan.id, q.contactId, facts, scoreFor(q.scenario.creditBucket))
    await queryClient.invalidateQueries({ queryKey: keys.loan(loan.id) })
    return true
  }

  const afterLead = async (lead: SavedLead, next: LeadNext) => {
    setLeadDialog(null)
    const over = { contactId: lead.contactId, loanId: lead.loanId, fileName: lead.name }
    setQ((x) => ({ ...x, ...over }))
    latest.current = { ...latest.current, ...over }
    try {
      await persist(over)
    } catch (e) {
      toast.error(`${lead.name} was saved, but the quote didn't attach: ${(e as Error).message}`)
    }
    if (next === 'prequal') navigate(`/loans/${lead.loanId}?tab=prequal`)
    else if (next === 'email') setEmailing(true)
    else toast.success(`${lead.name} saved as a Lead with this quote`, { action: { label: 'Open file', onClick: () => navigate(`/loans/${lead.loanId}`) } })
  }

  const startPrequal = async () => {
    if (!q.scenario.borrower.name.trim()) return toast.error("Add the borrower's name.")
    if (!q.loanId) return setLeadDialog('prequal')
    setBusy('prequal')
    try {
      if (!(await copyToFile())) return
      await persist()
      navigate(`/loans/${q.loanId}?tab=prequal`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const email = () => {
    if (problems.length) return toast.error(problems[0])
    if (!q.loanId) return setLeadDialog('email')
    setEmailing(true)
  }

  const quoteEmail: QuoteEmail = {
    fileName: quoteFileName(q.scenario.borrower.name, todayIso()),
    optionCount: q.options.filter((o) => o.onQuote && figures.has(o.id)).length,
    validThrough: q.validThrough,
    makePdf: () => pdf.make(docInput()),
    noteFor: (to, withText) => sentQuoteNote(q.options, figures, to, withText),
  }

  const shown = q.options
  const title = q.scenario.borrower.name.trim() || 'New quick quote'
  const where = q.loanId ? (
    <>
      Quick Quote · on{' '}
      <Link to={`/loans/${q.loanId}`} className="text-primary underline-offset-2 hover:underline">
        {q.fileName ?? 'the borrower'}&apos;s file
      </Link>
    </>
  ) : (
    'Quick Quote · not in pipeline yet'
  )

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow mb-1.5">{where}</p>
          <h1 className="text-[28px] leading-tight">{title}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{save.isPending ? 'Saving…' : q.sentAt ? `Sent ${formatIsoDate(q.sentAt.slice(0, 10))}` : q.id ? 'Saved' : q.scenario.borrower.name.trim() ? 'Saves when you change something' : 'Saves once it has a name'}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!q.loanId ? (
            <Button variant="outline" onClick={() => (q.scenario.borrower.name.trim() ? setLeadDialog('stay') : toast.error("Add the borrower's name."))}>
              <UserPlusIcon />
              Save as lead
            </Button>
          ) : (
            <Button variant="outline" onClick={() => navigate(`/loans/${q.loanId}`)}>
              <UserCheckIcon />
              Open file
            </Button>
          )}
          <Button variant="outline" disabled={busy === 'prequal'} onClick={startPrequal}>
            Start pre-qual
          </Button>
          <Button variant="outline" disabled={busy === 'preview' || !pdf.ready} onClick={preview}>
            <PrinterIcon />
            {busy === 'preview' ? 'Making PDF…' : 'Preview & print'}
          </Button>
          <Button onClick={email} disabled={!pdf.ready}>
            <MailIcon />
            Email quote
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-6">
          <ScenarioPanel scenario={q.scenario} onChange={(scenario) => change({ scenario })} />
          <RecentQuotes currentId={q.id} onOpen={(id) => setParams({ id })} onNew={startNew} />
        </div>

        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">
              Loan options <span className="text-sm font-normal text-muted-foreground">{onQuoteCount} on quote</span>
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-muted-foreground">Sort</span>
              <div className="inline-flex rounded-lg bg-muted p-0.5">
                {SORTS.map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    className={cn('rounded-md px-3 py-1 text-sm', sortedBy === s.key ? 'bg-card font-semibold shadow-sm' : 'text-muted-foreground hover:text-foreground')}
                    onClick={() => {
                      change({ options: sortOptions(q.options, figures, s.key) })
                      setSortedBy(s.key)
                    }}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
              <Button variant="outline" onClick={suggest} disabled={q.options.length >= MAX_OPTIONS}>
                <SparklesIcon />
                Suggest from lender catalog
              </Button>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {shown.map((o) => (
              <OptionCard
                key={o.id}
                option={o}
                figures={figures.get(o.id) ?? null}
                letter={o.onQuote ? optionLetter(shown.filter((x) => x.onQuote).indexOf(o)) : null}
                badges={badges.get(o.id) ?? []}
                scenario={q.scenario}
                catalog={catalog.data}
                onChange={setOption}
                onRecommend={(on) => setOptions(recommendOnly(q.options, o.id, on))}
                onRemove={() => setOptions(q.options.filter((x) => x.id !== o.id))}
              />
            ))}
            {q.options.length < MAX_OPTIONS && (
              <button
                type="button"
                onClick={() => setOptions([...q.options, blankOption(newId())])}
                className="flex min-h-48 flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed bg-card/50 p-6 text-center hover:border-primary/50 hover:bg-card"
              >
                <PlusIcon className="size-5 text-muted-foreground" />
                <span className="font-semibold">Add option</span>
                <span className="max-w-56 text-sm text-muted-foreground">Pick a lender &amp; program from your catalog, then enter rate and points</span>
              </button>
            )}
          </div>

          <Card>
            <div className="space-y-2">
              <TextArea label="Note to borrower (prints on the quote)" value={q.note} onChange={(note) => change({ note })} rows={3} maxLength={600} />
              <div className="flex flex-wrap items-end justify-between gap-3 text-xs text-muted-foreground">
                <div className="w-44">
                  <DateInput label="Valid through" value={q.validThrough} onChange={(v) => v && change({ validThrough: v })} />
                </div>
                <span>Rates not locked · Not a Loan Estimate · APR is an estimate</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {leadDialog && (
        <SaveLeadDialog
          scenario={q.scenario}
          options={q.options}
          reason={leadDialog === 'email' ? 'Emailing goes through the borrower file, so save them as a lead first.' : leadDialog === 'prequal' ? 'The pre-qual lives on the borrower file, so save them as a lead first.' : 'Adds the borrower to your pipeline as a Lead, with this quote attached.'}
          onSaved={(lead) => afterLead(lead, leadDialog)}
          onClose={() => setLeadDialog(null)}
        />
      )}
      {previewFile && (
        <QuotePreviewDialog
          file={previewFile}
          fileName={quoteFileName(q.scenario.borrower.name, todayIso())}
          onSaveToFile={
            q.loanId && fileLoan.data
              ? async () => {
                  const loan = fileLoan.data!
                  const documentId = await saveGeneratedPdf(loan.id, loan.organizationId, { file: previewFile, fileName: quoteFileName(q.scenario.borrower.name, todayIso()), kind: 'quick_quote', propertyId: null, templateVersion: QUICK_QUOTE_TEMPLATE })
                  await queryClient.invalidateQueries({ queryKey: keys.documents(loan.id) })
                  await persist({ documentId })
                  toast.success(`Saved to ${q.fileName ?? 'the file'}'s Documents`)
                }
              : null
          }
          onClose={() => setPreviewFile(null)}
        />
      )}
      {emailing && q.loanId && q.contactId && (
        <EmailQuoteDialog
          loanId={q.loanId}
          contactId={q.contactId}
          quote={quoteEmail}
          onSaved={async (documentId) => {
            await persist({ documentId })
          }}
          onSent={async () => {
            const sentAt = new Date().toISOString()
            setQ((x) => ({ ...x, sentAt }))
            await persist({ sentAt })
          }}
          onClose={() => setEmailing(false)}
        />
      )}
    </div>
  )
}
