import { useState } from 'react'
import { useNavigate } from 'react-router'
import { CalendarClockIcon, CopyIcon, MailIcon, MessageSquareIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { confirmAction, DateInput, FormGrid, Input, QueueItem, TextArea } from '@/components/shared'
import { EditDialog } from '@/components/urla/parts'
import { useGhlStatus } from '@/lib/api/ghl'
import { ScheduleDialog } from '@/components/messages/ScheduleDialog'
import { useScheduleMessage, useSendMessage } from '@/lib/api/messages'
import { scheduleLabel } from '@/lib/messaging/schedule'
import { useDecideAction, type FileInfo } from '@/lib/api/queue'
import { draftContactId } from '@/lib/queue/drafts'
import { formatIsoDate } from '@/lib/dates'
import { approvalNote, decisionFor, readDraft, readReviewLink, readTask, type ActionItem, type DraftMessage, type TaskSuggestion } from '@/lib/queue/today'

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
  const review = readReviewLink(item.kind, item.payload)
  const navigate = useNavigate()
  const [editing, setEditing] = useState(false)
  const [editDraft, setEditDraft] = useState<DraftMessage | null>(draft)
  const [editTask, setEditTask] = useState<TaskSuggestion | null>(task)
  const ghl = useGhlStatus()
  const send = useSendMessage()
  const schedule = useScheduleMessage()
  // One key per draft: a double click or retry reuses it, so it can't go twice.
  const [sendKey, setSendKey] = useState(() => `queue:${item.id}`)

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
  // Drafts that know who they're for can go out through GHL, with every server check (consent, hours, test mode, the LO's number).
  const sendTo = draft ? draftContactId(item.payload) : null
  const canSend = !!sendTo && ghl.data?.ready === true
  const sendDraft = async (final: DraftMessage) => {
    if (!sendTo) return
    if (final.channel === 'email' && !final.subject?.trim()) return toast.error('An email needs a subject. Edit it first.')
    const what = final.channel === 'text' ? 'this text' : 'this email'
    if (!(await confirmAction(`Send ${what} to ${final.to || file.borrowerName}? It goes out through GHL.`, { confirmLabel: final.channel === 'text' ? 'Send text' : 'Send email' }))) return
    send.mutate(
      { contactId: sendTo, loanId: file.loanId, channel: final.channel, body: final.body, subject: final.channel === 'email' ? final.subject : null, idempotencyKey: sendKey },
      {
        onSuccess: (r) => {
          if (r.alreadySent && r.error) return toast.error(`That message already failed: ${r.error}`)
          decide.mutate(
            { item, file, status: decisionFor(draft, final), payload: final },
            { onSuccess: () => setEditing(false), onError: (e) => toast.error(e.message) },
          )
          toast.success(r.alreadySent ? 'That message was already sent.' : `${final.channel === 'text' ? 'Text' : 'Email'} sent`)
        },
        // GHL refused it, so another try needs a new key; a blocked send (consent, hours) keeps the draft waiting.
        onError: (e) => {
          toast.error(e.message)
          if (/GHL didn't send it/.test(e.message)) setSendKey(crypto.randomUUID())
        },
      },
    )
  }
  // Schedule: approve it now (in your name), the timer sends it then; the draft leaves the queue and shows under Scheduled.
  const [scheduling, setScheduling] = useState(false)
  const scheduleDraft = (final: DraftMessage, sendAt: Date) => {
    if (!sendTo) return
    if (final.channel === 'email' && !final.subject?.trim()) return toast.error('An email needs a subject. Edit it first.')
    schedule.mutate(
      { contactId: sendTo, loanId: file.loanId, channel: final.channel, body: final.body, subject: final.channel === 'email' ? final.subject : null, idempotencyKey: `${sendKey}:at:${sendAt.toISOString()}`, sendAt },
      {
        onSuccess: () => {
          decide.mutate({ item, file, status: decisionFor(draft, final), payload: final }, { onError: (e) => toast.error(e.message) })
          toast.success(`Scheduled for ${scheduleLabel(sendAt)}`)
          setScheduling(false)
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
        <QueueItem
          {...common}
          busy={common.busy || send.isPending}
          approveLabel={canSend ? (draft.channel === 'text' ? 'Send text' : 'Send email') : 'Approve and copy'}
          onApprove={() => (canSend ? sendDraft(draft) : approveDraft(draft))}
          onEdit={() => setEditing(true)}
          extra={
            canSend && (
              <>
                <Button size="sm" variant="outline" onClick={() => setScheduling(true)} disabled={common.busy || send.isPending || schedule.isPending} title="Approve it now and send it at a time you pick">
                  <CalendarClockIcon />
                  Schedule…
                </Button>
                <Button size="sm" variant="outline" onClick={() => approveDraft(draft)} disabled={common.busy || send.isPending} title="Copy it to send from your phone or email instead">
                  <CopyIcon />
                  Copy instead
                </Button>
              </>
            )
          }
        >
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
        {scheduling && sendTo && (
          <ScheduleDialog
            what={draft.channel === 'text' ? 'this text' : 'this email'}
            busy={schedule.isPending || decide.isPending}
            onClose={() => setScheduling(false)}
            onSchedule={(sendAt) => scheduleDraft(draft, sendAt)}
          />
        )}
        {editing && editDraft && (
          <EditDialog
            title="Edit the draft"
            open
            onOpenChange={setEditing}
            onSubmit={() => (canSend ? sendDraft(editDraft) : approveDraft(editDraft))}
            saving={decide.isPending || send.isPending}
            submitLabel={canSend ? (editDraft.channel === 'text' ? 'Send text' : 'Send email') : 'Approve and copy'}
          >
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

  if (review) {
    // Decided on the review screen (apply or set aside), so there's no Dismiss here.
    return <QueueItem {...common} onDismiss={undefined} approveLabel="Review" onApprove={() => navigate(`/loans/${file.loanId}?tab=${review.section}`)} />
  }

  // Other field updates arrive with call notes → pre-qual; until then they can only be dismissed.
  return <QueueItem {...common} approveDisabledReason={item.kind === 'field_update' ? 'Field updates arrive in a later phase' : "This item couldn't be read"} />
}
