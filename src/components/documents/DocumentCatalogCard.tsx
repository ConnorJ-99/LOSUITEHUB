import { useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Card, Input, Select, TextArea, ToggleChip, confirmAction } from '@/components/shared'
import { DOCUMENT_KIND_GROUPS, type DocumentKind } from '@/lib/api/documents'
import { useDeleteCatalogItem, useDocumentCatalog, useSaveCatalogItem } from '@/lib/api/uploadRequests'
import { CATEGORY_LABEL, type CatalogCategory, type CatalogItem } from '@/lib/documents/uploadRequests'

const CATEGORIES = Object.keys(CATEGORY_LABEL) as CatalogCategory[]
const KIND_OPTIONS = DOCUMENT_KIND_GROUPS.flatMap((g) => g.kinds.map(([value, label]) => ({ value: value as DocumentKind, label })))
type Draft = Omit<CatalogItem, 'id' | 'builtIn' | 'key'> & { id: string | null }

function ItemDialog({ initial, onClose }: { initial: Draft; onClose: () => void }) {
  const [d, setD] = useState(initial)
  const save = useSaveCatalogItem()
  const set = <K extends keyof Draft>(k: K) => (v: Draft[K]) => setD((s) => ({ ...s, [k]: v }))
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{d.id ? 'Edit catalog item' : 'New catalog item'}</DialogTitle>
          <DialogDescription>What you can pick when you request documents. The instructions are what the borrower sees on the upload page.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <Input label="Name" value={d.label} onChange={set('label')} required />
          <TextArea label="Instructions for the borrower" value={d.instructions} onChange={set('instructions')} rows={3} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="Group" value={d.category} options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))} onChange={set('category')} />
            <Input label="Time period" value={d.period ?? ''} onChange={(v) => set('period')(v || null)} placeholder="e.g. 2 months" />
            <Select label="Document type" value={d.kind} options={KIND_OPTIONS} onChange={set('kind')} />
          </div>
          <ToggleChip label="Show in the list" pressed={d.active} onChange={set('active')} />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={save.isPending || !d.label.trim()} onClick={() => save.mutate(d, { onSuccess: () => (toast.success('Catalog saved'), onClose()), onError: (e) => toast.error(e.message) })}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Settings → Document catalog (UI pass Part 3). Owners and admins edit; everyone can read. */
export function DocumentCatalogCard({ canEdit }: { canEdit: boolean }) {
  const catalog = useDocumentCatalog()
  const remove = useDeleteCatalogItem()
  const [editing, setEditing] = useState<Draft | null>(null)
  const list = catalog.data ?? []
  const nextOrder = Math.max(0, ...list.map((c) => c.sortOrder)) + 10
  return (
    <Card
      title="Document catalog"
      description={
        list.length === 0
          ? 'Run the upload links script (20270113000000) in Supabase to add the catalog.'
          : 'The documents you can pick when you request documents from a borrower. Built-in items can be reworded or hidden; your own can be deleted.'
      }
      action={
        canEdit &&
        list.length > 0 && (
          <Button size="sm" variant="outline" onClick={() => setEditing({ id: null, category: 'other', label: '', instructions: '', period: null, kind: 'other', sortOrder: nextOrder, active: true })}>
            <PlusIcon />
            Add item
          </Button>
        )
      }
    >
      <div className="space-y-4">
        {CATEGORIES.map((cat) => {
          const items = list.filter((c) => c.category === cat)
          if (!items.length) return null
          return (
            <section key={cat}>
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{CATEGORY_LABEL[cat]}</h3>
              <ul className="divide-y">
                {items.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <div className={cn('min-w-0 flex-1', !c.active && 'text-muted-foreground')}>
                      <p className={cn('text-sm font-medium', !c.active && 'line-through')}>
                        {c.label}
                        {c.period && <span className="font-normal text-muted-foreground"> · {c.period}</span>}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {c.instructions}
                        {!c.builtIn && ' · your item'}
                        {!c.active && ' · hidden'}
                      </p>
                    </div>
                    {canEdit && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing({ ...c })}>
                          Edit
                        </Button>
                        {!c.builtIn && (
                          <Button size="sm" variant="ghost" disabled={remove.isPending} onClick={async () => (await confirmAction(`Delete "${c.label}"? Files already asked for it keep their item.`, { confirmLabel: 'Delete', destructive: true })) && remove.mutate(c.id, { onSuccess: () => toast.success('Deleted'), onError: (e) => toast.error(e.message) })}>
                            Delete
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
      {editing && <ItemDialog initial={editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}
