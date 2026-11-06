import type * as React from 'react'
import { useState } from 'react'
import { Link } from 'react-router'
import { cn } from 'cn'
import { AlarmClockIcon, ArrowDownIcon, ArrowUpIcon, CheckIcon, PlusIcon, StarIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input as BaseInput } from '@/components/ui/input'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Card } from '@/components/shared'
import { usePipeline } from '@/lib/api/loans'
import { useAddPriorityItem, useToggleTask, useUpdatePriorityItems, type MyTask } from '@/lib/api/tasks'
import { useAuth } from '@/lib/auth/context'
import { dueLabel, formatIsoDate, todayIso } from '@/lib/dates'
import { fullName } from '@/lib/pipeline/helpers'
import { priorityTone, toneBorder } from '@/lib/pipeline/priority'
import { PRIORITY_ACTIONS, actionLabel, itemHeading, itemLink, itemNote, itemTitle, moveItem, priorityList, snoozeDate, type PriorityAction, type PriorityItem } from '@/lib/queue/priorityList'

type Item = MyTask & PriorityItem

/** Each action's chip color. */
export const ACTION_CHIP: Record<PriorityAction, string> = {
  lock: 'bg-urgent/10 text-urgent',
  call: 'bg-primary/10 text-primary',
  documents: 'bg-money/10 text-money',
  price: 'bg-nurture/10 text-nurture',
  other: 'bg-muted text-muted-foreground',
}

export function ActionChip({ action }: { action: PriorityAction }) {
  return <span className={cn('shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold', ACTION_CHIP[action])}>{actionLabel(action)}</span>
}

const control = 'h-8 rounded-md border bg-card px-2 text-sm focus:border-ring focus:outline-none'

/** The file picker's choice for an office or personal to-do. */
const NO_FILE = 'none'

/** Pick a file (or no file) and an action; the date is optional, and so is the note unless there's no file. */
function AddItem() {
  const { state } = useAuth()
  const organizationId = state.status === 'signedIn' ? state.user.organizationId : null
  const pipeline = usePipeline()
  const add = useAddPriorityItem()
  const [loanId, setLoanId] = useState('')
  const [action, setAction] = useState<PriorityAction>('call')
  const [dueOn, setDueOn] = useState('')
  const [note, setNote] = useState('')

  // Open files, Priority Leads first, then by name.
  const files = (pipeline.data ?? [])
    .filter((l) => l.stage !== 'closed' && l.stage !== 'lost')
    .map((l) => ({ id: l.id, name: l.borrower ? fullName(l.borrower) : 'No borrower', star: l.priority }))
    .sort((a, b) => Number(b.star) - Number(a.star) || a.name.localeCompare(b.name))

  const canAdd = !!loanId && (loanId !== NO_FILE || !!note.trim())

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!canAdd || !organizationId) return
    add.mutate(
      { loanId: loanId === NO_FILE ? null : loanId, organizationId, action, title: itemTitle(action, note), dueOn: dueOn || null },
      {
        onSuccess: () => {
          setLoanId('')
          setDueOn('')
          setNote('')
        },
        onError: (error) => toast.error(`Could not add it: ${error.message}`),
      },
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap gap-2">
      <select aria-label="File" value={loanId} onChange={(e) => setLoanId(e.target.value)} className={cn(control, 'min-w-40 flex-1', !loanId && 'text-muted-foreground')}>
        <option value="">Pick a file…</option>
        <option value={NO_FILE}>No file (office / personal)</option>
        {files.map((f) => (
          <option key={f.id} value={f.id}>
            {f.star ? '★ ' : ''}
            {f.name}
          </option>
        ))}
      </select>
      <select aria-label="Action" value={action} onChange={(e) => setAction(e.target.value as PriorityAction)} className={cn(control, 'w-36')}>
        {PRIORITY_ACTIONS.map((a) => (
          <option key={a.value} value={a.value}>
            {a.label}
          </option>
        ))}
      </select>
      <BaseInput type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} aria-label="Due date (optional)" className="h-8 w-34 shrink-0 tabular-nums" />
      <BaseInput value={note} onChange={(e) => setNote(e.target.value)} placeholder={loanId === NO_FILE ? 'What needs doing? *' : 'Note (optional)'} aria-label="Note" className="h-8 min-w-40 flex-[2]" />
      <Button type="submit" size="sm" disabled={!canAdd || !organizationId || add.isPending}>
        <PlusIcon />
        Add
      </Button>
    </form>
  )
}

/** A file's item opens the file; a no-file to-do has nowhere to go. */
function ItemBody({ link, children }: { link: string | null; children: React.ReactNode }) {
  const className = 'flex min-w-0 flex-1 items-center gap-2.5'
  return link ? (
    <Link to={link} className={cn(className, 'hover:underline')}>
      {children}
    </Link>
  ) : (
    <div className={className}>{children}</div>
  )
}

function ItemRow({ item, today, showing, snoozed }: { item: Item; today: string; showing: Item[]; snoozed?: boolean }) {
  const update = useUpdatePriorityItems()
  const toggle = useToggleTask(item.loanId)
  const [pickDate, setPickDate] = useState(false)
  const { heading, showNote } = itemHeading(item)
  const note = showNote ? itemNote(item) : null
  const link = itemLink(item.loanId, item.action, item.stage, item.sourceKey)
  const due = item.dueOn ? dueLabel(item.dueOn, today) : null
  const onError = (e: Error) => toast.error(e.message)
  const snooze = (until: string | null) => update.mutate([{ id: item.id, snoozedUntil: until }], { onSuccess: () => toast.success(until ? `Snoozed until ${formatIsoDate(until)}` : 'Back on the list'), onError })
  const move = (direction: 'up' | 'down') => {
    const order = moveItem(showing, item.id, direction)
    if (order) update.mutate(order, { onError })
  }
  const group = showing.filter((i) => i.starred === item.starred)
  const index = group.indexOf(item)

  return (
    <li className={cn('flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-card px-2 py-2 shadow-soft sm:flex-nowrap', toneBorder(priorityTone([item.dueOn], null, today)))}>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label={item.starred ? `Unstar ${heading}` : `Star ${heading}`}
        aria-pressed={item.starred}
        disabled={update.isPending || snoozed}
        onClick={() => update.mutate([{ id: item.id, starred: !item.starred, sortOrder: null }], { onError })}
        className={item.starred ? 'text-money' : 'text-muted-foreground'}
      >
        <StarIcon className={cn(item.starred && 'fill-current')} />
      </Button>
      <ItemBody link={link}>
        <ActionChip action={item.action} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{heading}</span>
          {(note || due || snoozed) && (
            <span className="block truncate text-xs text-muted-foreground">
              {snoozed && item.snoozedUntil && <span>Back {formatIsoDate(item.snoozedUntil)}</span>}
              {snoozed && (note || due) && ' · '}
              {due && <span className={cn(due.overdue && 'font-medium text-destructive')}>{due.text}</span>}
              {due && note && ' · '}
              {note}
            </span>
          )}
        </span>
      </ItemBody>
      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        {snoozed ? (
          <Button size="xs" variant="outline" disabled={update.isPending} onClick={() => snooze(null)}>
            Unsnooze
          </Button>
        ) : (
          <>
            <Button variant="ghost" size="icon-xs" aria-label={`Move ${heading} up`} disabled={update.isPending || index <= 0} onClick={() => move('up')}>
              <ArrowUpIcon />
            </Button>
            <Button variant="ghost" size="icon-xs" aria-label={`Move ${heading} down`} disabled={update.isPending || index >= group.length - 1} onClick={() => move('down')}>
              <ArrowDownIcon />
            </Button>
            {pickDate ? (
              <BaseInput
                type="date"
                autoFocus
                min={snoozeDate(today, 'tomorrow')}
                aria-label="Snooze until"
                className="h-7 w-34 tabular-nums"
                onBlur={() => setPickDate(false)}
                onChange={(e) => {
                  if (e.target.value > today) {
                    setPickDate(false)
                    snooze(e.target.value)
                  }
                }}
              />
            ) : (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-xs" aria-label={`Snooze ${heading}`} disabled={update.isPending}>
                    <AlarmClockIcon />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => snooze(snoozeDate(today, 'tomorrow'))}>Snooze until tomorrow</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => snooze(snoozeDate(today, 'week'))}>Snooze a week</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setPickDate(true)}>Pick a date…</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        )}
        <Button
          size="xs"
          variant="outline"
          disabled={toggle.isPending}
          onClick={() => toggle.mutate({ id: item.id, done: true }, { onSuccess: () => toast.success(`${actionLabel(item.action)} · ${heading}: done`), onError })}
        >
          <CheckIcon />
          Done
        </Button>
      </div>
    </li>
  )
}

/** What to do next, file by file: starred first, then the order set by hand, then soonest due. */
export function PriorityListCard({ tasks }: { tasks: MyTask[] }) {
  const today = todayIso()
  const [showSnoozed, setShowSnoozed] = useState(false)
  const items = tasks.filter((t): t is Item => t.action !== null)
  const { showing, snoozed } = priorityList(items, today)

  return (
    <Card title="Priority list" className="border-t-2 border-t-primary">
      <AddItem />
      {showing.length === 0 ? (
        <p className="pt-3 text-sm text-muted-foreground">Nothing on the list. Pick a file and what it needs above.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {showing.map((item) => (
            <ItemRow key={item.id} item={item} today={today} showing={showing} />
          ))}
        </ol>
      )}
      {snoozed.length > 0 && (
        <div className="mt-3 border-t pt-2">
          <button type="button" onClick={() => setShowSnoozed((v) => !v)} className="text-xs text-muted-foreground hover:text-foreground">
            {showSnoozed ? 'Hide' : 'Show'} snoozed ({snoozed.length})
          </button>
          {showSnoozed && (
            <ol className="mt-2 space-y-2">
              {snoozed.map((item) => (
                <ItemRow key={item.id} item={item} today={today} showing={showing} snoozed />
              ))}
            </ol>
          )}
        </div>
      )}
    </Card>
  )
}
