import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormGrid, Input, Select, TextArea } from '@/components/shared'
import { useSaveLender, type LenderDraft } from '@/lib/api/lenders'
import { LENDER_CHANNELS, LENDER_STATUSES } from '@/lib/products/taxonomy'

const options = <T extends string>(l: { values: T[]; label: Record<T, string> }) => l.values.map((v) => ({ value: v, label: l.label[v] }))

/** Add or edit a lender: name, status (Approved / Application pending / Not signed up / Inactive), channel, AE and portal. */
export function LenderDialog({ initial, onClose, onSaved }: { initial: LenderDraft; onClose: () => void; onSaved?: (id: string) => void }) {
  const [l, setL] = useState(initial)
  const save = useSaveLender()
  const set = <K extends keyof LenderDraft>(key: K) => (value: LenderDraft[K]) => setL((s) => ({ ...s, [key]: value }))
  const text = (key: 'shortName' | 'aeName' | 'aePhone' | 'aeEmail' | 'portalUrl' | 'compNotes' | 'notes') => (v: string) => set(key)(v || null)

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{l.id ? `Edit ${initial.name}` : 'Add a lender'}</DialogTitle>
          <DialogDescription>Not-signed-up lenders still show in Product Search, with a warning to check with them first.</DialogDescription>
        </DialogHeader>
        <FormGrid className="lg:grid-cols-4">
          <Input label="Lender name" value={l.name} onChange={set('name')} required span={3} />
          <Input label="Short name" value={l.shortName ?? ''} onChange={text('shortName')} hint="For the logo tile" />
          <Select label="Status" value={l.status} options={options(LENDER_STATUSES)} onChange={set('status')} span={2} />
          <Select label="Channel" value={l.channel} options={options(LENDER_CHANNELS)} onChange={set('channel')} span={2} />
          <Input label="Account executive" value={l.aeName ?? ''} onChange={text('aeName')} span={2} />
          <Input label="AE phone" type="tel" value={l.aePhone ?? ''} onChange={text('aePhone')} />
          <Input label="AE email" type="email" value={l.aeEmail ?? ''} onChange={text('aeEmail')} />
          <Input label="Lender portal" value={l.portalUrl ?? ''} onChange={text('portalUrl')} span={2} placeholder="https://" />
          <Input label="States" value={(l.states ?? []).join(', ')} onChange={(v) => set('states')(v.split(/[\s,]+/).filter(Boolean).map((s) => s.toUpperCase().slice(0, 2)))} hint="e.g. TX, OK. Blank = not checked" span={2} />
          <TextArea label="Comp notes" value={l.compNotes ?? ''} onChange={text('compNotes')} rows={2} span={2} />
          <TextArea label="Notes" value={l.notes ?? ''} onChange={text('notes')} rows={2} span={2} />
        </FormGrid>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() =>
              save.mutate(l, {
                onSuccess: (id) => {
                  toast.success(l.id ? 'Lender saved' : 'Lender added')
                  onSaved?.(id)
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
