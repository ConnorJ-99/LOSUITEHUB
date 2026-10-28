import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormGrid, Input, Select, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { useEditProgram, useSetProgramActive, type LenderProgram, type ProgramEdit } from '@/lib/api/lenders'
import { DOC_TYPES, FEATURES, LIENS, MATRIX_PURPOSES, PRODUCT_FAMILIES, TERM_OPTIONS, termChoices } from '@/lib/products/taxonomy'

const options = <T extends string>(l: { values: readonly T[]; label: Record<T, string> }) => l.values.map((v) => ({ value: v, label: l.label[v] }))

/** A row of toggle chips for picking several values from a list. */
export function ChipPicker<T extends string>({ label, values, labels, picked, disabled, onChange }: { label: string; values: readonly T[]; labels: Record<T, string>; picked: T[]; disabled?: boolean; onChange: (next: T[]) => void }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <ToggleChipGroup>
        {values.map((v) => (
          <ToggleChip key={v} label={labels[v]} pressed={picked.includes(v)} disabled={disabled} onChange={(on) => onChange(on ? [...picked, v] : picked.filter((x) => x !== v))} />
        ))}
      </ToggleChipGroup>
    </div>
  )
}

/** Edit a program's product details and the terms it offers. Its matrix changes only through a new matrix. */
export function ProgramDialog({ lenderId, program, onClose }: { lenderId: string; program: LenderProgram; onClose: () => void }) {
  const save = useEditProgram(lenderId)
  const setActive = useSetProgramActive(lenderId)
  const [p, setP] = useState<ProgramEdit>({ id: program.id, name: program.name, family: program.family, lien: program.lien, docTypes: program.docTypes, features: program.features, purposes: program.purposes, termOptions: program.termOptions })
  const set = <K extends keyof ProgramEdit>(key: K) => (value: ProgramEdit[K]) => setP((x) => ({ ...x, [key]: value }))
  const choices = termChoices(p.lien)
  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit program</DialogTitle>
          <DialogDescription>A program is a loan product; the terms it offers are options, not separate programs. To change its matrix, type or read a new one.</DialogDescription>
        </DialogHeader>
        <FormGrid>
          <Input label="Program name" value={p.name} onChange={set('name')} placeholder="Conventional" span={2} />
          <Select label="Product family" value={p.family} options={options(PRODUCT_FAMILIES)} onChange={set('family')} span={2} />
          <Select label="Lien" value={p.lien} options={options(LIENS)} onChange={(lien) => setP((x) => ({ ...x, lien, termOptions: x.termOptions.filter((t) => termChoices(lien).includes(t)) }))} span={2} />
        </FormGrid>
        <div className="space-y-2">
          <ChipPicker label="Terms offered" values={choices} labels={TERM_OPTIONS.label} picked={p.termOptions} onChange={set('termOptions')} />
          <ChipPicker label="Doc types" values={DOC_TYPES.values} labels={DOC_TYPES.label} picked={p.docTypes} onChange={set('docTypes')} />
          <ChipPicker label="Purposes" values={MATRIX_PURPOSES.values} labels={MATRIX_PURPOSES.label} picked={p.purposes} onChange={set('purposes')} />
          <ChipPicker label="Features" values={FEATURES.values} labels={FEATURES.label} picked={p.features} onChange={set('features')} />
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            className="sm:mr-auto"
            disabled={setActive.isPending}
            onClick={() => setActive.mutate({ id: program.id, active: !program.active }, { onSuccess: () => (toast.success(program.active ? 'Retired: it no longer shows in Product Search' : 'Back in Product Search'), onClose()), onError: (e) => toast.error(e.message) })}
          >
            {program.active ? 'Retire from searches' : 'Put back in searches'}
          </Button>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Cancel
          </Button>
          <Button disabled={save.isPending} onClick={() => save.mutate(p, { onSuccess: () => (toast.success('Program saved'), onClose()), onError: (e) => toast.error(e.message) })}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
