import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, FormGrid, TextArea } from '@/components/shared'
import { usePortalStageMessages, useSavePortalStageMessages } from '@/lib/api/portal'
import { PORTAL_STEPS } from '../../../supabase/functions/document-upload/portal'

/**
 * Settings → Borrower portal: the one line borrowers see under their current
 * step. Blank = the default wording (shown as the placeholder). Owners and
 * admins edit it; it's the same for every file.
 */
export function PortalSettingsCard({ canEdit, organizationId }: { canEdit: boolean; organizationId: string | null }) {
  const saved = usePortalStageMessages()
  if (saved.isLoading) return null
  if (saved.data === null) return <Card title="Borrower portal"><p className="text-sm text-muted-foreground">The borrower portal turns on once its database script has run.</p></Card>
  return <PortalForm key={JSON.stringify(saved.data)} saved={saved.data ?? {}} canEdit={canEdit} organizationId={organizationId} />
}

function PortalForm({ saved, canEdit, organizationId }: { saved: Record<string, string>; canEdit: boolean; organizationId: string | null }) {
  const save = useSavePortalStageMessages()
  const [f, setF] = useState<Record<string, string>>(saved)
  const dirty = PORTAL_STEPS.some((s) => (f[s.id] ?? '').trim() !== (saved[s.id] ?? ''))
  return (
    <Card title="Borrower portal" description="The message borrowers see under their current step in the portal. Leave one blank to use the wording shown in grey.">
      <FormGrid className="lg:grid-cols-2">
        {PORTAL_STEPS.map((s) => (
          <TextArea key={s.id} label={s.label} value={f[s.id] ?? ''} onChange={(v) => setF((x) => ({ ...x, [s.id]: v }))} placeholder={s.message} readOnly={!canEdit} rows={2} />
        ))}
      </FormGrid>
      {canEdit && dirty && organizationId && (
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setF(saved)}>
            Discard
          </Button>
          <Button size="sm" disabled={save.isPending} onClick={() => save.mutate({ organizationId, messages: f }, { onSuccess: () => toast.success('Portal messages saved'), onError: (e) => toast.error(e.message) })}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}
    </Card>
  )
}
