import { useState } from 'react'
import { MailIcon, MessageSquareIcon } from 'lucide-react'
import { toast } from 'sonner'
import { DateInput, FormGrid, Input, QueueItem, TextArea } from '@/components/shared'
import { EditDialog } from '@/components/urla/parts'
import { useDecideAction, type FileInfo } from '@/lib/api/queue'
import { formatIsoDate } from '@/lib/dates'
import { approvalNote, decisionFor, readDraft, readTask, type ActionItem, type DraftMessage, type TaskSuggestion } from '@/lib/queue/today'

/** Copies text to the clipboard; false if the browser blocks it. */
async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/**
 * One Action Queue item with its decision buttons. Approving a drafted
 * message copies it (for pasting into a text or email) and saves a note;
 * approving a suggested task adds the task. Nothing is ever sent from here.
 */
export function ActionEntry({ item, file, showFile }: { item: ActionItem; file: FileInfo; showFile?: boolean }) {
  const decide = useDecideAction()
  const draft = item.kind === 'draft_message' ? readDraft(item.payload) : null
  const task = item.kind === 'task_suggestion' ? readTask(item.payload) : null
  const [editing, setEditing] = useState(false)
  const [editDraft, setEditDraft] = useState<DraftMessage | null>(draft)
  const [editTask, setEditTask] = useState<TaskSuggestion | null>(task)

  const approveDraft = async (final: DraftMessage) => {
    const text = final.channel === 'email' && final.subject ? `Subject: ${final.subject}\n\n${final.body}` : final.body
    const copied = await copy(text)
    decide.mutate(
      { item, file, status: decisionFor(draft, final), payload: final, note: { kind: final.channel, body: approvalNote(final) } },
      {
        onSuccess: () => {
          toast.success(copied ? 'Copied. Paste it into your phone or email to send.' : 'Approved and saved to notes (copy it from the note).')
          setEditing(false)
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }
  const approveTask = (final: TaskSuggestion) =>
    decide.mutate(
      { item, file, status: decisionFor(task, final), payload: final, task: final },
      {
        onSuccess: () => {
          toast.success('Task added')
          setEditing(false)
        },
        onError: (e) => toast.error(e.message),
      },
    )
  const dismiss = () => decide.mutate({ item, file, status: 'dismissed' }, { onSuccess: () => toast.success('Dismissed'), onError: (e) => toast.error(e.message) })

  const context = showFile ? file.borrowerName : item.dueOn ? `Due ${formatIsoDate(item.dueOn)}` : undefined
  const common = { title: item.title, context, confidence: item.confidence, sources: item.sources, onDismiss: dismiss, busy: decide.isPending }

  if (draft) {
    const Icon = draft.channel === 'text' ? MessageSquareIcon : MailIcon
    return (
      <>
        <QueueItem {...common} approveLabel="Approve and copy" onApprove={() => approveDraft(draft)} onEdit={() => setEditing(true)}>
          <div className="space-y-1 rounded-md bg-muted/50 p-2.5 text-sm">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Icon className="size-3.5" />
              {draft.channel === 'text' ? 'Text' : 'Email'}
              {draft.to && ` to ${draft.to}`}
            </p>
            {draft.subject && <p className="font-medium">{draft.subject}</p>}
            <p className="whitespace-pre-wrap">{draft.body}</p>
          </div>
        </QueueItem>
        {editing && editDraft && (
          <EditDialog title="Edit the draft" open onOpenChange={setEditing} onSubmit={() => approveDraft(editDraft)} saving={decide.isPending} submitLabel="Approve and copy">
            <FormGrid>
              <Input label="To" value={editDraft.to} onChange={(to) => setEditDraft({ ...editDraft, to })} span={6} />
              {editDraft.channel === 'email' && <Input label="Subject" value={editDraft.subject ?? ''} onChange={(subject) => setEditDraft({ ...editDraft, subject })} span={6} />}
              <TextArea label="Message" value={editDraft.body} onChange={(body) => setEditDraft({ ...editDraft, body })} rows={editDraft.channel === 'text' ? 4 : 10} span={6} />
            </FormGrid>
          </EditDialog>
        )}
      </>
    )
  }

  if (task) {
    return (
      <>
        <QueueItem {...common} approveLabel="Add task" onApprove={() => approveTask(task)} onEdit={() => setEditing(true)}>
          <p className="text-sm">
            {task.title}
            {task.dueOn && <span className="text-muted-foreground"> · due {formatIsoDate(task.dueOn)}</span>}
          </p>
        </QueueItem>
        {editing && editTask && (
          <EditDialog title="Edit the task" open onOpenChange={setEditing} onSubmit={() => approveTask(editTask)} saving={decide.isPending} submitLabel="Add task">
            <FormGrid>
              <Input label="Task" value={editTask.title} onChange={(title) => setEditTask({ ...editTask, title })} span={4} />
              <DateInput label="Due" value={editTask.dueOn} onChange={(dueOn) => setEditTask({ ...editTask, dueOn })} span={2} />
            </FormGrid>
          </EditDialog>
        )}
      </>
    )
  }

  // Field updates arrive with call notes → pre-qual; until then they can only be dismissed.
  return <QueueItem {...common} approveDisabledReason={item.kind === 'field_update' ? 'Field updates arrive in a later phase' : "This item couldn't be read"} />
}
