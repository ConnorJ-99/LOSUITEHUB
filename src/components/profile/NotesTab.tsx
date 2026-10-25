import type * as React from 'react'
import { useState } from 'react'
import { Link } from 'react-router'
import {
  ArrowRightIcon,
  MailIcon,
  MessageSquareIcon,
  PencilIcon,
  PhoneIcon,
  PinIcon,
  PinOffIcon,
  StickyNoteIcon,
  Trash2Icon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, TextArea, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { useContactLoans, useStageHistory } from '@/lib/api/loans'
import { useAddNote, useDeleteNote, useNotes, useUpdateNote } from '@/lib/api/notes'
import type { LoanProfile, Note, NoteKind, StageHistoryEntry } from '@/lib/api/types'
import { useAuth } from '@/lib/auth/context'
import { relativeTime } from '@/lib/dates'
import { purposeLabel, stageLabel } from '@/lib/pipeline/stages'
import { NOTE_KIND_OPTIONS, noteKindLabel } from './options'

const kindIcon: Record<NoteKind, LucideIcon> = {
  note: StickyNoteIcon,
  call: PhoneIcon,
  text: MessageSquareIcon,
  email: MailIcon,
  meeting: UsersIcon,
}

const fullTime = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })

function Composer({ loan }: { loan: LoanProfile }) {
  const addNote = useAddNote(loan.borrower!.id, loan.organizationId)
  const [kind, setKind] = useState<NoteKind>('note')
  const [body, setBody] = useState('')

  const submit = () => {
    if (!body.trim()) return
    addNote.mutate(
      { loanId: loan.id, kind, body },
      {
        onSuccess: () => {
          setBody('')
          setKind('note')
        },
        onError: (error) => toast.error(`Could not save note: ${error.message}`),
      },
    )
  }

  return (
    <Card>
      <div className="space-y-3">
        <ToggleChipGroup>
          {NOTE_KIND_OPTIONS.map((o) => (
            <ToggleChip key={o.value} label={o.label} pressed={kind === o.value} onChange={() => setKind(o.value)} />
          ))}
        </ToggleChipGroup>
        <TextArea
          label={kind === 'note' ? 'Note' : `${noteKindLabel(kind)} details`}
          value={body}
          onChange={setBody}
          rows={3}
          placeholder={kind === 'note' ? 'Write a note…' : 'What happened? Next step?'}
          onKeyDown={(e: React.KeyboardEvent) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit()
          }}
        />
        <div className="flex items-center justify-between gap-2">
          <p className="hidden text-xs text-muted-foreground sm:block">Ctrl + Enter to save</p>
          <Button onClick={submit} disabled={!body.trim() || addNote.isPending} className="ml-auto">
            {addNote.isPending ? 'Saving…' : kind === 'note' ? 'Save note' : `Log ${noteKindLabel(kind).toLowerCase()}`}
          </Button>
        </div>
      </div>
    </Card>
  )
}

function NoteItem({ note, loan, otherLoanLabel, canModify }: { note: Note; loan: LoanProfile; otherLoanLabel: string | null; canModify: boolean }) {
  const updateNote = useUpdateNote(loan.borrower!.id)
  const deleteNote = useDeleteNote(loan.borrower!.id)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.body)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const Icon = kindIcon[note.kind]
  const onError = (error: Error) => toast.error(error.message)

  return (
    <li className={cn('flex gap-3 rounded-lg border bg-card p-3', note.pinned && 'border-primary/30 bg-accent/40')}>
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-3.5" />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{noteKindLabel(note.kind)}</span>
          <span>·</span>
          <time dateTime={note.createdAt} title={fullTime.format(new Date(note.createdAt))}>
            {relativeTime(note.createdAt)}
          </time>
          {note.author && <span>· {note.author.name}</span>}
          {otherLoanLabel && note.loanId && (
            <>
              <span>·</span>
              <Link to={`/loans/${note.loanId}?tab=notes`} className="underline-offset-2 hover:underline">
                {otherLoanLabel}
              </Link>
            </>
          )}
        </div>

        {editing ? (
          <div className="space-y-2 pt-1">
            <TextArea label="Edit note" value={draft} onChange={setDraft} rows={3} />
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setDraft(note.body) }}>
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={!draft.trim() || updateNote.isPending}
                onClick={() => updateNote.mutate({ id: note.id, body: draft }, { onSuccess: () => setEditing(false), onError })}
              >
                Save
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm break-words whitespace-pre-wrap">{note.body}</p>
        )}

        {!editing && (
          <div className="flex flex-wrap items-center gap-1 pt-1">
            <Button
              size="xs"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => updateNote.mutate({ id: note.id, pinned: !note.pinned }, { onError })}
            >
              {note.pinned ? <PinOffIcon /> : <PinIcon />}
              {note.pinned ? 'Unpin' : 'Pin'}
            </Button>
            {canModify && (
              <>
                <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => setEditing(true)}>
                  <PencilIcon />
                  Edit
                </Button>
                {confirmDelete ? (
                  <>
                    <Button size="xs" variant="destructive" onClick={() => deleteNote.mutate(note.id, { onError })}>
                      Confirm delete
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => setConfirmDelete(false)}>
                      Keep
                    </Button>
                  </>
                ) : (
                  <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={() => setConfirmDelete(true)}>
                    <Trash2Icon />
                    Delete
                  </Button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </li>
  )
}

function StageEvent({ entry }: { entry: StageHistoryEntry }) {
  return (
    <li className="flex items-center gap-3 px-3 py-1.5 text-xs text-muted-foreground">
      <div className="flex size-7 shrink-0 items-center justify-center">
        <ArrowRightIcon className="size-3.5" />
      </div>
      <p className="min-w-0">
        {entry.fromStage ? (
          <>
            Moved {stageLabel(entry.fromStage)} → <span className="font-medium text-foreground">{stageLabel(entry.toStage)}</span>
          </>
        ) : (
          <>
            Created in <span className="font-medium text-foreground">{stageLabel(entry.toStage)}</span>
          </>
        )}
        {entry.lostReason && <> ({entry.lostReason})</>}
        {' · '}
        <time dateTime={entry.changedAt} title={fullTime.format(new Date(entry.changedAt))}>
          {relativeTime(entry.changedAt)}
        </time>
        {entry.changedBy && ` · ${entry.changedBy.name}`}
      </p>
    </li>
  )
}

type TimelineItem = { type: 'note'; at: string; note: Note } | { type: 'stage'; at: string; entry: StageHistoryEntry }

/** Notes about this person (from all their loans) plus this loan's stage changes, newest first. */
export function NotesTab({ loan }: { loan: LoanProfile }) {
  const { state } = useAuth()
  const notes = useNotes(loan.borrower?.id)
  const history = useStageHistory(loan.id)
  const loans = useContactLoans(loan.borrower?.id)

  if (!loan.borrower) return <EmptyState title="No borrower on this loan" />

  const me = state.status === 'signedIn' ? state.user : null
  const isAdmin = me?.role === 'owner' || me?.role === 'admin'
  const purposeById = new Map((loans.data ?? []).map((l) => [l.id, purposeLabel(l.purpose)]))
  const otherLoanLabel = (n: Note) =>
    n.loanId && n.loanId !== loan.id ? `on ${purposeById.get(n.loanId) ?? 'another'} loan` : null

  const pinned = (notes.data ?? []).filter((n) => n.pinned)
  const timeline: TimelineItem[] = [
    ...(notes.data ?? []).filter((n) => !n.pinned).map((note): TimelineItem => ({ type: 'note', at: note.createdAt, note })),
    ...(history.data ?? []).map((entry): TimelineItem => ({ type: 'stage', at: entry.changedAt, entry })),
  ].sort((a, b) => b.at.localeCompare(a.at))

  const renderNote = (note: Note) => (
    <NoteItem
      key={note.id}
      note={note}
      loan={loan}
      otherLoanLabel={otherLoanLabel(note)}
      canModify={note.author?.id === me?.id || isAdmin}
    />
  )

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Composer loan={loan} />

      {pinned.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Pinned</h2>
          <ul className="space-y-2">{pinned.map(renderNote)}</ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Activity</h2>
        {notes.isLoading || history.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : notes.isError ? (
          <p className="text-sm text-destructive">{notes.error.message}</p>
        ) : (
          <ul className="space-y-2">
            {timeline.map((item) => (item.type === 'note' ? renderNote(item.note) : <StageEvent key={`s${item.entry.id}`} entry={item.entry} />))}
          </ul>
        )}
      </section>
    </div>
  )
}
