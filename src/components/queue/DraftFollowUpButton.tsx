import { useState } from 'react'
import { SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AiOffNote, Select, TextArea, ToggleChip } from '@/components/shared'
import { useAiStatus, useDraftFollowUp, useMessageTemplates, type MessageChannel } from '@/lib/api/assistant'

const NO_TEMPLATE = 'none'

/**
 * "Draft a follow-up": Connor picks text or email, optionally a saved
 * template and what it's about. The assistant reads the file and recent
 * notes and puts a draft in the Action Queue for review.
 */
export function DraftFollowUpButton({ loanId, borrowerFirstName }: { loanId: string; borrowerFirstName: string | null }) {
  const [open, setOpen] = useState(false)
  const [channel, setChannel] = useState<MessageChannel>('text')
  const [templateId, setTemplateId] = useState<string>(NO_TEMPLATE)
  const [instructions, setInstructions] = useState('')
  const templates = useMessageTemplates()
  const draft = useDraftFollowUp(loanId)
  const ai = useAiStatus()
  const aiOff = ai.data?.ready === false
  const forChannel = (templates.data ?? []).filter((t) => t.channel === channel)

  const pickChannel = (c: MessageChannel) => {
    setChannel(c)
    setTemplateId(NO_TEMPLATE)
  }

  const submit = () =>
    draft.mutate(
      { channel, templateId: templateId === NO_TEMPLATE ? null : templateId, instructions: instructions.trim() || null },
      {
        onSuccess: () => {
          toast.success('Draft added to the Action Queue for your review')
          setInstructions('')
          setOpen(false)
        },
        onError: (e) => toast.error(e.message),
      },
    )

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)} disabled={!borrowerFirstName}>
        <SparklesIcon />
        Draft a follow-up
      </Button>
      <Dialog open={open} onOpenChange={(o) => !draft.isPending && setOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Draft a follow-up{borrowerFirstName ? ` to ${borrowerFirstName}` : ''}</DialogTitle>
            <DialogDescription>The assistant reads this file and its recent notes, then puts a draft in the Action Queue. Nothing is sent.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              <ToggleChip label="Text" pressed={channel === 'text'} onChange={() => pickChannel('text')} />
              <ToggleChip label="Email" pressed={channel === 'email'} onChange={() => pickChannel('email')} />
            </div>
            <Select
              label="Start from a template"
              value={templateId}
              onChange={setTemplateId}
              options={[{ value: NO_TEMPLATE, label: 'No template' }, ...forChannel.map((t) => ({ value: t.id, label: t.name }))]}
              hint={forChannel.length ? undefined : `No ${channel} templates yet. Add them in Settings.`}
            />
            <TextArea
              label="What's it about? (optional)"
              value={instructions}
              onChange={setInstructions}
              maxLength={500}
              rows={3}
              placeholder="e.g. Check in after the showing and ask for last month's bank statements"
            />
            {aiOff ? (
              <AiOffNote what="Drafting follow-ups" reason={ai.data?.reason} instead="Until then, copy a saved template (Settings → Message templates) into your text or email." />
            ) : (
              <p className="text-xs text-muted-foreground">File facts and recent notes are sent to Claude (Anthropic) to write the draft. No SSNs or account numbers are stored or sent.</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={draft.isPending}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={draft.isPending || aiOff}>
              {draft.isPending ? 'Drafting…' : 'Draft it'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
