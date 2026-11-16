import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, FormGrid, NumberInput, ToggleChip } from '@/components/shared'
import { useLeadFollowupSettings, useSaveLeadFollowupSettings } from '@/lib/api/leadFollowups'
import { DEFAULT_LEAD_FOLLOWUP_SETTINGS, type LeadFollowupSettings } from '@/lib/leads/followups'

type DayField = Exclude<keyof LeadFollowupSettings, 'enabled'>

const FIELDS: { field: DayField; label: string; hint?: string; min: number }[] = [
  { field: 'newLeadDays', label: 'New lead, no contact', hint: 'Leads you add by hand (0 = same day). Website leads are left to your GHL workflow.', min: 0 },
  { field: 'waitingApplicationDays', label: 'Waiting on Application', min: 0 },
  { field: 'applicationInProgressDays', label: 'Application In Progress', min: 0 },
  { field: 'waitingDocumentsDays', label: 'Waiting on Documents', min: 0 },
  { field: 'needsLoReviewDays', label: 'Needs LO Review', hint: 'A task for you, no message', min: 0 },
  { field: 'readyToShopDays', label: 'Ready to Shop', min: 1 },
  { field: 'readyToShopSoonDays', label: 'Ready to Shop, buying within 60 days', min: 1 },
  { field: 'propertyFoundDays', label: 'Property Found', min: 0 },
  { field: 'waitingBorrowerDays', label: 'Waiting on Borrower', min: 1 },
]

/**
 * Settings → Lead follow-ups (Connor, 2026-11-16). Every 30 minutes MPS HQ
 * checks your leads and drafts a follow-up in the Action Queue when one is due
 * (days since you last reached them, per Next Action). Drafts only: nothing
 * sends until you press Send. Owners and admins change it.
 */
export function LeadFollowupsCard({ canEdit }: { canEdit: boolean }) {
  const settings = useLeadFollowupSettings()
  if (settings.isLoading) return null
  if (settings.isError) return <Card title="Lead follow-ups"><p className="text-sm text-destructive">Lead follow-ups turn on once the lead follow-ups database script has run.</p></Card>
  return <Form key={JSON.stringify(settings.data)} saved={settings.data ?? DEFAULT_LEAD_FOLLOWUP_SETTINGS} canEdit={canEdit} />
}

function Form({ saved, canEdit }: { saved: LeadFollowupSettings; canEdit: boolean }) {
  const save = useSaveLeadFollowupSettings()
  const [f, setF] = useState(saved)
  const dirty = JSON.stringify(f) !== JSON.stringify(saved)
  const bad = FIELDS.find(({ field, min }) => !Number.isInteger(f[field]) || f[field] < min || f[field] > 60)
  return (
    <Card
      title="Lead follow-ups"
      description="Every 30 minutes MPS HQ checks your leads and, when one is due, drafts a follow-up text or email in your Action Queue on Today, worded from their Next Action. Nothing sends until you press Send."
    >
      <ToggleChip label={f.enabled ? 'Lead follow-ups on' : 'Lead follow-ups off'} pressed={f.enabled} disabled={!canEdit} onChange={(enabled) => setF({ ...f, enabled })} />
      <p className="mt-3 text-xs font-medium text-muted-foreground">Days after you last reached them</p>
      <FormGrid className="mt-1 lg:grid-cols-3">
        {FIELDS.map(({ field, label, hint }) => (
          <NumberInput key={field} label={label} value={f[field]} onChange={(v) => setF({ ...f, [field]: v ?? 0 })} readOnly={!canEdit} hint={hint} />
        ))}
      </FormGrid>
      {bad && <p className="mt-2 text-sm text-destructive">{bad.label}: use whole days from {bad.min} to 60.</p>}
      {canEdit && dirty && (
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setF(saved)}>
            Discard
          </Button>
          <Button size="sm" disabled={save.isPending || !!bad} onClick={() => save.mutate(f, { onSuccess: () => toast.success('Lead follow-up settings saved'), onError: (e) => toast.error(e.message) })}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}
    </Card>
  )
}
