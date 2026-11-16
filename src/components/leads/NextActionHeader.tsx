// The file header's lead line (Connor, 2026-11-16): the Next Action tag, when
// they expect to be ready, and days since last contact. Lead stages only;
// hidden before the next action script has run.
import { useState } from 'react'
import { cn } from 'cn'
import { useLoanNextAction } from '@/lib/api/nextAction'
import { contactIsStale, isLeadStage, lastContactLabel } from '@/lib/leads/nextAction'
import { centralToday, readyChip } from '@/lib/pipeline/card'
import { NextActionTag } from './NextActionTag'

export function NextActionHeader({ loanId, stage, timeline }: { loanId: string; stage: string; timeline: string | null }) {
  const q = useLoanNextAction(loanId)
  const [now] = useState(() => new Date())
  if (!isLeadStage(stage) || !q.data) return null
  const chip = readyChip({ timeline, readyOn: q.data.readyOn }, centralToday(now))
  return (
    <>
      <NextActionTag loanId={loanId} value={q.data.nextAction} manual={q.data.manual} />
      {chip && (
        <span className={cn('rounded-md px-1.5 py-0.5 text-[0.7rem] font-medium', chip.now ? 'bg-emerald-50 text-emerald-800' : 'bg-indigo-50 text-indigo-900')}>
          {chip.label}
          {chip.detail && <span className="font-normal opacity-75"> · {chip.detail}</span>}
        </span>
      )}
      <span className={cn('rounded-md px-1.5 py-0.5 text-[0.7rem] font-medium', contactIsStale(q.data.lastContactAt, now) ? 'bg-red-50 text-[#a8352b]' : 'bg-muted')}>{lastContactLabel(q.data.lastContactAt, now)}</span>
    </>
  )
}
