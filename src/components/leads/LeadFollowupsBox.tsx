// Today's "Lead follow-ups" box (Connor, 2026-11-16; plan step 4): how many
// lead follow-ups are waiting, how many are high priority and how many are
// overdue, with the top few. A click jumps to that draft in the list below.
// Each loan officer sees their own files' drafts; the Admin login sees all
// (the file rule). Hidden when there are none.
import { MegaphoneIcon } from 'lucide-react'
import { cn } from 'cn'
import { Card } from '@/components/shared'
import type { LeadFollowupMeta } from '@/lib/api/leadFollowups'
import { isSnoozed, KIND_LABEL, readLeadContext } from '@/lib/leads/followups'

export interface LeadBoxItem {
  id: string
  borrowerName: string
  dueOn: string | null
  payload: unknown
}

const jump = (id: string) => {
  const el = document.getElementById(`action-${id}`)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('ring-2', 'ring-primary')
  setTimeout(() => el.classList.remove('ring-2', 'ring-primary'), 1600)
}

export function LeadFollowupsBox({ items, meta, today }: { items: LeadBoxItem[]; meta: Map<string, LeadFollowupMeta> | null | undefined; today: string }) {
  if (!meta) return null
  const all = items.flatMap((i) => {
    const m = meta.get(i.id)
    const lead = readLeadContext(i.payload)
    return m && lead ? [{ ...i, m, lead }] : []
  })
  const snoozed = all.filter((i) => isSnoozed(i.m.snoozedUntil, today)).length
  const waiting = all.filter((i) => !isSnoozed(i.m.snoozedUntil, today))
  if (!waiting.length && !snoozed) return null
  const high = waiting.filter((i) => i.m.priority === 'high')
  const overdue = waiting.filter((i) => i.dueOn && i.dueOn < today)
  const top = [...waiting].sort((a, b) => Number(b.m.priority === 'high') - Number(a.m.priority === 'high') || (a.dueOn ?? '').localeCompare(b.dueOn ?? '')).slice(0, 5)
  const stat = (n: number, label: string, tone?: string) => (
    <div className="rounded-md bg-muted/60 px-3 py-2">
      <p className={cn('text-xl font-bold tabular-nums', n > 0 && tone)}>{n}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  )
  return (
    <Card title="Lead follow-ups" description="Drafted for your leads when they're due. Nothing sends until you press Send." className="border-t-2 border-t-[#1670BE]">
      <div className="grid grid-cols-3 gap-2">
        {stat(waiting.length, 'Waiting')}
        {stat(high.length, 'High priority', 'text-[#D4483B]')}
        {stat(overdue.length, 'Overdue', 'text-[#D4483B]')}
      </div>
      {top.length > 0 && (
        <ul className="mt-3 space-y-1">
          {top.map((i) => (
            <li key={i.id}>
              <button type="button" onClick={() => jump(i.id)} className="-mx-2 flex w-[calc(100%+1rem)] items-center gap-2 rounded-md px-2 py-1 text-left text-sm hover:bg-muted">
                <MegaphoneIcon className="size-3.5 shrink-0 text-primary" />
                <span className="min-w-0 flex-1 truncate font-medium">{i.borrowerName}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{KIND_LABEL[i.lead.nextAction]}</span>
                {i.m.priority === 'high' && <span className="shrink-0 rounded bg-[#D4483B] px-1 text-[10px] font-bold text-white">HIGH</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {snoozed > 0 && <p className="mt-2 text-xs text-muted-foreground">{snoozed} snoozed</p>}
    </Card>
  )
}
