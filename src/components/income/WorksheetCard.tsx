import { useState } from 'react'
import { CheckCircle2Icon, ChevronDownIcon, SendIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { FormGrid, Input, Select } from '@/components/shared'
import { useDeleteWorksheet, usePushWorksheet, useSaveWorksheet, type IncomeWorksheet, type WorksheetDraft } from '@/lib/api/income'
import type { Property } from '@/lib/api/types'
import type { ApplicationBorrower } from '@/lib/api/urla'
import { relativeTime } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'
import {
  computeWorksheet,
  currentTargetValue,
  differsFrom1003,
  kindLabel,
  normalizeInputs,
  pushError,
  pushTarget,
  pushValue,
  rentalNet,
  suggestedLabel,
  type WorksheetData,
} from '@/lib/income/worksheets'
import { ownedProperties } from '@/lib/urla/realEstate'
import { CalcLines, Warnings } from './CalcLines'
import { WorksheetInputs } from './WorksheetForms'

const NEW_JOB = '__new'

interface Draft {
  label: string
  data: WorksheetData
  employmentId: string | null
  propertyId: string | null
  newEmployerName: string
}

const toDraft = (w: IncomeWorksheet): Draft => ({
  label: w.label ?? '',
  data: { kind: w.kind, inputs: normalizeInputs(w.kind, w.inputs) } as WorksheetData,
  employmentId: w.employmentId,
  propertyId: w.propertyId,
  newEmployerName: '',
})

/** One income worksheet: inputs, the math line by line, warnings, and "Push to 1003". */
export function WorksheetCard({
  worksheet,
  borrower,
  properties,
  subjectPropertyId,
  organizationId,
  open,
  onToggle,
}: {
  worksheet: IncomeWorksheet
  borrower: ApplicationBorrower
  properties: Property[]
  subjectPropertyId: string | null
  organizationId: string
  open: boolean
  onToggle: () => void
}) {
  const save = useSaveWorksheet(worksheet.loanId)
  const push = usePushWorksheet(worksheet.loanId, organizationId)
  const remove = useDeleteWorksheet(worksheet.loanId)
  const [draft, setDraft] = useState<Draft>(() => toDraft(worksheet))
  const [confirmDelete, setConfirmDelete] = useState(false)

  const result = computeWorksheet(draft.data)
  const target = pushTarget(draft.data)
  const value = pushValue(draft.data, result)
  const jobs = borrower.employments.filter((e) => e.status === 'current')
  const employment = jobs.find((e) => e.id === draft.employmentId) ?? null
  const rentals = ownedProperties(properties)
  const property = rentals.find((p) => p.id === draft.propertyId) ?? null
  const current = currentTargetValue(target, employment, property)
  const differs = differsFrom1003(current, value)
  const blocked = pushError(target, value)
  const isRental = draft.data.kind === 'rental'
  const net = isRental && property ? rentalNet(draft.data.inputs as Extract<WorksheetData, { kind: 'rental' }>['inputs'], result, property) : null

  const saved = toDraft(worksheet)
  const dirty = JSON.stringify({ ...draft, newEmployerName: '' }) !== JSON.stringify(saved) || draft.newEmployerName.trim() !== ''
  const savePayload = (): WorksheetDraft => ({
    label: draft.label,
    inputs: draft.data.inputs,
    resultMonthly: result.monthly,
    employmentId: draft.employmentId,
    propertyId: isRental ? draft.propertyId : null,
  })
  /** The automatic label for a draft's job or property. */
  const autoLabel = (d: Draft) =>
    suggestedLabel(
      d.data.kind,
      jobs.find((e) => e.id === d.employmentId) ?? (d.newEmployerName.trim() ? { employerName: d.newEmployerName.trim() } : null),
      rentals.find((p) => p.id === d.propertyId) ?? null,
    )
  /** Changes the job or property, and the label with it unless the LO typed their own. */
  const retarget = (changes: Partial<Pick<Draft, 'employmentId' | 'propertyId' | 'newEmployerName'>>) =>
    setDraft((d) => {
      const next = { ...d, ...changes }
      return !d.label || d.label === autoLabel(d) ? { ...next, label: autoLabel(next) } : next
    })
  const missingTarget = isRental ? !property : !employment && !draft.newEmployerName.trim()

  const onSave = () =>
    save.mutate(
      { id: worksheet.id, ...savePayload() },
      { onSuccess: () => toast.success('Worksheet saved'), onError: (e) => toast.error(e.message) },
    )
  const onPush = () =>
    push.mutate(
      { id: worksheet.id, contactId: borrower.contactId, draft: savePayload(), target, value, newEmployerName: employment ? undefined : draft.newEmployerName },
      {
        onSuccess: ({ employmentId }) => {
          toast.success(`${formatCurrency(value)}/mo pushed to the 1003`)
          // A push can create the job; point the worksheet at it.
          setDraft((d) => ({ ...d, employmentId, newEmployerName: '' }))
        },
        onError: (e) => toast.error(e.message),
      },
    )

  // Rentals show their net after the property's payment; everything else shows the monthly result.
  const shown = net?.net ?? result.monthly
  const where = isRental ? property?.addressLine : employment?.employerName ?? (draft.newEmployerName.trim() || null)

  return (
    <li className={cn('rounded-xl border bg-card', dirty && 'ring-2 ring-primary/30')}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{draft.label || kindLabel(draft.data.kind)}</p>
          <p className="truncate text-xs text-muted-foreground">
            {kindLabel(draft.data.kind)}
            {worksheet.pushedAt && ` · pushed ${relativeTime(worksheet.pushedAt)}`}
          </p>
        </div>
        <div className="text-right">
          <p className={cn('text-sm font-semibold tabular-nums', shown < 0 && 'text-destructive')}>{formatCurrency(shown)}/mo</p>
          <p className={cn('text-xs', differs ? 'text-amber-700' : 'text-muted-foreground')}>{differs ? 'Not on 1003 yet' : 'Matches 1003'}</p>
        </div>
        <ChevronDownIcon className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div className="space-y-4 border-t px-4 py-4">
          <FormGrid>
            <Input label="Label" value={draft.label} onChange={(label) => setDraft((d) => ({ ...d, label }))} span={3} placeholder={kindLabel(draft.data.kind)} />
            {isRental ? (
              <Select
                label="Property"
                required
                value={draft.propertyId}
                options={rentals.map((p) => ({ value: p.id, label: `${p.addressLine}${p.id === subjectPropertyId ? ' (subject)' : ''}` }))}
                onChange={(propertyId) => retarget({ propertyId })}
                placeholder={rentals.length ? 'Choose a property…' : 'No owned properties yet'}
                hint={rentals.length ? undefined : 'Add it under 1003 section 3 (real estate owned) first.'}
                span={3}
              />
            ) : (
              <Select
                label="Job on the 1003"
                required
                value={draft.employmentId ?? (draft.newEmployerName || jobs.length === 0 ? NEW_JOB : null)}
                options={[...jobs.map((e) => ({ value: e.id, label: e.employerName })), { value: NEW_JOB, label: 'New job…' }]}
                onChange={(id) => retarget({ employmentId: id === NEW_JOB ? null : id })}
                span={3}
              />
            )}
            {!isRental && !employment && (
              <Input
                label="Employer or business name"
                required
                value={draft.newEmployerName}
                onChange={(newEmployerName) => retarget({ newEmployerName })}
                hint="Pushing adds this job to the 1003"
                span={3}
              />
            )}
          </FormGrid>

          <WorksheetInputs data={draft.data} onChange={(inputs) => setDraft((d) => ({ ...d, data: { ...d.data, inputs } as WorksheetData }))} />

          <div className="grid gap-3 lg:grid-cols-2">
            <CalcLines lines={result.lines} />
            {net && <CalcLines lines={net.lines} />}
          </div>
          {isRental && property?.id === subjectPropertyId && (
            <Warnings warnings={["This is the subject property: its rent isn't counted in DTI here (only other retained properties are)."]} />
          )}
          <Warnings warnings={result.warnings} />

          {/* Where the result goes, and whether the 1003 already has it. */}
          <div className={cn('rounded-lg border p-3 text-sm', differs ? 'border-primary/30 bg-primary/5' : 'bg-muted/40')}>
            {differs && target.to === 'property' && property && property.rentalIncomeMethod !== target.method ? (
              <p>
                {property.addressLine} uses {property.rentalIncomeMethod === 'schedule_e' ? 'its Schedule E figure' : '75% of the lease'} on the 1003 now. Pushing switches it to{' '}
                {target.method === 'schedule_e' ? 'Schedule E' : '75% of the lease'}, with <span className="font-medium tabular-nums">{formatCurrency(value)}</span>
                {target.method === 'lease' && ' rent'}.
              </p>
            ) : differs ? (
              <p>
                <span className="font-medium">{target.label}</span>
                {where && ` for ${where}`}: the 1003 shows <span className="font-medium tabular-nums">{formatCurrency(current)}</span>, this worksheet gives{' '}
                <span className="font-medium tabular-nums">{formatCurrency(value)}</span>.
              </p>
            ) : (
              <p className="flex items-center gap-2">
                <CheckCircle2Icon className="size-4 text-primary" />
                The 1003 matches: {target.label}
                {where && ` for ${where}`} is {formatCurrency(value)}.
              </p>
            )}
            {blocked && <p className="mt-1 text-xs text-destructive">{blocked}</p>}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            {confirmDelete ? (
              <div className="flex gap-1">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => remove.mutate(worksheet.id, { onSuccess: () => toast.success('Worksheet deleted'), onError: (e) => toast.error(e.message) })}
                >
                  Delete worksheet (the 1003 keeps its figure)
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                  Keep
                </Button>
              </div>
            ) : (
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setConfirmDelete(true)}>
                <Trash2Icon />
                Delete
              </Button>
            )}
            <div className="ml-auto flex gap-2">
              {dirty && (
                <Button size="sm" variant="outline" onClick={onSave} disabled={save.isPending}>
                  {save.isPending ? 'Saving…' : 'Save'}
                </Button>
              )}
              <Button size="sm" onClick={onPush} disabled={push.isPending || missingTarget || !!blocked || (!differs && !dirty)}>
                <SendIcon />
                {push.isPending ? 'Pushing…' : 'Push to 1003'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </li>
  )
}
