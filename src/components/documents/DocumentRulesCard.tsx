import { useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Card, FormGrid, Input, Select, TextArea, ToggleChip, confirmAction } from '@/components/shared'
import { CONDITION_LABEL, useDeleteDocumentRule, useDocumentRules, useSaveDocumentRule, type RuleDraft, type SavedRule } from '@/lib/api/documentRules'
import { DOCUMENT_KIND_GROUPS, DOCUMENT_KIND_LABEL, type DocumentKind } from '@/lib/api/documents'
import type { DocumentCondition } from '@/lib/prequal/nextStep'

const CONDITIONS = Object.keys(CONDITION_LABEL) as DocumentCondition[]
const CONDITION_OPTIONS = CONDITIONS.map((c) => ({ value: c, label: CONDITION_LABEL[c] }))
const KIND_OPTIONS = DOCUMENT_KIND_GROUPS.flatMap((g) => g.kinds.map(([value, label]) => ({ value: value as DocumentKind, label })))

function RuleDialog({ initial, onClose }: { initial: RuleDraft; onClose: () => void }) {
  const [r, setR] = useState(initial)
  const save = useSaveDocumentRule()
  const set = <K extends keyof RuleDraft>(key: K) => (value: RuleDraft[K]) => setR((s) => ({ ...s, [key]: value }))

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{r.id ? 'Edit checklist item' : 'New checklist item'}</DialogTitle>
          <DialogDescription>Asked for on every file where it applies. {'{income}'} becomes the income type (e.g. Social Security) and {'{each_job}'} adds "for each job" when someone has more than one.</DialogDescription>
        </DialogHeader>
        <FormGrid className="lg:grid-cols-1">
          {r.id ? (
            <Input label="Asked for when" value={CONDITION_LABEL[r.condition]} readOnly />
          ) : (
            <Select label="Asked for when" value={r.condition} options={CONDITION_OPTIONS} onChange={set('condition')} />
          )}
          <Input label="Short wording" value={r.shortText} onChange={set('shortText')} required hint="Used inside sentences, e.g. in a text: “pay stubs (last 30 days)”" />
          <TextArea label="Full wording" value={r.fullText} onChange={set('fullText')} required rows={2} hint="Used in emails and on the Documents tab checklist." />
          <Select label="Document type" value={r.kind} options={KIND_OPTIONS} onChange={set('kind')} hint="Uploads of this type can be matched to the request." />
        </FormGrid>
        <ToggleChip label="Ask for this" pressed={r.active} onChange={set('active')} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() =>
              save.mutate(r, {
                onSuccess: () => {
                  toast.success('Checklist saved')
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

/** Settings: which documents to ask for, and when. Owners and admins edit; everyone else can read. */
export function DocumentRulesCard({ canEdit }: { canEdit: boolean }) {
  const rules = useDocumentRules()
  const remove = useDeleteDocumentRule()
  const [editing, setEditing] = useState<RuleDraft | null>(null)
  const list = rules.data ?? []
  // Before the rules script is run, the starter list is shown but can't be saved.
  const installed = list.some((r) => r.id !== r.key)
  const editable = canEdit && installed
  const groups = CONDITIONS.map((c) => ({ condition: c, rules: list.filter((r) => r.condition === c) })).filter((g) => g.rules.length)
  const nextOrder = Math.max(0, ...list.map((r) => r.sortOrder)) + 10
  const edit = (r: SavedRule) => setEditing({ ...r })

  return (
    <Card
      title="Document checklist"
      description={
        !installed
          ? 'Showing the starter list. Run the document rules script in Supabase to make it editable.'
          : canEdit
            ? 'What to ask for on each file. Built-in items can be reworded or turned off; your own items can be deleted.'
            : 'What to ask for on each file. Only owners and admins can change it.'
      }
      action={
        editable && (
          <Button size="sm" variant="outline" onClick={() => setEditing({ id: null, key: null, condition: 'everyone', shortText: '', fullText: '', kind: 'other', sortOrder: nextOrder, active: true })}>
            <PlusIcon />
            Add item
          </Button>
        )
      }
    >
      {rules.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.condition}>
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{CONDITION_LABEL[g.condition]}</h3>
              <ul className="divide-y">
                {g.rules.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <div className={cn('min-w-0 flex-1', !r.active && 'text-muted-foreground')}>
                      <p className={cn('text-sm', !r.active && 'line-through')}>{r.fullText}</p>
                      <p className="text-xs text-muted-foreground">
                        {DOCUMENT_KIND_LABEL[r.kind]}
                        {!r.builtIn && ' · your item'}
                        {!r.active && ' · turned off'}
                      </p>
                    </div>
                    {editable && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => edit(r)}>
                          Edit
                        </Button>
                        {!r.builtIn && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={remove.isPending}
                            onClick={async () => (await confirmAction(`Delete "${r.shortText}"? Files already tracking it keep their item.`, { confirmLabel: 'Delete', destructive: true })) && remove.mutate(r.id, { onSuccess: () => toast.success('Deleted'), onError: (e) => toast.error(e.message) })}
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {editing && <RuleDialog initial={editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}
