import { CheckCircle2Icon, ChevronRightIcon, CircleDashedIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'

export interface ChecklistSection {
  id: string
  label: string
  /** Missing required fields; 0 with `started` means complete. */
  missing: number
  started: boolean
}

/**
 * The 1003 tab's section list: each URLA section with a yellow missing
 * count, a green check when complete, or a dashed circle when not started.
 * Above it, the applications bar and the Validate Application button.
 */
export function SectionChecklist({
  sections,
  active,
  onSelect,
  applicationsLabel,
  onApplications,
  onValidate,
}: {
  sections: ChecklistSection[]
  active?: string | null
  onSelect: (id: string) => void
  /** e.g. "1 application, 2 borrowers". */
  applicationsLabel: string
  onApplications?: () => void
  onValidate?: () => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-stretch gap-3">
        <button type="button" onClick={onApplications} className="flex min-w-0 flex-1 items-center justify-between gap-3 rounded-xl border bg-card px-4 py-2.5 text-left hover:bg-muted/50">
          <span className="text-[0.7rem] font-semibold tracking-wide text-muted-foreground uppercase">Applications</span>
          <span className="flex items-center gap-1 text-sm text-muted-foreground">
            {applicationsLabel}
            <ChevronRightIcon className="size-4" />
          </span>
        </button>
        <Button onClick={onValidate} className="bg-emerald-600 text-white hover:bg-emerald-700">
          Validate Application
        </Button>
      </div>
      <section className="rounded-xl border bg-card p-4">
        <p className="text-[0.7rem] font-semibold tracking-wide text-muted-foreground uppercase">URLA sections</p>
        <p className="mb-2 text-xs text-muted-foreground">Form 1003 components</p>
        <ul className="space-y-0.5">
          {sections.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => onSelect(s.id)}
                className={cn('flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-left text-sm', active === s.id ? 'bg-muted font-medium' : 'hover:bg-muted/60')}
              >
                {s.label}
                {s.missing > 0 ? (
                  <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 text-[0.7rem] font-semibold text-amber-800 tabular-nums" aria-label={`${s.missing} missing`}>
                    {s.missing}
                  </span>
                ) : s.started ? (
                  <CheckCircle2Icon className="size-4 text-emerald-600" aria-label="Complete" />
                ) : (
                  <CircleDashedIcon className="size-4 text-muted-foreground" aria-label="Not started" />
                )}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
