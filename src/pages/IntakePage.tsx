import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, MessageSquareQuoteIcon, ShieldAlertIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Card, confirmAction, EmptyState, FormGrid, TextArea } from '@/components/shared'
import { IntakeField } from '@/components/intake/IntakeField'
import { saveIntakeAnswers, useIntake, useMayRunIntake, useStartIntake, useSubmitIntake, type Intake } from '@/lib/api/intake'
import { useLoan } from '@/lib/api/loans'
import { useAuth } from '@/lib/auth/context'
import { formatPhone } from '@/lib/pipeline/helpers'
import { BOUNDARY, doneSections, fillBlanks, handoffPrefill, liveSummary, readyToSubmit, SECTIONS, sectionFill, sectionOf, withLo, type Answers, type SectionId } from '@/lib/intake/sections'

const firstOf = (name: string | null | undefined) => (name ?? '').trim().split(/\s+/)[0] || ''
const timeOf = (d: Date) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })

// "Hide prompts" is remembered per person on this device.
const promptsKey = (userId: string | null) => `mpshq.intake.hidePrompts.${userId ?? ''}`
function readHidePrompts(userId: string | null): boolean {
  try {
    return localStorage.getItem(promptsKey(userId)) === '1'
  } catch {
    return false
  }
}
function writeHidePrompts(userId: string | null, hide: boolean) {
  try {
    localStorage.setItem(promptsKey(userId), hide ? '1' : '0')
  } catch {
    // Private window: just not remembered.
  }
}

/** The interview itself, once it exists. */
function Interview({ intake, loFirst, borrowerName, meName, meId }: { intake: Intake; loFirst: string; borrowerName: string; meName: string; meId: string | null }) {
  const submit = useSubmitIntake(intake.loanId)
  const readOnly = intake.status === 'submitted' || intake.status === 'accepted'
  const [answers, setAnswers] = useState<Answers>(intake.answers)
  const [current, setCurrent] = useState<SectionId>(() => SECTIONS.find((s) => !doneSections(intake.answers).includes(s.id))?.id ?? 'handoff')
  const [hidePrompts, setHidePrompts] = useState(() => readHidePrompts(meId))
  const [promptOpen, setPromptOpen] = useState(true)
  const [savedAt, setSavedAt] = useState<Date | null>(new Date(intake.updatedAt))
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [partialOpen, setPartialOpen] = useState(false)
  const [partialReason, setPartialReason] = useState('')
  const latest = useRef(answers)
  latest.current = answers

  const save = useCallback(async () => {
    if (readOnly) return
    setSaving(true)
    try {
      await saveIntakeAnswers(intake.id, latest.current)
      setSavedAt(new Date())
      setDirty(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }, [intake.id, readOnly])

  // Autosave: a moment after typing stops, and when leaving the page.
  useEffect(() => {
    if (!dirty) return
    const t = setTimeout(() => void save(), 800)
    return () => clearTimeout(t)
  }, [answers, dirty, save])
  useEffect(() => () => void (dirtyRef.current && saveIntakeAnswers(intake.id, latest.current).catch(() => {})), [intake.id])
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  const update = (next: Answers) => {
    if (readOnly) return
    setAnswers(next)
    setDirty(true)
  }
  const setField = (section: SectionId, key: string, value: unknown) => update({ ...answers, [section]: { ...sectionOf(answers, section), [key]: value } })
  const done = doneSections(answers)
  const markDone = (id: SectionId) => (done.includes(id) ? answers : { ...answers, meta: { ...sectionOf(answers, 'meta' as SectionId), done: [...done, id] } })

  const go = (id: SectionId) => {
    // Section 7 starts filled in from sections 1–6 (blank fields only).
    if (id === 'handoff' && !readOnly) {
      const filled = fillBlanks(sectionOf(answers, 'handoff'), handoffPrefill(answers, meName))
      if (JSON.stringify(filled) !== JSON.stringify(sectionOf(answers, 'handoff'))) update({ ...answers, handoff: filled })
    }
    setCurrent(id)
    window.scrollTo({ top: 0 })
  }
  const index = SECTIONS.findIndex((s) => s.id === current)
  const section = SECTIONS[index]
  const next = SECTIONS[index + 1]
  const prev = SECTIONS[index - 1]
  const summary = liveSummary(answers)
  const ready = readyToSubmit(answers)

  const goNext = () => {
    const withDone = markDone(current)
    if (withDone !== answers) update(withDone)
    if (next) {
      // Apply the hand-off prefill on top of the "done" mark.
      if (next.id === 'handoff') {
        const filled = fillBlanks(sectionOf(withDone, 'handoff'), handoffPrefill(withDone, meName))
        update({ ...withDone, handoff: filled })
      }
      setCurrent(next.id)
      window.scrollTo({ top: 0 })
    }
  }

  const doSubmit = async (reason: string | null) => {
    if (dirty) await save()
    submit.mutate(
      { id: intake.id, partialReason: reason },
      {
        onSuccess: () => {
          toast.success(`Sent to ${loFirst || 'the loan officer'} for review`)
          setPartialOpen(false)
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
        <span>
          LO: <span className="text-foreground">{loFirst || '—'}</span>
        </span>
        <span>
          Interviewer: <span className="text-foreground">{intake.interviewerName ?? '—'}</span>
        </span>
        {!readOnly && <span>{saving ? 'Saving…' : dirty ? 'Unsaved changes' : savedAt ? `Autosaved ${timeOf(savedAt)}` : ''}</span>}
        {!readOnly && (
          <Button size="xs" variant="outline" className="ml-auto" disabled={saving || !dirty} onClick={() => void save()}>
            Save draft
          </Button>
        )}
      </div>

      {intake.status === 'submitted' && <p className="mb-4 rounded-md bg-primary/5 px-3 py-2 text-sm">Submitted to {loFirst || 'the loan officer'} for review{intake.submittedAt ? ` on ${new Date(intake.submittedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}` : ''}{intake.partialReason ? ` (partial: ${intake.partialReason})` : ''}. It's read only until they accept it or send it back.</p>}
      {intake.status === 'accepted' && <p className="mb-4 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">Accepted by {loFirst || 'the loan officer'}.</p>}
      {intake.status === 'returned' && intake.reviewNote && (
        <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span className="font-medium">{loFirst || 'The loan officer'} sent it back:</span> {intake.reviewNote}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[15rem_minmax(0,1fr)_18rem]">
        {/* Left: the section stepper */}
        <Card className="h-fit">
          <p className="eyebrow">Borrower script</p>
          <ol className="mt-2 space-y-0.5">
            {SECTIONS.map((s, i) => {
              const isDone = done.includes(s.id)
              const fill = sectionFill(answers, s.id)
              return (
                <li key={s.id}>
                  <button type="button" onClick={() => go(s.id)} className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm', current === s.id ? 'bg-primary/10 font-medium text-primary' : 'hover:bg-muted')}>
                    <span className={cn('flex size-5 shrink-0 items-center justify-center rounded-full text-[0.7rem]', isDone ? 'bg-primary text-white' : 'border text-muted-foreground')}>{isDone ? <CheckIcon className="size-3" /> : i + 1}</span>
                    <span className="min-w-0 flex-1">{withLo(s.title, loFirst)}</span>
                    {fill.filled > 0 && !isDone && <span className="text-[0.7rem] text-muted-foreground tabular-nums">{fill.filled}</span>}
                  </button>
                </li>
              )
            })}
          </ol>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary" style={{ width: `${(done.length / SECTIONS.length) * 100}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {done.length} of {SECTIONS.length} sections · skip anything unknown
          </p>
        </Card>

        {/* Center: the current section */}
        <div className="min-w-0 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Say this</p>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="size-3.5 accent-primary"
                checked={hidePrompts}
                onChange={(e) => {
                  setHidePrompts(e.target.checked)
                  writeHidePrompts(meId, e.target.checked)
                }}
              />
              Hide prompts
            </label>
          </div>
          {!hidePrompts && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
              <button type="button" className="flex w-full items-center gap-2 text-left text-sm font-medium text-primary" onClick={() => setPromptOpen((o) => !o)}>
                <MessageSquareQuoteIcon className="size-4" />
                Say this
                {promptOpen ? <ChevronDownIcon className="ml-auto size-4" /> : <ChevronRightIcon className="ml-auto size-4" />}
              </button>
              {promptOpen && <p className="mt-2 text-sm italic">“{withLo(section.prompt, loFirst)}”</p>}
            </div>
          )}
          <Card title={`${index + 1} · ${withLo(section.title, loFirst)}`}>
            <FormGrid className="lg:grid-cols-6">
              {section.fields.map((f) => (
                <IntakeField key={f.key} field={f} value={sectionOf(answers, section.id)[f.key]} onChange={(v) => setField(section.id, f.key, v)} readOnly={readOnly} />
              ))}
            </FormGrid>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
              {prev ? (
                <Button variant="ghost" size="sm" onClick={() => go(prev.id)}>
                  <ArrowLeftIcon />
                  {withLo(prev.title, loFirst)}
                </Button>
              ) : (
                <span />
              )}
              {!readOnly &&
                (next ? (
                  <Button size="sm" onClick={goNext}>
                    Next: {withLo(next.title, loFirst)}
                    <ArrowRightIcon />
                  </Button>
                ) : (
                  <Button size="sm" disabled={done.includes('handoff')} onClick={() => update(markDone('handoff'))}>
                    <CheckIcon />
                    {done.includes('handoff') ? 'Handoff done' : 'Mark handoff done'}
                  </Button>
                ))}
            </div>
          </Card>
        </div>

        {/* Right: live summary, boundary, submit */}
        <div className="space-y-4">
          <Card className="h-fit">
            <p className="eyebrow">Building for {loFirst || 'the LO'}</p>
            {summary.length ? (
              <ul className="mt-2 space-y-1 text-sm">
                {summary.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">Fills in as you type.</p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">{borrowerName} · updates live as you type</p>
          </Card>
          <Card className="h-fit border-amber-200 bg-amber-50">
            <p className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-amber-900 uppercase">
              <ShieldAlertIcon className="size-3.5" />
              Boundary
            </p>
            <p className="mt-1 text-sm text-amber-900">{BOUNDARY}</p>
          </Card>
          {!readOnly && (
            <Card className="h-fit">
              <Button
                className="w-full"
                disabled={!ready || submit.isPending}
                onClick={async () => (await confirmAction(`Submit this intake to ${loFirst || 'the loan officer'} for review? It's read only until they accept it or send it back.`, { confirmLabel: 'Submit for review' })) && void doSubmit(null)}
              >
                Submit to {loFirst || 'the LO'} for review
              </Button>
              <p className="mt-2 text-xs text-muted-foreground">{ready ? 'Ready to send.' : 'Unlocks after section 7, or submit partial with a reason.'}</p>
              {!ready && (
                <Button variant="outline" size="sm" className="mt-2 w-full" disabled={submit.isPending} onClick={() => setPartialOpen(true)}>
                  Submit partial…
                </Button>
              )}
            </Card>
          )}
        </div>
      </div>

      <Dialog open={partialOpen} onOpenChange={setPartialOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Submit partial intake</DialogTitle>
            <DialogDescription>{loFirst || 'The loan officer'} gets what's filled in so far. Say why it's partial.</DialogDescription>
          </DialogHeader>
          <TextArea label="Why it's partial" value={partialReason} onChange={setPartialReason} rows={3} placeholder="e.g. Borrower had to go; calling back Thursday for income" />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPartialOpen(false)}>
              Cancel
            </Button>
            <Button disabled={!partialReason.trim() || submit.isPending} onClick={() => void doSubmit(partialReason.trim())}>
              Submit partial
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** /loans/:loanId/intake: the guided intake interview for a file (LO Assistant step 4, Connor 2026-11-17). */
export function IntakePage() {
  const { loanId = '' } = useParams()
  const loan = useLoan(loanId)
  const intake = useIntake(loanId)
  const mayRun = useMayRunIntake(loanId)
  const start = useStartIntake(loanId)
  const { state } = useAuth()
  const me = state.status === 'signedIn' ? state.user : null

  const l = loan.data
  const borrower = l?.borrower
  const borrowerName = borrower ? `${borrower.firstName} ${borrower.lastName}`.trim() : 'Borrower'
  const loFirst = firstOf(l?.assignedLo?.name)

  const header = (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Link to={`/loans/${loanId}`} className="text-sm text-muted-foreground hover:text-foreground">
        {borrowerName}
      </Link>
      <span className="text-muted-foreground">›</span>
      <h1 className="text-xl font-bold tracking-tight">Intake interview</h1>
    </div>
  )

  if (loan.isLoading || intake.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>
  if (!l) return <EmptyState title="File not found" description="It may have been deleted, or it isn't yours." />
  if (intake.data === 'not_installed')
    return (
      <>
        {header}
        <EmptyState title="Intake interviews aren't set up yet" description="Run the intake interviews script (20270217000000) in Supabase, then refresh." />
      </>
    )
  if (intake.isError) return <EmptyState title="Couldn't load the intake" description={(intake.error as Error).message} />

  if (!intake.data) {
    return (
      <>
        {header}
        <Card>
          <p className="text-sm">A guided call to gather {borrower?.firstName ?? 'the borrower'}'s facts for {loFirst || 'the loan officer'}'s review. It saves as you go, and nothing goes to the borrower.</p>
          {mayRun.data ? (
            <Button
              className="mt-3"
              disabled={start.isPending || !me?.organizationId}
              onClick={() =>
                start.mutate(
                  {
                    organizationId: l.organizationId ?? me!.organizationId!,
                    interviewerId: me!.id,
                    // Section 1 starts with what the file already has.
                    answers: { call: { borrowerName, phone: borrower?.phone ? formatPhone(borrower.phone) : '', email: borrower?.email ?? '', referralSource: l.referralSource ?? '', callAt: new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16) } },
                  },
                  { onError: (e) => toast.error(e.message) },
                )
              }
            >
              {start.isPending ? 'Starting…' : 'Start intake interview'}
            </Button>
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">Only this file's loan officer, an admin, or the LO Assistant for its loan officer can run an intake.</p>
          )}
        </Card>
      </>
    )
  }

  return (
    <>
      {header}
      <Interview key={intake.data.id + intake.data.status} intake={intake.data} loFirst={loFirst} borrowerName={borrowerName} meName={me?.fullName || me?.email || ''} meId={me?.id ?? null} />
    </>
  )
}
