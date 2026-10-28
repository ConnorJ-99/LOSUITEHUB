import { useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Card, CurrencyInput, FormGrid, Input, PercentInput, Select, ToggleChip, ToggleChipGroup, confirmAction } from '@/components/shared'
import { MORTGAGE_TYPE_OPTIONS } from '@/components/profile/options'
import type { AmountType, FeeTemplate, PaidBy } from '@/lib/calc'
import { formatCurrency, formatPercent } from '@/lib/format'
import { PURPOSES, purposeLabel, type LoanPurpose } from '@/lib/pipeline/stages'
import { AMOUNT_TYPE_LABEL, FEE_SECTION_LABEL, PAID_BY_LABEL, useDeleteFeeTemplate, useFeeTemplates, useSaveFeeTemplate, type FeeTemplateDraft, type SavedFeeTemplate } from '@/lib/api/pricing'

const SECTIONS: FeeTemplate['section'][] = ['A', 'B', 'C', 'E', 'H']
const SECTION_OPTIONS = SECTIONS.map((s) => ({ value: s, label: FEE_SECTION_LABEL[s] }))
const AMOUNT_TYPE_OPTIONS = (Object.keys(AMOUNT_TYPE_LABEL) as AmountType[]).map((a) => ({ value: a, label: AMOUNT_TYPE_LABEL[a] }))
const PAID_BY_OPTIONS = (Object.keys(PAID_BY_LABEL) as PaidBy[]).map((p) => ({ value: p, label: PAID_BY_LABEL[p] }))
const typeLabel = (t: string) => MORTGAGE_TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t

const amountText = (f: FeeTemplate) => (f.amountType === 'fixed' ? formatCurrency(f.amount) : `${formatPercent(f.amount)} of ${f.amountType === 'pct_loan' ? 'loan' : 'price or value'}`)

/** "Every loan", or the purposes and loan types it's limited to. */
function appliesText(f: FeeTemplate) {
  const parts = [f.purposes?.length ? f.purposes.map((p) => purposeLabel(p as LoanPurpose)).join(', ') : null, f.mortgageTypes?.length ? f.mortgageTypes.map(typeLabel).join(', ') : null].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'Every loan'
}

/** Toggle one value in an optional list (null = all). */
const toggle = (list: string[] | null, value: string, on: boolean) => {
  const next = on ? [...(list ?? []), value] : (list ?? []).filter((v) => v !== value)
  return next.length ? next : null
}

function FeeDialog({ initial, onClose }: { initial: FeeTemplateDraft; onClose: () => void }) {
  const [f, setF] = useState(initial)
  const save = useSaveFeeTemplate()
  const set = <K extends keyof FeeTemplateDraft>(key: K) => (value: FeeTemplateDraft[K]) => setF((s) => ({ ...s, [key]: value }))

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{f.id ? 'Edit fee' : 'New fee'}</DialogTitle>
          <DialogDescription>Added to every Pricing scenario it applies to. It can still be changed on one file.</DialogDescription>
        </DialogHeader>
        <FormGrid className="lg:grid-cols-4">
          <Input label="Fee name" value={f.name} onChange={set('name')} required span={4} />
          <Select label="Section" value={f.section} options={SECTION_OPTIONS} onChange={set('section')} span={2} />
          <Select label="Paid by" value={f.paidBy} options={PAID_BY_OPTIONS} onChange={set('paidBy')} span={2} />
          <Select label="Amount is" value={f.amountType} options={AMOUNT_TYPE_OPTIONS} onChange={set('amountType')} span={2} />
          {f.amountType === 'fixed' ? (
            <CurrencyInput label="Amount" value={f.amount} onChange={(v) => set('amount')(v ?? 0)} span={2} />
          ) : (
            <PercentInput label="Percent" value={f.amount} onChange={(v) => set('amount')(v ?? 0)} span={2} />
          )}
          <Input label="Paid to" value={f.paidTo ?? ''} onChange={(v) => set('paidTo')(v || null)} hint="Optional, e.g. the title company" span={4} />
        </FormGrid>
        <div className="space-y-3">
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Loan purposes (none picked = every purpose)</p>
            <ToggleChipGroup>
              {PURPOSES.map((p) => (
                <ToggleChip key={p.value} label={p.label} pressed={!!f.purposes?.includes(p.value)} onChange={(on) => setF((s) => ({ ...s, purposes: toggle(s.purposes, p.value, on) }))} />
              ))}
            </ToggleChipGroup>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">Loan types (none picked = every type)</p>
            <ToggleChipGroup>
              {MORTGAGE_TYPE_OPTIONS.map((t) => (
                <ToggleChip key={t.value} label={t.label} pressed={!!f.mortgageTypes?.includes(t.value)} onChange={(on) => setF((s) => ({ ...s, mortgageTypes: toggle(s.mortgageTypes, t.value, on) }))} />
              ))}
            </ToggleChipGroup>
          </div>
          <ToggleChipGroup>
            <ToggleChip label="Counts in the APR" pressed={f.apr} onChange={set('apr')} />
            <ToggleChip label="Use this fee" pressed={f.active} onChange={set('active')} />
          </ToggleChipGroup>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() =>
              save.mutate(f, {
                onSuccess: () => {
                  toast.success('Fee list saved')
                  onClose()
                },
                onError: (e) => toast.error(e.message),
              })
            }
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Settings: the company's standard fees, by section. Owners and admins edit; everyone else can read. */
export function FeeListCard({ canEdit }: { canEdit: boolean }) {
  const fees = useFeeTemplates()
  const remove = useDeleteFeeTemplate()
  const [editing, setEditing] = useState<FeeTemplateDraft | null>(null)
  const list = fees.data ?? []
  const nextOrder = (section: FeeTemplate['section']) => Math.max(0, ...list.filter((f) => f.section === section).map((f) => f.sortOrder)) + 10
  const blank = (): FeeTemplateDraft => ({ id: null, key: null, section: 'B', name: '', amountType: 'fixed', amount: 0, purposes: null, mortgageTypes: null, paidBy: 'B', apr: false, paidTo: null, sortOrder: nextOrder('B'), active: true })
  const edit = (f: SavedFeeTemplate) => setEditing({ ...f })

  return (
    <Card
      title="Fee list"
      description={
        fees.isError
          ? 'Run the fees script in Supabase to set up the fee list.'
          : `Standard fees for the Pricing tab, sections A to H. Points, prepaids (F) and escrows (G) are worked out on each file.${canEdit ? '' : ' Only owners and admins can change the list.'}`
      }
      action={
        canEdit &&
        !fees.isError && (
          <Button size="sm" variant="outline" onClick={() => setEditing(blank())}>
            <PlusIcon />
            Add fee
          </Button>
        )
      }
    >
      {fees.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">No fees yet.{canEdit && ' Add your standard fees, or send your fee list to have it loaded.'}</p>
      ) : (
        <div className="space-y-4">
          {SECTIONS.map((section) => ({ section, fees: list.filter((f) => f.section === section) }))
            .filter((g) => g.fees.length)
            .map((g) => (
              <section key={g.section}>
                <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{FEE_SECTION_LABEL[g.section]}</h3>
                <ul className="divide-y">
                  {g.fees.map((f) => (
                    <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                      <div className={cn('min-w-0 flex-1', !f.active && 'text-muted-foreground')}>
                        <p className={cn('text-sm', !f.active && 'line-through')}>{f.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {appliesText(f)}
                          {f.paidBy !== 'B' && ` · paid by ${PAID_BY_LABEL[f.paidBy].toLowerCase()}`}
                          {f.apr && ' · APR'}
                          {!f.active && ' · turned off'}
                        </p>
                      </div>
                      <span className="text-sm tabular-nums">{amountText(f)}</span>
                      {canEdit && (
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" onClick={() => edit(f)}>
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={remove.isPending}
                            onClick={async () => (await confirmAction(`Delete "${f.name}"? Files that changed this fee keep their change.`, { confirmLabel: 'Delete', destructive: true })) && remove.mutate(f.id, { onSuccess: () => toast.success('Deleted'), onError: (e) => toast.error(e.message) })}
                          >
                            Delete
                          </Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
        </div>
      )}
      {editing && <FeeDialog initial={editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}
