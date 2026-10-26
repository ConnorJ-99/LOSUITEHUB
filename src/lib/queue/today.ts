// The Action Queue and the Today list. The assistant prepares items; Connor
// approves, edits or dismisses them. Pure functions, no data access.

export type ActionKind = 'draft_message' | 'task_suggestion' | 'field_update'
export type ActionStatus = 'pending' | 'approved' | 'edited' | 'dismissed'
export type Confidence = 'high' | 'medium' | 'low'

/** Where a suggestion came from: a quote from call notes or a document. */
export interface Source {
  label: string
  quote: string
  page?: number | null
}

export interface DraftMessage {
  channel: 'text' | 'email'
  /** Who it's for, in words (e.g. "Jane Smith (borrower)"). */
  to: string
  subject: string | null
  body: string
}

export interface TaskSuggestion {
  title: string
  dueOn: string | null
}

export interface ActionItem {
  id: string
  loanId: string
  kind: ActionKind
  title: string
  payload: unknown
  sources: Source[]
  confidence: Confidence | null
  status: ActionStatus
  dueOn: string | null
  aiRunId: string | null
  createdAt: string
  decidedAt: string | null
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown) => (typeof v === 'string' ? v : null)
const isIsoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/** Reads a draft message from an item's payload; null if it isn't a valid draft. */
export function readDraft(payload: unknown): DraftMessage | null {
  if (!isObject(payload)) return null
  const channel = payload.channel === 'text' || payload.channel === 'email' ? payload.channel : null
  const body = str(payload.body)
  if (!channel || !body?.trim()) return null
  return { channel, to: str(payload.to) ?? '', subject: channel === 'email' ? str(payload.subject) : null, body }
}

/** Reads a suggested task from an item's payload; null if it isn't valid. */
export function readTask(payload: unknown): TaskSuggestion | null {
  if (!isObject(payload)) return null
  const title = str(payload.title)?.trim()
  if (!title) return null
  return { title, dueOn: isIsoDate(payload.dueOn) ? payload.dueOn : null }
}

/** A field-update item that points at a review screen (e.g. a contract reading); null otherwise. */
export function readReviewLink(kind: ActionKind, payload: unknown): { section: string } | null {
  if (kind !== 'field_update' || !isObject(payload)) return null
  return typeof payload.extractionId === 'string' && payload.section === 'contract' ? { section: 'contract' } : null
}

/** Reads a list of sources, keeping only well-formed entries. */
export function readSources(value: unknown): Source[] {
  if (!Array.isArray(value)) return []
  return value.filter(isObject).flatMap((s) => {
    const quote = str(s.quote)
    if (!quote?.trim()) return []
    return [{ label: str(s.label) ?? 'Source', quote, page: typeof s.page === 'number' ? s.page : null }]
  })
}

/** Approving after changing anything counts as "edited", so the log shows what needed fixing. */
export function decisionFor(original: unknown, final: unknown): 'approved' | 'edited' {
  return JSON.stringify(original) === JSON.stringify(final) ? 'approved' : 'edited'
}

/** The note saved on the file when a drafted message is approved. */
export function approvalNote(draft: DraftMessage): string {
  const what = draft.channel === 'text' ? 'Text' : 'Email'
  const subject = draft.subject ? `\nSubject: ${draft.subject}` : ''
  return `${what} approved${draft.to ? ` for ${draft.to}` : ''} to send:${subject}\n\n${draft.body}`
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

export interface FileRef {
  loanId: string
  borrowerName: string
}

export interface TodayTask extends FileRef {
  id: string
  title: string
  dueOn: string | null
}

export interface LoanDates extends FileRef {
  stage: string
  optionEndDate: string | null
  closingDate: string | null
}

export type TodayEntry =
  | ({ type: 'action'; date: string; item: ActionItem } & FileRef)
  | ({ type: 'task'; date: string; task: TodayTask } & FileRef)
  | ({ type: 'date'; date: string; label: string } & FileRef)

/** How far ahead (and behind) loan deadlines show on Today. */
export const DEADLINE_DAYS_AHEAD = 14
export const DEADLINE_DAYS_BEHIND = 3

const addDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

const TYPE_ORDER: Record<TodayEntry['type'], number> = { date: 0, action: 1, task: 2 }

/**
 * One list for the day: queue items waiting for a decision, open tasks and
 * upcoming loan deadlines, sorted by date. Undated queue items and tasks
 * count as today, so nothing waits unseen. Deadlines show from a few days
 * past to two weeks ahead, for files that aren't closed or lost.
 */
export function buildToday(
  actions: (ActionItem & FileRef)[],
  tasks: TodayTask[],
  loans: LoanDates[],
  today: string,
): TodayEntry[] {
  const from = addDays(today, -DEADLINE_DAYS_BEHIND)
  const to = addDays(today, DEADLINE_DAYS_AHEAD)
  const entries: TodayEntry[] = [
    ...actions
      .filter((a) => a.status === 'pending')
      .map((a): TodayEntry => ({ type: 'action', date: a.dueOn ?? today, item: a, loanId: a.loanId, borrowerName: a.borrowerName })),
    ...tasks.map((t): TodayEntry => ({ type: 'task', date: t.dueOn ?? today, task: t, loanId: t.loanId, borrowerName: t.borrowerName })),
    ...loans
      .filter((l) => l.stage !== 'closed' && l.stage !== 'lost')
      .flatMap((l) =>
        [
          { label: 'Option period ends', date: l.optionEndDate },
          { label: 'Closing', date: l.closingDate },
        ]
          .filter((d): d is { label: string; date: string } => !!d.date && d.date >= from && d.date <= to)
          .map((d): TodayEntry => ({ type: 'date', date: d.date, label: d.label, loanId: l.loanId, borrowerName: l.borrowerName })),
      ),
  ]
  return entries.sort((a, b) => a.date.localeCompare(b.date) || TYPE_ORDER[a.type] - TYPE_ORDER[b.type])
}

export interface TodayGroups {
  overdue: TodayEntry[]
  today: TodayEntry[]
  upcoming: TodayEntry[]
}

/** Splits the list into overdue, today and coming up. */
export function groupToday(entries: TodayEntry[], today: string): TodayGroups {
  return {
    overdue: entries.filter((e) => e.date < today),
    today: entries.filter((e) => e.date === today),
    upcoming: entries.filter((e) => e.date > today),
  }
}
