// What a nurture check-in shows in the Action Queue (Connor, 2026-11-16;
// buyer-nurture Step 6): the kind, the milestone and its target, the plan's
// goal, last contact and why it was drafted, plus High priority.
import { useState } from 'react'
import { useLeadFollowupMeta } from '@/lib/api/leadFollowups'
import { formatIsoDate } from '@/lib/dates'
import { lastContactLabel } from '@/lib/leads/nextAction'
import { NURTURE_KIND_LABEL, type NurtureContext } from '@/lib/nurture/followups'

export function NurtureContextBlock({ itemId, nurture }: { itemId: string; nurture: NurtureContext }) {
  const meta = useLeadFollowupMeta()
  const [now] = useState(() => new Date())
  const high = meta.data?.get(itemId)?.priority === 'high'
  return (
    <div className="mb-2 space-y-1 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        {high && <span className="rounded bg-[#D4483B] px-1.5 py-0.5 text-[11px] font-bold text-white">High priority</span>}
        <span className="rounded bg-[#2E8B6A]/15 px-1.5 py-0.5 text-[11px] font-semibold text-[#1f6b51]">Nurture · {NURTURE_KIND_LABEL[nurture.kind]}</span>
        {nurture.milestoneTitle && (
          <span className="rounded bg-muted px-1.5 py-0.5">
            {nurture.milestoneTitle}
            {nurture.targetDate && <span className="opacity-75"> · by {formatIsoDate(nurture.targetDate)}</span>}
          </span>
        )}
        <span className="text-muted-foreground">{lastContactLabel(nurture.lastContactAt, now)}</span>
      </div>
      {nurture.goal && <p className="text-muted-foreground">Goal: {nurture.goal}</p>}
      {nurture.reason && <p className="text-muted-foreground">Why: {nurture.reason}</p>}
    </div>
  )
}
