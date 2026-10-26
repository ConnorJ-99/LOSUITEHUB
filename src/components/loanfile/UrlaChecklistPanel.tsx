import { useState } from 'react'
import { CheckCircle2Icon } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { UrlaSectionId, UrlaValidation } from '@/lib/loanfile/urla'
import { SectionChecklist } from './SectionChecklist'

const jump = (anchor: string) => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

/**
 * Top of the 1003 tab: the URLA section list with each section's status,
 * and Validate Application, which lists every missing field and jumps to it.
 */
export function UrlaChecklistPanel({ validation, borrowerCount }: { validation: UrlaValidation; borrowerCount: number }) {
  const [active, setActive] = useState<UrlaSectionId | null>(null)
  const [validating, setValidating] = useState(false)
  const anchorOf = (id: UrlaSectionId) => validation.sections.find((s) => s.id === id)?.anchor ?? 'section-1'

  const select = (id: string) => {
    setActive(id as UrlaSectionId)
    jump(anchorOf(id as UrlaSectionId))
  }

  return (
    <>
      <SectionChecklist
        sections={validation.sections}
        active={active}
        onSelect={select}
        applicationsLabel={`1 application, ${borrowerCount} borrower${borrowerCount === 1 ? '' : 's'}`}
        onApplications={() => jump('section-1')}
        onValidate={() => setValidating(true)}
      />
      <Dialog open={validating} onOpenChange={setValidating}>
        <DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Validate Application</DialogTitle>
            <DialogDescription>
              {validation.totalMissing === 0 ? 'Every required field is filled in.' : `${validation.totalMissing} required field${validation.totalMissing === 1 ? '' : 's'} missing. Click one to go to it.`}
            </DialogDescription>
          </DialogHeader>
          {validation.totalMissing === 0 ? (
            <p className="flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2Icon className="size-4" />
              Ready for MISMO export and submission.
            </p>
          ) : (
            <div className="space-y-3">
              {validation.sections
                .filter((s) => s.missing > 0)
                .map((s) => (
                  <div key={s.id}>
                    <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{s.label}</p>
                    <ul className="mt-1 divide-y rounded-md border">
                      {validation.issues
                        .filter((i) => i.section === s.id)
                        .map((i, n) => (
                          <li key={n}>
                            <button
                              type="button"
                              className="flex w-full justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
                              onClick={() => {
                                setValidating(false)
                                select(s.id)
                              }}
                            >
                              <span>{i.field}</span>
                              {i.borrower && <span className="text-xs text-muted-foreground">{i.borrower}</span>}
                            </button>
                          </li>
                        ))}
                    </ul>
                  </div>
                ))}
              <p className="text-xs text-muted-foreground">Person fields (Borrower Info, Declarations, Demographics) are shown for the borrower picked at the top of the 1003.</p>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
