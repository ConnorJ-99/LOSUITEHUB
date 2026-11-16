// Reassess for Prequalification (Connor, 2026-11-16; buyer-nurture Step 8): a
// look at the plan's progress and what's still unverified, then the file goes
// back to New lead (contacted), never straight to Pre-Qualified. Nurture
// check-ins stop, the plan stays as approved (read only), and lead
// follow-ups take over.
import { useState } from 'react'
import { toast } from 'sonner'
import { FormGrid, TextArea } from '@/components/shared'
import { EditDialog } from '@/components/urla/parts'
import { useNurtureUpdates, useReassess } from '@/lib/api/nurtureFollowups'
import { useReadinessPlans } from '@/lib/api/readinessPlans'
import { todayIso } from '@/lib/dates'
import { isOpenUpdate } from '@/lib/nurture/followups'
import { milestoneCounts } from '@/lib/nurture/plan'

export function ReassessDialog({ loanId, borrowerName, onClose }: { loanId: string; borrowerName: string; onClose: () => void }) {
  const plans = useReadinessPlans(loanId)
  const updates = useNurtureUpdates(loanId)
  const reassess = useReassess(loanId)
  const [note, setNote] = useState('')
  const approved = plans.data?.find((p) => p.status === 'approved')
  const counts = approved ? milestoneCounts(approved.plan, todayIso()) : null
  const unverified = (updates.data ?? []).filter(isOpenUpdate).length
  const submit = () =>
    reassess.mutate(note.trim() || null, {
      onSuccess: () => {
        toast.success(`${borrowerName} is back in New lead. Update the 1003 with their new figures, then prequalify as usual.`)
        onClose()
      },
      onError: (e) => toast.error(e.message),
    })
  return (
    <EditDialog title="Reassess for Prequalification" open onOpenChange={(o) => !o && onClose()} onSubmit={submit} saving={reassess.isPending} submitLabel="Move back to New lead">
      <div className="space-y-2 text-sm">
        <p>
          {approved && counts ? (
            <>
              Plan v{approved.version}: <span className="font-semibold">{counts.done} of {counts.total} milestones done</span>
              {counts.overdue > 0 && <span className="text-[#b4372c]"> · {counts.overdue} overdue</span>}.
            </>
          ) : (
            'There is no approved readiness plan on this file.'
          )}
        </p>
        {unverified > 0 && <p className="text-amber-800">{unverified} update{unverified === 1 ? ' is' : 's are'} still unverified. Check {unverified === 1 ? 'it' : 'them'} first if they matter for the prequal.</p>}
        <p className="text-muted-foreground">
          The file moves to <span className="font-medium text-foreground">New lead (contacted)</span>, never straight to Pre-Qualified. Nurture check-ins stop, the plan is kept as approved, and lead follow-ups take over. Update the 1003 with their new income, debts, savings and credit before you prequalify them again.
        </p>
      </div>
      <FormGrid className="mt-3">
        <TextArea label="Note (optional)" value={note} onChange={setNote} rows={2} span={6} hint="Saved on the file, e.g. what changed." />
      </FormGrid>
    </EditDialog>
  )
}
