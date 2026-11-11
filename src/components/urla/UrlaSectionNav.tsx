import { useState } from 'react'
import { CheckCircle2Icon, CheckIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { UrlaIssue, UrlaSectionId, UrlaValidation } from '@/lib/loanfile/urla'

/**
 * The 1003's one section list (UI pass, Part 2), with each group's status
 * from the same validation as the sidebar's 1003 badge: a green check when
 * complete, an amber count of missing fields, or a dashed circle when not
 * started. The groups follow the form's sections; Credit and Employment &
 * Income roll into Borrower.
 */
export const URLA_NAV: { id: string; label: string; sections: UrlaSectionId[] }[] = [
  { id: 'section-1', label: 'Borrower', sections: ['borrower', 'credit', 'income'] },
  { id: 'section-2', label: 'Assets & liabilities', sections: ['assets', 'liabilities'] },
  { id: 'section-3', label: 'Real estate', sections: ['reo'] },
  { id: 'section-4', label: 'Loan & property', sections: ['loan', 'property'] },
  { id: 'section-5', label: 'Declarations', sections: ['declarations'] },
  { id: 'section-8', label: 'Demographics', sections: ['demographics'] },
  { id: 'section-9', label: 'Originator', sections: ['origination'] },
]

export type NavStatus = { kind: 'complete' } | { kind: 'missing'; count: number } | { kind: 'not_started' }

/** A group's status: complete, N missing, or not started. */
export function navStatus(v: UrlaValidation, sections: UrlaSectionId[]): NavStatus {
  const rows = v.sections.filter((s) => sections.includes(s.id))
  const missing = rows.reduce((n, s) => n + s.missing, 0)
  // The counts always add up to the sidebar badge; "not started" is only for an empty section with nothing required.
  if (missing > 0) return { kind: 'missing', count: missing }
  return rows.some((s) => s.started) || rows.length === 0 ? { kind: 'complete' } : { kind: 'not_started' }
}

const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

/** The words of a field's label, without the required star. */
const labelText = (el: Element) => (el.textContent ?? '').replace(/\*/g, '').trim().toLowerCase()

const flash = (el: HTMLElement) => {
  el.classList.add('ring-2', 'ring-amber-400', 'ring-offset-2')
  setTimeout(() => el.classList.remove('ring-2', 'ring-amber-400', 'ring-offset-2'), 2500)
}

/**
 * Scrolls to the field an issue is about and highlights it for a moment.
 * Declarations are tagged with their field; others are matched by their
 * label ("Start date (ABC Co)" finds "Start date") or heading ("Ethnicity");
 * otherwise it goes to the section itself.
 */
export function focusIssue(issue: UrlaIssue, anchor: string) {
  const section = document.getElementById(anchor)
  if (!section) return
  const tagged = issue.fix?.kind === 'declaration' ? section.querySelector<HTMLElement>(`[data-urla-field="${issue.fix.field}"]`) : null
  if (tagged) {
    tagged.scrollIntoView({ behavior: 'smooth', block: 'center' })
    flash(tagged)
    setTimeout(() => tagged.querySelector<HTMLElement>('button')?.focus({ preventScroll: true }), 300)
    return
  }
  const want = issue.field.toLowerCase().replace(/\s*\(.*\)$/, '')
  const labels = [...section.querySelectorAll('label')]
  const label = labels.find((l) => labelText(l) === want) ?? labels.find((l) => want.startsWith(labelText(l)) && labelText(l).length > 3)
  const field =
    (label?.getAttribute('for') && document.getElementById(label.getAttribute('for')!)) ||
    label?.parentElement?.querySelector<HTMLElement>('input, select, textarea, button[role="combobox"]') ||
    null
  if (field) {
    field.scrollIntoView({ behavior: 'smooth', block: 'center' })
    setTimeout(() => field.focus({ preventScroll: true }), 300)
    flash(field)
    return
  }
  // A heading or short text with the same words (e.g. the "Ethnicity" group).
  const heading = [...section.querySelectorAll<HTMLElement>('h3, h4, p, span, legend')].find((el) => el.children.length === 0 && labelText(el) === want)
  const target = heading?.parentElement ?? section
  target.scrollIntoView({ behavior: 'smooth', block: 'center' })
  if (heading) flash(target)
}

function StatusMark({ status, onCount }: { status: NavStatus; onCount: () => void }) {
  if (status.kind === 'complete') return <CheckCircle2Icon className="size-4 shrink-0 text-emerald-600" aria-label="Complete" />
  if (status.kind === 'not_started') return <span className="size-4 shrink-0 rounded-full border-2 border-dashed border-muted-foreground/50" aria-label="Not started" />
  return (
    <span
      role="button"
      tabIndex={0}
      title="Go to the first missing field"
      onClick={(e) => {
        e.stopPropagation()
        onCount()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          e.stopPropagation()
          onCount()
        }
      }}
      className="flex h-4.5 min-w-4.5 shrink-0 items-center justify-center rounded-full bg-amber-100 px-1 text-[0.65rem] font-semibold text-amber-800 tabular-nums hover:bg-amber-200"
    >
      {status.count}
    </span>
  )
}

/**
 * The sticky section list: a column on a computer, a scrolling row on
 * smaller screens. "Validate Application" sits in its header.
 */
export function UrlaSectionNav({ validation, onFirstMissing, onCompleteFields }: { validation: UrlaValidation | null; onFirstMissing: (issue: UrlaIssue) => void; onCompleteFields?: () => void }) {
  const [validating, setValidating] = useState(false)
  const items = URLA_NAV.map((n, i) => ({ ...n, n: i + 1, status: validation ? navStatus(validation, n.sections) : null }))
  const firstIssue = (sections: UrlaSectionId[]) => validation?.issues.find((x) => sections.includes(x.section))
  const total = validation?.totalMissing ?? 0

  const validate = validation && (
    <Button size="xs" variant={total ? 'default' : 'outline'} className={cn(!total && 'text-emerald-700')} onClick={() => setValidating(true)}>
      {total ? `Validate · ${total} missing` : (
        <>
          <CheckIcon />
          Validated
        </>
      )}
    </Button>
  )

  return (
    <>
      {/* Computer: a sticky column. */}
      <nav aria-label="1003 sections" className="hidden lg:block">
        <div className="sticky top-14 space-y-2">
          {validate}
          <ul className="space-y-0.5 text-sm">
            {items.map((it) => (
              <li key={it.id}>
                <button type="button" onClick={() => scrollTo(it.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-muted-foreground hover:bg-muted hover:text-foreground">
                  <span className="min-w-0 flex-1 truncate">
                    {it.n}. {it.label}
                  </span>
                  {it.status && <StatusMark status={it.status} onCount={() => firstIssue(it.sections) && onFirstMissing(firstIssue(it.sections)!)} />}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </nav>
      {/* Smaller screens: a sticky scrolling row. */}
      <nav aria-label="1003 sections" className="sticky top-14 z-10 -mx-4 overflow-x-auto border-b bg-background/95 px-4 py-1.5 backdrop-blur [scrollbar-width:none] md:top-11 lg:hidden [&::-webkit-scrollbar]:hidden">
        <ul className="flex min-w-max items-center gap-1 text-sm">
          <li>{validate}</li>
          {items.map((it) => (
            <li key={it.id}>
              <button type="button" onClick={() => scrollTo(it.id)} className="flex items-center gap-1.5 rounded-md px-2 py-1 whitespace-nowrap text-muted-foreground hover:bg-muted">
                {it.n}. {it.label}
                {it.status && <StatusMark status={it.status} onCount={() => firstIssue(it.sections) && onFirstMissing(firstIssue(it.sections)!)} />}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      {validation && (
        <Dialog open={validating} onOpenChange={setValidating}>
          <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Validate Application</DialogTitle>
              <DialogDescription>
                {total === 0 ? 'Every required field is filled in.' : `${total} required field${total === 1 ? '' : 's'} missing. Click one to go to it.`}
              </DialogDescription>
            </DialogHeader>
            {total === 0 ? (
              <p className="flex items-center gap-2 text-sm text-emerald-700">
                <CheckCircle2Icon className="size-4" />
                Ready for MISMO export and submission.
              </p>
            ) : (
              <div className="space-y-3">
                {items
                  .filter((it) => it.status?.kind === 'missing' || validation.issues.some((x) => it.sections.includes(x.section)))
                  .map((it) => (
                    <div key={it.id}>
                      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        {it.n}. {it.label}
                      </p>
                      <ul className="mt-1 divide-y rounded-md border">
                        {validation.issues
                          .filter((x) => it.sections.includes(x.section))
                          .map((x, k) => (
                            <li key={k}>
                              <button
                                type="button"
                                className="flex w-full justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
                                onClick={() => {
                                  setValidating(false)
                                  onFirstMissing(x)
                                }}
                              >
                                <span>{x.field}</span>
                                {x.borrower && <span className="text-xs text-muted-foreground">{x.borrower}</span>}
                              </button>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ))}
                {onCompleteFields && (
                  <Button
                    className="w-full"
                    onClick={() => {
                      setValidating(false)
                      onCompleteFields()
                    }}
                  >
                    Complete fields
                  </Button>
                )}
              </div>
            )}
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}
