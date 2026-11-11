import { useState } from 'react'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, confirmAction, CurrencyInput, DateInput, FormGrid, Input, PercentInput, Select, TextArea, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { EditDialog } from '@/components/urla/parts'
import { useCompPlans, useDeleteCompPlan, useSaveCompPlan, type CompPlanDraft, type SavedCompPlan } from '@/lib/api/compPlans'
import { activeOn, lenderComp, type CompType } from '@/lib/calc/lenderComp'
import { formatIsoDate, todayIso } from '@/lib/dates'
import { formatCurrency, formatPercent } from '@/lib/format'

const TYPE_LABEL: Record<CompType, string> = { lender_paid: 'Lender-paid', borrower_paid: 'Borrower-paid' }
const PREVIEW_AMOUNT = 400_000

/** "On a $400,000 loan: $11,000". */
function previewLine(p: Pick<SavedCompPlan, 'compPct' | 'minAmount' | 'maxAmount' | 'fees'>) {
  const v = lenderComp(PREVIEW_AMOUNT, p)
  return `On a ${formatCurrency(PREVIEW_AMOUNT)} loan: ${v == null ? '—' : formatCurrency(v)}`
}

function PlanDialog({ lenderId, programs, initial, onClose }: { lenderId: string; programs: { id: string; name: string }[]; initial: SavedCompPlan | null; onClose: () => void }) {
  const save = useSaveCompPlan()
  const [p, setP] = useState<CompPlanDraft>(
    initial ?? { lenderId, compType: 'lender_paid', compPct: 0, minAmount: null, maxAmount: null, fees: [], effectiveFrom: todayIso(), effectiveTo: null, programIds: null, notes: null },
  )
  const set = (patch: Partial<CompPlanDraft>) => setP((x) => ({ ...x, ...patch }))
  const setFee = (i: number, patch: Partial<CompPlanDraft['fees'][number]>) => set({ fees: p.fees.map((f, j) => (j === i ? { ...f, ...patch } : f)) })
  const scoped = p.programIds !== null

  return (
    <EditDialog
      title={initial ? 'Edit comp plan' : 'Add a comp plan'}
      description="A lender's comp change is a new plan with a new start date (end the old one the day before), so older loans keep the plan they closed on."
      open
      onOpenChange={(o) => !o && onClose()}
      saving={save.isPending}
      submitLabel="Save plan"
      onSubmit={() => {
        if (!(p.compPct > 0)) return toast.error('Enter the comp %')
        if (!p.effectiveFrom) return toast.error('Enter the first day of the plan')
        if (scoped && !p.programIds?.length) return toast.error('Pick at least one program, or turn off "Only some programs"')
        save.mutate(p, { onSuccess: () => (toast.success('Comp plan saved'), onClose()), onError: (e) => toast.error(e.message) })
      }}
    >
      <FormGrid>
        <Select label="Comp type" value={p.compType} options={(['lender_paid', 'borrower_paid'] as const).map((v) => ({ value: v, label: TYPE_LABEL[v] }))} onChange={(compType) => set({ compType })} span={2} />
        <PercentInput label="Comp % of loan amount" value={p.compPct || null} onChange={(v) => set({ compPct: v ?? 0 })} required span={2} />
        <CurrencyInput label="Minimum $ (optional)" value={p.minAmount} onChange={(minAmount) => set({ minAmount })} />
        <CurrencyInput label="Maximum $ (optional)" value={p.maxAmount} onChange={(maxAmount) => set({ maxAmount })} />
        <DateInput label="Effective from" value={p.effectiveFrom} onChange={(v) => set({ effectiveFrom: v ?? '' })} required span={3} />
        <DateInput label="Effective to (optional)" value={p.effectiveTo} onChange={(effectiveTo) => set({ effectiveTo })} hint="The last day; blank = still in effect" span={3} />
      </FormGrid>

      <div className="mt-3 space-y-2">
        <p className="text-sm font-medium">Flat fees (optional)</p>
        <p className="text-xs text-muted-foreground">A fee the lender pays the broker, or charges against comp (e.g. a broker admin fee).</p>
        {p.fees.map((f, i) => (
          <div key={i} className="flex flex-wrap items-end gap-2">
            <Input label="Fee" value={f.name} onChange={(name) => setFee(i, { name })} className="min-w-40 flex-1" />
            <div className="w-32"><CurrencyInput label="Amount" value={f.amount || null} onChange={(v) => setFee(i, { amount: v ?? 0 })} /></div>
            <ToggleChipGroup>
              <ToggleChip label="Adds to comp" pressed={f.adds} onChange={() => setFee(i, { adds: true })} />
              <ToggleChip label="Takes off comp" pressed={!f.adds} onChange={() => setFee(i, { adds: false })} />
            </ToggleChipGroup>
            <Button size="icon-sm" variant="ghost" aria-label="Remove fee" onClick={() => set({ fees: p.fees.filter((_, j) => j !== i) })}>
              <Trash2Icon />
            </Button>
          </div>
        ))}
        <Button size="sm" variant="outline" onClick={() => set({ fees: [...p.fees, { name: '', amount: 0, adds: false }] })}>
          <PlusIcon />
          Add a fee
        </Button>
      </div>

      <div className="mt-4 space-y-2">
        <ToggleChip label="Only some programs" pressed={scoped} onChange={(on) => set({ programIds: on ? [] : null })} />
        {scoped && (
          <>
            <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-900">Program-specific comp: confirm with compliance before using.</p>
            <ToggleChipGroup>
              {programs.map((pr) => (
                <ToggleChip key={pr.id} label={pr.name} pressed={!!p.programIds?.includes(pr.id)} onChange={(on) => set({ programIds: on ? [...(p.programIds ?? []), pr.id] : (p.programIds ?? []).filter((x) => x !== pr.id) })} />
              ))}
            </ToggleChipGroup>
          </>
        )}
      </div>

      <div className="mt-3">
        <TextArea label="Notes" value={p.notes ?? ''} onChange={(notes) => set({ notes })} rows={2} />
      </div>
      <p className="mt-3 text-sm font-medium tabular-nums">{previewLine(p)}</p>
    </EditDialog>
  )
}

/** A lender's comp plans (current and past), with the old free-text comp notes above to copy from. */
export function CompPlansCard({ lenderId, compNotes, programs, canEdit }: { lenderId: string; compNotes: string | null; programs: { id: string; name: string }[]; canEdit: boolean }) {
  const plans = useCompPlans()
  const remove = useDeleteCompPlan()
  const [editing, setEditing] = useState<SavedCompPlan | 'new' | null>(null)
  const today = todayIso()
  const mine = (plans.data ?? []).filter((p) => p.lenderId === lenderId)
  const name = (id: string) => programs.find((p) => p.id === id)?.name ?? 'a retired program'

  return (
    <Card
      title="Comp plans"
      description="How this lender pays MPS. A file's revenue is suggested from the plan in effect on its closing date."
      action={
        canEdit && (
          <Button size="sm" variant="outline" onClick={() => setEditing('new')} disabled={plans.isError}>
            <PlusIcon />
            Add plan
          </Button>
        )
      }
    >
      {compNotes && (
        <div className="mb-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
          <p className="text-xs font-medium text-muted-foreground">Comp notes (as typed before; copy into a plan)</p>
          <p className="whitespace-pre-line">{compNotes}</p>
        </div>
      )}
      {plans.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : plans.isError ? (
        <p className="text-sm text-destructive">Comp plans turn on once the lender comp plans database script has run.</p>
      ) : mine.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comp plan yet.</p>
      ) : (
        <ul className="divide-y">
          {mine.map((p) => {
            const now = activeOn(p, today)
            return (
              <li key={p.id} className={cn('flex flex-wrap items-start justify-between gap-2 py-2.5', !now && 'text-muted-foreground')}>
                <div className="min-w-0 text-sm">
                  <p className="font-medium">
                    {TYPE_LABEL[p.compType]} · {formatPercent(p.compPct, 3)}
                    {p.minAmount != null && ` · min ${formatCurrency(p.minAmount)}`}
                    {p.maxAmount != null && ` · max ${formatCurrency(p.maxAmount)}`}
                    {now ? <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">In effect</span> : <span className="ml-2 rounded-full border px-2 py-0.5 text-[10px]">{p.effectiveFrom > today ? 'Starts later' : 'Past'}</span>}
                  </p>
                  <p className="text-xs">
                    {formatIsoDate(p.effectiveFrom)} – {p.effectiveTo ? formatIsoDate(p.effectiveTo) : 'no end date'}
                    {p.programIds ? ` · only ${p.programIds.map(name).join(', ')}` : ' · every program'}
                    {p.fees.length > 0 && ` · ${p.fees.map((f) => `${f.name} ${f.adds ? '+' : '−'}${formatCurrency(f.amount)}`).join(', ')}`}
                  </p>
                  <p className="text-xs tabular-nums">{previewLine(p)}</p>
                  {p.notes && <p className="text-xs whitespace-pre-line">{p.notes}</p>}
                </div>
                {canEdit && (
                  <div className="flex gap-1">
                    <Button size="icon-sm" variant="ghost" aria-label="Edit plan" onClick={() => setEditing(p)}>
                      <PencilIcon />
                    </Button>
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      aria-label="Delete plan"
                      onClick={async () => (await confirmAction('Delete this comp plan? Files that used it keep their revenue but lose the link to the plan. To change comp, end this plan and add a new one instead.', { confirmLabel: 'Delete plan', destructive: true })) && remove.mutate(p.id, { onError: (e) => toast.error(e.message) })}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {editing && <PlanDialog lenderId={lenderId} programs={programs} initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}
