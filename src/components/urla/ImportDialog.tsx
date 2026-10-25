import { useState } from 'react'
import { FileUpIcon, ShieldCheckIcon, TriangleAlertIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select } from '@/components/shared'
import { useApplyImport } from '@/lib/api/mismoImport'
import type { LoanProfile, Property } from '@/lib/api/types'
import type { ApplicationBorrower } from '@/lib/api/urla'
import { formatCurrency } from '@/lib/format'
import { defaultTargets, nameMismatch, type BorrowerTarget } from '@/lib/mismo/importPlan'
import type { ImportResult } from '@/lib/mismo/parse'
import { fullName } from '@/lib/pipeline/helpers'
import { purposeLabel } from '@/lib/pipeline/stages'

const encode = (t: BorrowerTarget) => (t.kind === 'update' ? `update:${t.contactId}` : t.kind)
const decode = (v: string): BorrowerTarget => (v.startsWith('update:') ? { kind: 'update', contactId: v.slice(7) } : { kind: v as 'new' | 'skip' })

function Line({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex justify-between gap-3 py-1 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </li>
  )
}

/** Preview and apply a parsed MISMO file to this loan. */
export function ImportDialog({
  loan,
  fileName,
  result,
  existingBorrowers,
  existingProperties,
  onClose,
}: {
  loan: LoanProfile
  fileName: string
  result: ImportResult
  existingBorrowers: ApplicationBorrower[]
  existingProperties: Property[]
  onClose: () => void
}) {
  const apply = useApplyImport(loan)
  const [targets, setTargets] = useState<BorrowerTarget[]>(() => defaultTargets(result.borrowers, existingBorrowers))

  const options = [
    ...existingBorrowers.map((b) => ({ value: `update:${b.contactId}`, label: `Update ${fullName(b.person)}${b.role === 'primary' ? ' (primary)' : ''}` })),
    { value: 'new', label: 'Add as a new co-borrower' },
    { value: 'skip', label: "Don't import this person" },
  ]
  const updateIds = targets.flatMap((t) => (t.kind === 'update' ? [t.contactId] : []))
  const duplicate = updateIds.length !== new Set(updateIds).size
  const nothing = targets.every((t) => t.kind === 'skip')
  const loanFields = Object.keys(result.loan).length

  const run = () =>
    apply.mutate(
      { result, targets, existingBorrowers, existingProperties },
      {
        onSuccess: (s) => {
          toast.success(
            `Imported: ${s.borrowersUpdated + s.borrowersAdded} borrower${s.borrowersUpdated + s.borrowersAdded === 1 ? '' : 's'}, ${s.assets} assets, ${s.liabilities} liabilities, ${s.properties} properties.`,
          )
          onClose()
        },
        onError: (e) => toast.error(`Import stopped: ${e.message}. Fix the problem and import again; it's safe to repeat.`),
      },
    )

  return (
    <Dialog open onOpenChange={(o) => !o && !apply.isPending && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import MISMO 3.4 file</DialogTitle>
          <DialogDescription className="flex items-center gap-1.5">
            <FileUpIcon className="size-3.5" />
            {fileName}
          </DialogDescription>
        </DialogHeader>

        {result.ssnCount > 0 && (
          <p className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm">
            <ShieldCheckIcon className="mt-0.5 size-4 shrink-0 text-primary" />
            {result.ssnCount} Social Security number{result.ssnCount === 1 ? ' was' : 's were'} in the file and will not be saved.
          </p>
        )}
        {result.filePurpose && result.filePurpose !== loan.purpose && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0" />
            The file is a {purposeLabel(result.filePurpose)}; this loan is a {purposeLabel(loan.purpose)}. The loan purpose won't change; use Edit if it should.
          </p>
        )}

        <section className="space-y-2">
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Borrowers in the file</p>
          {result.borrowers.map((b, i) => {
            const target = targets[i]
            const existing = target.kind === 'update' ? existingBorrowers.find((e) => e.contactId === target.contactId) : undefined
            return (
              <div key={i} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="text-sm">
                    <p className="font-medium">
                      {fullName(b.person)} {b.isPrimary && <span className="text-xs font-normal text-muted-foreground">(primary in file)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {b.addresses.length} address{b.addresses.length === 1 ? '' : 'es'} · {b.employments.length} job{b.employments.length === 1 ? '' : 's'} · {b.otherIncomes.length} other income
                    </p>
                  </div>
                  <div className="w-full sm:w-72">
                    <Select
                      label="Import into"
                      value={encode(target)}
                      onChange={(v) => setTargets((ts) => ts.map((t, j) => (j === i ? decode(v) : t)))}
                      options={options}
                    />
                  </div>
                </div>
                {existing && nameMismatch(b, existing) && (
                  <p className="mt-2 text-xs text-amber-700">
                    Names differ: {fullName(existing.person)} will be renamed to {fullName(b.person)}.
                  </p>
                )}
              </div>
            )
          })}
          {duplicate && <p className="text-xs text-destructive">Two people in the file point at the same borrower. Pick a different one.</p>}
        </section>

        <section>
          <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">What will change on this loan</p>
          <ul className="divide-y">
            <Line label="Each imported borrower's addresses, jobs and other income" value="Replaced" />
            <Line label="Assets and credits" value={`Replaced with ${result.assets.length}`} />
            <Line label="Liabilities and expenses" value={`Replaced with ${result.liabilities.length}`} />
            <Line label="Declarations and demographics" value="Taken from the file" />
            <Line label="Loan details" value={`${loanFields} field${loanFields === 1 ? '' : 's'} updated`} />
            {result.subject && (
              <Line
                label="Subject property"
                value={`${result.subject.addressLine || 'address not given'}${result.subject.estimatedValue ? ` · ${formatCurrency(result.subject.estimatedValue)}` : ''}${result.subject.liens.length ? ` · ${result.subject.liens.length} mortgage${result.subject.liens.length === 1 ? '' : 's'}` : ''}`}
              />
            )}
            {result.ownedProperties.length > 0 && <Line label="Other real estate owned" value={`${result.ownedProperties.length} (matched by address)`} />}
          </ul>
        </section>

        {result.warnings.length > 0 && (
          <section className="space-y-1">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Notes</p>
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
              {result.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </section>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={apply.isPending}>
            Cancel
          </Button>
          <Button onClick={run} disabled={apply.isPending || duplicate || nothing}>
            {apply.isPending ? 'Importing…' : 'Import and replace'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
