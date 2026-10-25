import type * as React from 'react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { CurrencyInput, DateInput, FormGrid, Input, PercentInput, Select, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { useSaveLien, type LienInput } from '@/lib/api/properties'
import type { Lien } from '@/lib/api/types'

const POSITION_OPTIONS = [
  { value: 'first', label: '1st lien' },
  { value: 'second', label: '2nd lien' },
] as const

/** Add or edit an existing mortgage on a property. */
export function LienDialog({
  loanId,
  organizationId,
  propertyId,
  lien,
  takenPositions,
  open,
  onOpenChange,
}: {
  loanId: string
  organizationId: string
  propertyId: string
  lien: Lien | null
  /** Positions already used by other liens on this property. */
  takenPositions: Lien['position'][]
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const save = useSaveLien(loanId, organizationId)
  const [form, setForm] = useState<LienInput>(() =>
    lien
      ? { position: lien.position, lender: lien.lender, balance: lien.balance, noteRate: lien.noteRate, monthlyPayment: lien.monthlyPayment, isHeloc: lien.isHeloc, originatedOn: lien.originatedOn, isTexasCashOut: lien.isTexasCashOut }
      : { position: takenPositions.includes('first') ? 'second' : 'first', lender: '', balance: null, noteRate: null, monthlyPayment: null, isHeloc: false, originatedOn: null, isTexasCashOut: false },
  )
  const set = <K extends keyof LienInput>(key: K) => (value: LienInput[K]) => setForm((f) => ({ ...f, [key]: value }))
  const positionTaken = takenPositions.includes(form.position)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (positionTaken) return
    save.mutate(
      { ...form, id: lien?.id, propertyId },
      {
        onSuccess: () => {
          toast.success(lien ? 'Lien saved' : 'Lien added')
          onOpenChange(false)
        },
        onError: (error) => toast.error(`Could not save lien: ${error.message}`),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{lien ? 'Edit existing lien' : 'Add existing lien'}</DialogTitle>
          <DialogDescription>A mortgage or HELOC already on this property.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <FormGrid className="lg:grid-cols-4">
            <Select
              label="Position"
              value={form.position}
              onChange={set('position')}
              options={POSITION_OPTIONS}
              required
              error={positionTaken ? 'This property already has a lien in that position' : undefined}
            />
            <Input label="Lender / servicer" value={form.lender ?? ''} onChange={set('lender')} span={3} />
            <CurrencyInput label="Current balance" value={form.balance} onChange={set('balance')} span={2} />
            <PercentInput label="Rate" value={form.noteRate} onChange={set('noteRate')} />
            <CurrencyInput label="Monthly P&I" value={form.monthlyPayment} onChange={set('monthlyPayment')} />
            <DateInput label="Originated / closed on" value={form.originatedOn} onChange={set('originatedOn')} span={2} />
          </FormGrid>
          <ToggleChipGroup>
            <ToggleChip label="HELOC" pressed={form.isHeloc} onChange={set('isHeloc')} />
            <ToggleChip label="Texas cash-out §50(a)(6)" pressed={form.isTexasCashOut} onChange={set('isTexasCashOut')} />
          </ToggleChipGroup>
          {form.isTexasCashOut && !form.originatedOn && (
            <p className="text-xs text-amber-700">Add the closing date so the 1-year seasoning check can run.</p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending || positionTaken}>
              {save.isPending ? 'Saving…' : lien ? 'Save' : 'Add lien'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
