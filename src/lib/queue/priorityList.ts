// The priority list on the Today page: open tasks with an action (Lock, Call,
// Get documents, Price estimates, Other). Ordering, snoozing and where a click
// goes. Pure functions, no data access.

import type { PipelineStage } from '@/lib/pipeline/stages'

export type PriorityAction = 'lock' | 'call' | 'documents' | 'price' | 'other'

export const PRIORITY_ACTIONS: readonly { value: PriorityAction; label: string }[] = [
  { value: 'lock', label: 'Lock' },
  { value: 'call', label: 'Call' },
  { value: 'documents', label: 'Get documents' },
  { value: 'price', label: 'Price estimates' },
  { value: 'other', label: 'Other' },
]

export const actionLabel = (action: PriorityAction) => PRIORITY_ACTIONS.find((a) => a.value === action)?.label ?? 'Other'

export const isPriorityAction = (v: unknown): v is PriorityAction => PRIORITY_ACTIONS.some((a) => a.value === v)

export interface PriorityItem {
  id: string
  /** Null for an office or personal to-do with no file. */
  loanId: string | null
  action: PriorityAction
  title: string
  dueOn: string | null
  starred: boolean
  sortOrder: number | null
  snoozedUntil: string | null
  createdAt: string
}

/** The title saved for a new item: the note, else the action's name. */
export function itemTitle(action: PriorityAction, note: string): string {
  return note.trim() || actionLabel(action)
}

/** The note to show under the action, or null when the title is just the action's name. */
export function itemNote(item: Pick<PriorityItem, 'action' | 'title'>): string | null {
  return item.title.trim() === actionLabel(item.action) ? null : item.title
}

/** The line in bold: the borrower, or for a no-file to-do the note itself. */
export function itemHeading(item: Pick<PriorityItem, 'loanId' | 'title'> & { borrowerName: string | null }): { heading: string; showNote: boolean } {
  return item.loanId ? { heading: item.borrowerName ?? 'No borrower', showNote: true } : { heading: item.title, showNote: false }
}

/** Snoozed until a day after today = hidden today. */
export const isSnoozed = (item: Pick<PriorityItem, 'snoozedUntil'>, today: string) => !!item.snoozedUntil && item.snoozedUntil > today

/** Starred first, then the order set by hand (unordered last), then soonest due (undated last), then oldest. */
export function sortPriority<T extends PriorityItem>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      Number(b.starred) - Number(a.starred) ||
      (a.sortOrder ?? Number.MAX_SAFE_INTEGER) - (b.sortOrder ?? Number.MAX_SAFE_INTEGER) ||
      (a.dueOn ?? '9999-12-31').localeCompare(b.dueOn ?? '9999-12-31') ||
      a.createdAt.localeCompare(b.createdAt),
  )
}

/** Splits the list into what shows today (in order) and what's snoozed (soonest back first). */
export function priorityList<T extends PriorityItem>(items: T[], today: string): { showing: T[]; snoozed: T[] } {
  const sorted = sortPriority(items)
  return {
    showing: sorted.filter((i) => !isSnoozed(i, today)),
    snoozed: sorted.filter((i) => isSnoozed(i, today)).sort((a, b) => a.snoozedUntil!.localeCompare(b.snoozedUntil!)),
  }
}

/**
 * Moves one item up or down among the items showing, staying inside its group
 * (starred items stay above the rest). Returns the new sort order for every
 * item in that group, or null when it can't move that way.
 */
export function moveItem(showing: PriorityItem[], id: string, direction: 'up' | 'down'): { id: string; sortOrder: number }[] | null {
  const item = showing.find((i) => i.id === id)
  if (!item) return null
  const group = showing.filter((i) => i.starred === item.starred)
  const from = group.indexOf(item)
  const to = direction === 'up' ? from - 1 : from + 1
  if (to < 0 || to >= group.length) return null
  const ids = group.map((i) => i.id)
  ;[ids[from], ids[to]] = [ids[to], ids[from]]
  return ids.map((itemId, sortOrder) => ({ id: itemId, sortOrder }))
}

const SNOOZE_DAYS = { tomorrow: 1, week: 7 } as const

/** The day an item comes back: tomorrow, or a week from today. */
export function snoozeDate(today: string, length: keyof typeof SNOOZE_DAYS): string {
  const d = new Date(`${today}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + SNOOZE_DAYS[length])
  return d.toISOString().slice(0, 10)
}

/** From Submitted / Processing on, documents are asked for as loan conditions. */
const CONDITION_STAGES: PipelineStage[] = ['processing', 'clear_to_close']

/** The Mon/Wed/Fri "Price refi benchmarks" task the timer gives each Admin. */
export const REFI_BENCHMARK_TASK_PREFIX = 'refi_benchmarks:'

/** Where clicking an item goes: the file, opened on the tab that action needs (nowhere for a no-file to-do, except the refi benchmark task). */
export function itemLink(loanId: string | null, action: PriorityAction, stage: PipelineStage | null, sourceKey: string | null = null): string | null {
  if (!loanId) return sourceKey?.startsWith(REFI_BENCHMARK_TASK_PREFIX) ? '/refi-watch/benchmarks' : null
  const tab =
    action === 'lock' || action === 'price'
      ? 'estimates'
      : action === 'documents'
        ? stage && CONDITION_STAGES.includes(stage)
          ? 'conditions'
          : 'documents'
        : action === 'call'
          ? 'messages'
          : 'overview'
  return `/loans/${loanId}?tab=${tab}`
}
