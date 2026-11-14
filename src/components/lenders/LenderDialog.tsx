import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormGrid, Input, Select, TextArea, confirmAction } from '@/components/shared'
import { useDeleteLender, useSaveLender, type LenderClauseFields, type LenderDraft } from '@/lib/api/lenders'
import { LENDER_CHANNELS, LENDER_STATUSES } from '@/lib/products/taxonomy'

const options = <T extends string>(l: { values: T[]; label: Record<T, string> }) => l.values.map((v) => ({ value: v, label: l.label[v] }))

/** Add or edit a lender: name, status (Approved / Application pending / Not signed up / Inactive), channel, AE and portal. */
export function LenderDialog({ initial, onClose, onSaved }: { initial: LenderDraft; onClose: () => void; onSaved?: (id: string) => void }) {
  const [l, setL] = useState(initial)
  const save = useSaveLender()
  const remove = useDeleteLender()
  const set = <K extends keyof LenderDraft>(key: K) => (value: LenderDraft[K]) => setL((s) => ({ ...s, [key]: value }))
  const clause = (key: keyof LenderClauseFields) => (v: string) => setL((s) => ({ ...s, clause: { ...s.clause!, [key]: v || null } }))
  const text = (key: 'shortName' | 'aeName' | 'aePhone' | 'aeEmail' | 'portalUrl' | 'compNotes' | 'mortgageeClause' | 'notes') => (v: string) => set(key)(v || null)

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
          {l.clause ? (
            <>
              <p className="pt-2 text-sm font-semibold sm:col-span-2 lg:col-span-4">Mortgagee clause</p>
              <Input label="Clause name" value={l.clause.clauseName ?? ''} onChange={clause('clauseName')} placeholder="e.g. United Wholesale Mortgage, LLC ISAOA/ATIMA" span={4} />
              <Input label="Address line 1" value={l.clause.addressLine1 ?? ''} onChange={clause('addressLine1')} span={2} />
              <Input label="Address line 2" value={l.clause.addressLine2 ?? ''} onChange={clause('addressLine2')} span={2} />
              <Input label="City" value={l.clause.city ?? ''} onChange={clause('city')} span={2} />
              <Input label="State" value={l.clause.state ?? ''} onChange={(v) => clause('state')(v.toUpperCase().slice(0, 2))} />
              <Input label="ZIP" value={l.clause.zip ?? ''} onChange={clause('zip')} />
              <Input label="Insurance email" type="email" value={l.clause.insuranceEmail ?? ''} onChange={clause('insuranceEmail')} span={2} hint="Where agents send binders / EOIs" />
              <Input label="Insurance fax" type="tel" value={l.clause.insuranceFax ?? ''} onChange={clause('insuranceFax')} span={2} />
              <TextArea label="Clause notes" value={l.clause.notes ?? ''} onChange={clause('notes')} rows={2} span={4} />
              {l.mortgageeClause && <TextArea label="Old one-line clause" value={l.mortgageeClause} onChange={text('mortgageeClause')} rows={2} span={4} hint="Used only when the fields above are blank" />}
            </>
          ) : (
            <TextArea label="Mortgagee clause" value={l.mortgageeClause ?? ''} onChange={text('mortgageeClause')} rows={2} span={2} hint="Shown on this lender's estimates (for the insurance agent)" />
          )}
          <TextArea label="Notes" value={l.notes ?? ''} onChange={text('notes')} rows={2} span={2} />
        </FormGrid>
        <DialogFooter>
          {l.id && (
            <Button
              variant="ghost"
              className="mr-auto text-destructive hover:text-destructive"
              disabled={remove.isPending}
              onClick={async () => {
                if (!(await confirmAction(`Delete ${initial.name} with all of its programs, matrices, documents and contacts? This can't be undone. To keep its history, set its status to Inactive instead.`, { confirmLabel: 'Delete lender', destructive: true }))) return
                remove.mutate(l.id!, {
                  onSuccess: () => {
                    toast.success(`${initial.name} deleted`)
                    onClose()
                  },
                  onError: (e) => toast.error(e.message),
                })
              }}
            >
              Delete lender
            </Button>
          )}
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
