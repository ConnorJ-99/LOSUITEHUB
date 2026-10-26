import { useState } from 'react'
import { MailIcon, MessageSquareIcon, PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Card, FormGrid, Input, TextArea, ToggleChip } from '@/components/shared'
import { useDeleteTemplate, useMessageTemplates, useSaveTemplate, type MessageChannel, type TemplateDraft } from '@/lib/api/assistant'
import { MAX_TEXT_LENGTH, MERGE_FIELDS } from '../../../supabase/functions/assistant/followUp'

const blank = (channel: MessageChannel): TemplateDraft => ({ id: null, name: '', channel, subject: null, body: '' })

function TemplateDialog({ initial, onClose }: { initial: TemplateDraft; onClose: () => void }) {
  const [t, setT] = useState(initial)
  const save = useSaveTemplate()
  const set = <K extends keyof TemplateDraft>(key: K) => (value: TemplateDraft[K]) => setT((s) => ({ ...s, [key]: value }))
  const tooLong = t.channel === 'text' && t.body.length > MAX_TEXT_LENGTH

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t.id ? 'Edit template' : 'New template'}</DialogTitle>
          <DialogDescription>The assistant starts from this wording and personalizes it from the file. You still review every draft.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex gap-2">
            <ToggleChip label="Text" pressed={t.channel === 'text'} onChange={() => set('channel')('text')} />
            <ToggleChip label="Email" pressed={t.channel === 'email'} onChange={() => set('channel')('email')} />
          </div>
          <FormGrid className="lg:grid-cols-1">
            <Input label="Name" value={t.name} onChange={set('name')} required placeholder="e.g. Check in after showing" />
            {t.channel === 'email' && <Input label="Subject" value={t.subject ?? ''} onChange={(v) => set('subject')(v || null)} required />}
            <TextArea
              label="Message"
              value={t.body}
              onChange={set('body')}
              required
              rows={t.channel === 'email' ? 8 : 4}
              error={tooLong ? `Texts should stay under ${MAX_TEXT_LENGTH} characters (${t.body.length} now).` : undefined}
              hint={`${t.channel === 'text' ? `${t.body.length}/${MAX_TEXT_LENGTH} characters. ` : 'The signature with NMLS numbers is added automatically. '}Merge fields: ${MERGE_FIELDS.map((f) => `{{${f}}}`).join(' ')}`}
            />
          </FormGrid>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() =>
              save.mutate(t, {
                onSuccess: () => {
                  toast.success('Template saved')
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

/** Settings: Connor's saved texts and emails for the assistant to start from. */
export function MessageTemplatesCard() {
  const templates = useMessageTemplates()
  const remove = useDeleteTemplate()
  const [editing, setEditing] = useState<TemplateDraft | null>(null)

  return (
    <Card
      title="Message templates"
      description="Saved texts and emails. When you draft a follow-up, the assistant can start from one and personalize it."
      action={
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing(blank('text'))}>
            <PlusIcon />
            Text
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(blank('email'))}>
            <PlusIcon />
            Email
          </Button>
        </div>
      }
    >
      {templates.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : templates.isError ? (
        <p className="text-sm text-destructive">{templates.error.message}</p>
      ) : (templates.data ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">No templates yet.</p>
      ) : (
        <ul className="divide-y">
          {templates.data!.map((t) => {
            const Icon = t.channel === 'text' ? MessageSquareIcon : MailIcon
            return (
              <li key={t.id} className="flex items-start justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Icon className="size-4 text-muted-foreground" />
                    {t.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">{t.subject ? `${t.subject} · ` : ''}{t.body}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button size="xs" variant="ghost" onClick={() => setEditing(t)}>
                    Edit
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost"
                    disabled={remove.isPending}
                    onClick={() => {
                      if (!window.confirm(`Delete the template "${t.name}"?`)) return
                      remove.mutate(t.id, { onSuccess: () => toast.success('Template deleted'), onError: (e) => toast.error(e.message) })
                    }}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {editing && <TemplateDialog key={editing.id ?? editing.channel} initial={editing} onClose={() => setEditing(null)} />}
    </Card>
  )
}
