// MyHome: My plan (Connor, 2026-11-24, "#2"). A Nurture borrower sees the
// readiness plan their loan officer approved: the goal, the note, each step
// with why it matters, how to do it and what to have ready, the milestones
// with their target dates, the review date, and the Roadmap PDF. "I did this"
// on a milestone tells the loan officer (an update they verify); only the loan
// officer checks a milestone off. Until a plan is approved it says one is coming.
import { useState } from 'react'
import { CheckCircle2Icon, CircleIcon, ClockIcon, DownloadIcon } from 'lucide-react'
import { planPdfUrl, reportMilestone } from '@/lib/myhome/api'
import type { MyHomeMilestone, MyHomePlan } from '../../supabase/functions/myhome/rules'

const card = 'rounded-xl border bg-white p-5 shadow-soft'
const longDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
const STATUS = { not_started: 'Not started', in_progress: 'In progress', done: 'Done' } as const

export function MyPlan({ loanId, plan, loFirst, onChanged, onGone }: { loanId: string; plan: MyHomePlan | null; loFirst: string; onChanged: () => void; onGone: () => void }) {
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!plan)
    return (
      <section className={card} aria-labelledby="myhome-plan">
        <h2 id="myhome-plan" className="text-lg font-bold tracking-tight">
          My plan
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{loFirst} is putting together your plan to get ready. It shows here as soon as it's ready.</p>
      </section>
    )
  const all = [...plan.actions.flatMap((a) => a.milestones), ...plan.milestones]
  const done = all.filter((m) => m.done).length
  const pct = all.length ? Math.round((done / all.length) * 100) : 0
  const openPdf = async () => {
    if (!plan.roadmap) return
    setOpening(true)
    setError(null)
    // Open the tab first so phones don't block it, then point it at the link.
    const w = window.open('', '_blank')
    const r = await planPdfUrl(loanId, plan.roadmap.id)
    setOpening(false)
    if (r.status === 200 && r.body.url) {
      if (w) w.location.href = r.body.url
      else window.location.assign(r.body.url)
      return
    }
    w?.close()
    if (r.status === 401 || r.status === 409) return onGone()
    setError(r.body.error ?? 'The PDF could not open. Try again.')
  }
  return (
    <section className={card} aria-labelledby="myhome-plan">
      <h2 id="myhome-plan" className="text-lg font-bold tracking-tight">
        My plan
      </h2>
      {plan.goal && <p className="mt-1 font-semibold">{plan.goal}</p>}
      {plan.intro && <p className="mt-2 text-sm whitespace-pre-line text-muted-foreground">{plan.intro}</p>}
      {all.length > 0 && (
        <div className="mt-4">
          <div className="flex justify-between text-sm">
            <span className="font-medium">
              {done} of {all.length} milestones done
            </span>
            <span className="text-muted-foreground">{pct}%</span>
          </div>
          <div className="mt-1 h-3 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Plan progress">
            <div className="h-full rounded-full bg-emerald-600" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {plan.reviewOn && <p className="mt-3 text-sm">We'll look at your plan together around <strong>{longDate(plan.reviewOn)}</strong>.</p>}
      {plan.roadmap && (
        <button type="button" disabled={opening} onClick={() => void openPdf()} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg border-2 border-primary text-sm font-semibold text-primary disabled:opacity-60">
          <DownloadIcon className="size-4" />
          {opening ? 'Opening…' : 'My roadmap (PDF)'}
        </button>
      )}
      {error && <p className="mt-1.5 text-sm text-destructive">{error}</p>}

      <ol className="mt-5 space-y-4">
        {plan.actions.map((a, i) => (
          <li key={a.id} className="rounded-lg border p-4">
            <div className="flex items-start gap-2">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold">{a.title}</h3>
                <p className={`text-xs font-medium ${a.status === 'done' ? 'text-emerald-700' : 'text-muted-foreground'}`}>{STATUS[a.status]}</p>
              </div>
            </div>
            {a.why && <p className="mt-2 text-sm">{a.why}</p>}
            {a.steps.length > 0 && (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
                {a.steps.map((s, j) => (
                  <li key={j}>{s}</li>
                ))}
              </ul>
            )}
            {a.docs.length > 0 && (
              <p className="mt-2 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">Have ready: </span>
                {a.docs.join(', ')}
              </p>
            )}
            {a.milestones.length > 0 && (
              <ul className="mt-3 space-y-2">
                {a.milestones.map((m) => (
                  <Milestone key={m.id} loanId={loanId} m={m} loFirst={loFirst} onChanged={onChanged} onGone={onGone} />
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
      {plan.milestones.length > 0 && (
        <div className="mt-4">
          <h3 className="font-semibold">Along the way</h3>
          <ul className="mt-2 space-y-2">
            {plan.milestones.map((m) => (
              <Milestone key={m.id} loanId={loanId} m={m} loFirst={loFirst} onChanged={onChanged} onGone={onGone} />
            ))}
          </ul>
        </div>
      )}
      <p className="mt-4 text-xs text-muted-foreground">This plan is a guide to help you get ready. It isn't an approval or a commitment to lend.</p>
    </section>
  )
}

function Milestone({ loanId, m, loFirst, onChanged, onGone }: { loanId: string; m: MyHomeMilestone; loFirst: string; onChanged: () => void; onGone: () => void }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const send = async () => {
    setBusy(true)
    setError(null)
    const r = await reportMilestone(loanId, m.id, note.trim() || null)
    setBusy(false)
    if (r.status === 200) return (setOpen(false), onChanged())
    if (r.status === 401 || r.status === 409) return onGone()
    setError(r.body.error ?? 'That did not go through. Try again.')
  }
  return (
    <li className="rounded-lg bg-[#F4F7FB] px-3 py-2.5 text-sm">
      <div className="flex items-start gap-2">
        {m.done ? <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-emerald-600" /> : m.reported ? <ClockIcon className="mt-0.5 size-5 shrink-0 text-amber-600" /> : <CircleIcon className="mt-0.5 size-5 shrink-0 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <p className={`font-medium ${m.done ? 'text-muted-foreground line-through' : ''}`}>{m.title}</p>
          {m.measure && <p className="text-muted-foreground">{m.measure}</p>}
          <p className="text-xs text-muted-foreground">{m.done ? 'Done' : m.reported ? `You said you did this. Waiting for ${loFirst} to check.` : m.targetDate ? `Target: ${shortDate(m.targetDate)}` : ''}</p>
        </div>
        {!m.done && !m.reported && !open && (
          <button type="button" onClick={() => setOpen(true)} className="h-9 shrink-0 rounded-lg border bg-white px-3 text-sm font-semibold text-primary">
            I did this
          </button>
        )}
      </div>
      {open && (
        <div className="mt-2 space-y-2">
          <textarea className="min-h-16 w-full rounded-lg border bg-white px-3 py-2 text-base" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={`Anything ${loFirst} should know? (optional)`} aria-label="Note" />
          {error && <p className="text-destructive">{error}</p>}
          <div className="flex gap-2">
            <button type="button" onClick={() => setOpen(false)} className="h-10 flex-1 rounded-lg border bg-white font-medium">
              Cancel
            </button>
            <button type="button" disabled={busy} onClick={() => void send()} className="h-10 flex-[2] rounded-lg bg-primary font-semibold text-white disabled:opacity-60">
              {busy ? 'Sending…' : `Tell ${loFirst}`}
            </button>
          </div>
        </div>
      )}
    </li>
  )
}
