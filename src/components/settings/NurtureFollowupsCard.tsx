import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, FormGrid, NumberInput, ToggleChip } from '@/components/shared'
import { useNurtureSettings, useSaveNurtureSettings } from '@/lib/api/nurtureFollowups'
import { nurtureSettingsProblem, type NurtureFollowupSettings } from '@/lib/nurture/followups'

/**
 * Settings → Nurture check-ins (Connor, 2026-11-16; buyer-nurture Step 6).
 * Every 15 minutes MPS HQ drafts a check-in for Nurture borrowers whose
 * readiness plan has a milestone coming up, due or overdue (one at a time per
 * borrower). Drafts only. Owners and admins change it.
 */
export function NurtureFollowupsCard({ canEdit }: { canEdit: boolean }) {
  const settings = useNurtureSettings()
  if (settings.isLoading) return null
  if (!settings.data) return <Card title="Nurture check-ins"><p className="text-sm text-destructive">Nurture check-ins turn on once the nurture follow-ups database script has run.</p></Card>
  return <Form key={JSON.stringify(settings.data)} saved={settings.data} canEdit={canEdit} />
}

function Form({ saved, canEdit }: { saved: NurtureFollowupSettings; canEdit: boolean }) {
  const save = useSaveNurtureSettings()
  const [f, setF] = useState(saved)
  const dirty = JSON.stringify(f) !== JSON.stringify(saved)
  const problem = nurtureSettingsProblem(f)
  return (
    <Card
      title="Nurture check-ins"
      description="For borrowers in Nurture with an approved readiness plan: a check-in before each milestone’s target date, on the date, if it runs late, a few days after the roadmap goes out, and a review request once every milestone is done. Drafted in your Action Queue on Today, one at a time per borrower. Nothing sends until you press Send. Their replies show on the file as updates for you to verify."
    >
      <ToggleChip label={f.enabled ? 'Nurture check-ins on' : 'Nurture check-ins off'} pressed={f.enabled} disabled={!canEdit} onChange={(enabled) => setF({ ...f, enabled })} />
      <FormGrid className="mt-3 lg:grid-cols-3">
        <NumberInput label="Roadmap check-in (days after sending)" value={f.roadmapDays} onChange={(v) => setF({ ...f, roadmapDays: v ?? 0 })} readOnly={!canEdit} />
        <NumberInput label="Overdue nudge (days after the target)" value={f.overdueDays} onChange={(v) => setF({ ...f, overdueDays: v ?? 0 })} readOnly={!canEdit} />
        <NumberInput label="Quiet days" value={f.quietDays} onChange={(v) => setF({ ...f, quietDays: v ?? 0 })} readOnly={!canEdit} hint="No check-in this soon after any message either way" />
      </FormGrid>
      {problem && <p className="mt-2 text-sm text-destructive">{problem}</p>}
      {canEdit && dirty && (
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setF(saved)}>
            Discard
          </Button>
          <Button size="sm" disabled={save.isPending || !!problem} onClick={() => save.mutate(f, { onSuccess: () => toast.success('Nurture check-in settings saved'), onError: (e) => toast.error(e.message) })}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}
    </Card>
  )
}
