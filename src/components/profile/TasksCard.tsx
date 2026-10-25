import type * as React from 'react'
import { useState } from 'react'
import { CheckIcon, PlusIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Input as BaseInput } from '@/components/ui/input'
import { Card } from '@/components/shared'
import { useAddTask, useDeleteTask, useLoanTasks, useToggleTask } from '@/lib/api/tasks'
import type { Task } from '@/lib/api/types'
import { dueLabel, todayIso } from '@/lib/dates'

function TaskRow({ task, onToggle, onDelete }: { task: Task; onToggle: () => void; onDelete: () => void }) {
  const done = !!task.completedAt
  const due = task.dueOn ? dueLabel(task.dueOn, todayIso()) : null
  return (
    <li className="group flex items-start gap-2.5 py-2">
      <button
        type="button"
        onClick={onToggle}
        aria-label={done ? `Mark "${task.title}" not done` : `Mark "${task.title}" done`}
        aria-pressed={done}
        className={cn(
          'mt-0.5 flex size-4.5 shrink-0 items-center justify-center rounded-full border transition-colors',
          done ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground/40 hover:border-primary',
        )}
      >
        {done && <CheckIcon className="size-3" />}
      </button>
      <div className="min-w-0 flex-1">
        <p className={cn('text-sm', done && 'text-muted-foreground line-through')}>{task.title}</p>
        {due && !done && <p className={cn('text-xs', due.overdue ? 'font-medium text-destructive' : 'text-muted-foreground')}>{due.text}</p>}
      </div>
      <Button
        variant="ghost"
        size="icon-xs"
        onClick={onDelete}
        aria-label={`Delete "${task.title}"`}
        className="text-muted-foreground opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100"
      >
        <XIcon />
      </Button>
    </li>
  )
}

/** Follow-ups for this loan. The first open one is the "next task". */
export function TasksCard({ loanId, organizationId }: { loanId: string; organizationId: string }) {
  const tasks = useLoanTasks(loanId)
  const addTask = useAddTask(loanId, organizationId)
  const toggleTask = useToggleTask(loanId)
  const deleteTask = useDeleteTask(loanId)
  const [title, setTitle] = useState('')
  const [dueOn, setDueOn] = useState<string>(todayIso())
  const [showDone, setShowDone] = useState(false)

  const open = (tasks.data ?? []).filter((t) => !t.completedAt)
  const done = (tasks.data ?? []).filter((t) => t.completedAt)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim()) return
    addTask.mutate(
      { title, dueOn },
      {
        onSuccess: () => setTitle(''),
        onError: (error) => toast.error(`Could not add task: ${error.message}`),
      },
    )
  }
  const onError = (error: Error) => toast.error(error.message)

  return (
    <Card title="Tasks">
      <form onSubmit={submit} className="flex gap-2">
        <BaseInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a task…" aria-label="New task" className="min-w-0 flex-1" />
        <BaseInput type="date" value={dueOn} onChange={(e) => setDueOn(e.target.value)} aria-label="Due date" className="w-34 shrink-0 tabular-nums" />
        <Button type="submit" size="icon" disabled={!title.trim() || addTask.isPending} aria-label="Add task">
          <PlusIcon />
        </Button>
      </form>

      {tasks.isLoading ? (
        <p className="pt-3 text-sm text-muted-foreground">Loading…</p>
      ) : open.length === 0 ? (
        <p className="pt-3 text-sm text-muted-foreground">No open tasks. Add the next follow-up above.</p>
      ) : (
        <ul className="mt-1 divide-y">
          {open.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onToggle={() => toggleTask.mutate({ id: task.id, done: true }, { onError })}
              onDelete={() => deleteTask.mutate(task.id, { onError })}
            />
          ))}
        </ul>
      )}

      {done.length > 0 && (
        <div className="mt-2 border-t pt-2">
          <button type="button" onClick={() => setShowDone((v) => !v)} className="text-xs text-muted-foreground hover:text-foreground">
            {showDone ? 'Hide' : 'Show'} completed ({done.length})
          </button>
          {showDone && (
            <ul className="divide-y">
              {done.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  onToggle={() => toggleTask.mutate({ id: task.id, done: false }, { onError })}
                  onDelete={() => deleteTask.mutate(task.id, { onError })}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}
