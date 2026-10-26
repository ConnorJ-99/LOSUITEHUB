import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowRightIcon, CheckCircle2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CurrencyInput, DateInput, FormGrid, Input, NumberInput, PercentInput, Select } from '@/components/shared'
import { MORTGAGE_TYPE_OPTIONS, PROPERTY_TYPE_OPTIONS, TERM_OPTIONS } from '@/components/profile/options'
import { YesNo } from '@/components/urla/parts'
import { useSaveMissingFields } from '@/lib/api/loanfile'
import { fixKey, groupFieldChanges, type FieldFix, type UrlaIssue, type UrlaValidation } from '@/lib/loanfile/urla'
import { CITIZENSHIP_OPTIONS, MARITAL_STATUS_OPTIONS } from '@/lib/urla/options'

type Values = Record<string, unknown>

/** One input for one missing value, chosen by where it's saved. */
function FixInput({ issue, value, onChange }: { issue: UrlaIssue & { fix: FieldFix }; value: unknown; onChange: (v: unknown) => void }) {
  const f = issue.fix
  const label = issue.field
  const num = value as number | null
  const str = (value as string | undefined) ?? ''
  switch (f.kind) {
    case 'loan':
      if (f.field === 'noteRate') return <PercentInput label={label} value={num ?? null} onChange={onChange} span={3} />
      if (f.field === 'mortgageType') return <Select label={label} value={(value as string) ?? null} options={MORTGAGE_TYPE_OPTIONS} onChange={onChange} span={3} />
      if (f.field === 'termMonths') return <Select label={label} value={value ? String(value) : null} options={TERM_OPTIONS} onChange={(v) => onChange(Number(v))} span={3} />
      return <CurrencyInput label={label} value={num ?? null} onChange={onChange} span={3} />
    case 'property':
      if (f.field === 'propertyType') return <Select label={label} value={(value as string) ?? null} options={PROPERTY_TYPE_OPTIONS} onChange={onChange} span={3} />
      if (f.field === 'estimatedValue') return <CurrencyInput label={label} value={num ?? null} onChange={onChange} span={3} />
      return <Input label={label} value={str} onChange={onChange} span={3} />
    case 'person':
      if (f.field === 'dateOfBirth') return <DateInput label={label} value={(value as string) ?? null} onChange={onChange} span={3} />
      if (f.field === 'citizenship') return <Select label={label} value={(value as string) ?? null} options={CITIZENSHIP_OPTIONS} onChange={onChange} span={3} />
      if (f.field === 'maritalStatus') return <Select label={label} value={(value as string) ?? null} options={MARITAL_STATUS_OPTIONS} onChange={onChange} span={3} />
      return <Input label="Phone" value={str} onChange={onChange} type="tel" span={3} />
    case 'score':
      return <NumberInput label={label} value={num ?? null} onChange={onChange} maxDecimals={0} span={3} />
    case 'job':
      if (f.field === 'startDate') return <DateInput label={label} value={(value as string) ?? null} onChange={onChange} span={3} />
      return <CurrencyInput label={label} value={num ?? null} onChange={onChange} span={3} />
    case 'declaration':
      return (
        <div className="sm:col-span-2 lg:col-span-6">
          <YesNo label={label} value={(value as boolean | undefined) ?? null} onChange={onChange} />
        </div>
      )
  }
}

/**
 * "Complete fields": only the 1003's missing values, in one card. Each value
 * saves to the same record the 1003 uses. Things that need the full form
 * (addresses, demographics, Settings) link to where they're done.
 */
export function MissingFieldsDialog({ validation, open, onOpenChange, loanId, onOpenSection }: { validation: UrlaValidation; open: boolean; onOpenChange: (open: boolean) => void; loanId: string; onOpenSection: (anchor: string) => void }) {
  const save = useSaveMissingFields(loanId)
  const [values, setValues] = useState<Values>({})
  const fixable = validation.issues.filter((i): i is UrlaIssue & { fix: FieldFix } => !!i.fix)
  const elsewhere = validation.issues.filter((i) => !i.fix)
  const filled = fixable.filter((i) => {
    const v = values[fixKey(i.fix)]
    return v !== undefined && v !== null && v !== ''
  }).length

  const submit = () =>
    save.mutate(groupFieldChanges(fixable, values), {
      onSuccess: () => {
        toast.success(`Saved ${filled} field${filled === 1 ? '' : 's'} to the 1003`)
        setValues({})
        onOpenChange(false)
      },
      onError: (e) => toast.error(e.message),
    })

  // Group by section, then by borrower within a section.
  const groups = validation.sections
    .map((s) => ({ ...s, issues: fixable.filter((i) => i.section === s.id) }))
    .filter((g) => g.issues.length > 0)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Complete missing fields</DialogTitle>
          <DialogDescription>Only what the 1003 is missing. Fill in what you have; anything left blank stays missing.</DialogDescription>
        </DialogHeader>
        {validation.totalMissing === 0 ? (
          <p className="flex items-center gap-2 text-sm text-emerald-700">
            <CheckCircle2Icon className="size-4" />
            Nothing is missing.
          </p>
        ) : (
          <div className="space-y-5">
            {groups.map((g) => {
              const people = [...new Set(g.issues.map((i) => i.borrower ?? ''))]
              return (
                <section key={g.id} className="space-y-2">
                  <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{g.label}</h3>
                  {people.map((person) => (
                    <div key={person} className="space-y-1">
                      {person && <p className="text-sm font-medium">{person}</p>}
                      <FormGrid>
                        {g.issues
                          .filter((i) => (i.borrower ?? '') === person)
                          .map((i) => (
                            <FixInput key={fixKey(i.fix)} issue={i} value={values[fixKey(i.fix)]} onChange={(v) => setValues((s) => ({ ...s, [fixKey(i.fix)]: v }))} />
                          ))}
                      </FormGrid>
                    </div>
                  ))}
                </section>
              )
            })}
            {elsewhere.length > 0 && (
              <section className="space-y-2 rounded-lg border bg-muted/40 p-3">
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Needs the full form</h3>
                <ul className="space-y-1">
                  {elsewhere.map((i, n) => {
                    const anchor = validation.sections.find((s) => s.id === i.section)?.anchor ?? 'section-1'
                    return (
                      <li key={n} className="flex items-center justify-between gap-2 text-sm">
                        <span>
                          {i.field}
                          {i.borrower && <span className="text-muted-foreground"> · {i.borrower}</span>}
                        </span>
                        {i.section === 'origination' ? (
                          <Button size="xs" variant="ghost" asChild>
                            <Link to="/settings">
                              Settings
                              <ArrowRightIcon />
                            </Link>
                          </Button>
                        ) : (
                          <Button
                            size="xs"
                            variant="ghost"
                            onClick={() => {
                              onOpenChange(false)
                              onOpenSection(anchor)
                            }}
                          >
                            Open 1003
                            <ArrowRightIcon />
                          </Button>
                        )}
                      </li>
                    )
                  })}
                </ul>
              </section>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={filled === 0 || save.isPending}>
            {save.isPending ? 'Saving…' : filled ? `Save ${filled} field${filled === 1 ? '' : 's'}` : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
