import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, FormGrid, Input, NumberInput, TextArea, ToggleChip } from '@/components/shared'
import { DEFAULT_REVIEW_SETTINGS, useMyReviewLink, useReviewSettings, useSaveMyReviewLink, useSaveReviewSettings, type ReviewSettingsForm } from '@/lib/api/reviews'
import { reviewWordingProblem } from '@/lib/closed/reviews'

const https = (v: string) => !v.trim() || /^https:\/\//i.test(v.trim())

/**
 * Settings → Reviews. Owners and admins set the company review link, timing
 * and wording; everyone can set their own review link (used instead of the
 * company's on their files). Requests are only ever drafted, never sent on
 * their own. The wording must stay neutral and offer no incentive.
 */
export function ReviewsCard({ canEdit }: { canEdit: boolean }) {
  const settings = useReviewSettings()
  if (settings.isLoading) return null
  if (settings.isError) return <Card title="Reviews"><p className="text-sm text-destructive">Review requests turn on once the review requests database script has run.</p></Card>
  return <ReviewsForm key={JSON.stringify(settings.data)} saved={settings.data ?? DEFAULT_REVIEW_SETTINGS} canEdit={canEdit} />
}

function ReviewsForm({ saved, canEdit }: { saved: ReviewSettingsForm; canEdit: boolean }) {
  const save = useSaveReviewSettings()
  const [f, setF] = useState(saved)
  const set = (patch: Partial<ReviewSettingsForm>) => setF((x) => ({ ...x, ...patch }))
  const dirty = JSON.stringify(f) !== JSON.stringify(saved)
  const wording = reviewWordingProblem(`${f.textTemplate}\n${f.emailSubject}\n${f.emailTemplate}`)
  const problem = !https(f.companyLink) || !https(f.secondLink) ? 'Review links must start with https://' : f.enabled && !f.companyLink.trim() ? 'Add the company review link to turn requests on' : wording

  return (
    <Card title="Reviews" description="After each loan funds, a review request is drafted in the Action Queue for you to send. Nothing sends on its own. Loans funded before you turn this on can use Request review on their Overview.">
      <ToggleChip label={f.enabled ? 'Review requests on' : 'Review requests off'} pressed={f.enabled} disabled={!canEdit} onChange={(enabled) => set({ enabled })} />
      <FormGrid className="mt-3 lg:grid-cols-4">
        <Input label="Company review link" value={f.companyLink} onChange={(companyLink) => set({ companyLink })} readOnly={!canEdit} placeholder="https://g.page/r/…" span={2} required={f.enabled} />
        <Input label="Second link (optional)" value={f.secondLink} onChange={(secondLink) => set({ secondLink })} readOnly={!canEdit} placeholder="e.g. Zillow; shown as “or here”" span={2} />
        <NumberInput label="Days after funding" value={f.daysAfter} onChange={(v) => set({ daysAfter: v ?? 3 })} readOnly={!canEdit} />
        <div className="flex items-end">
          <ToggleChip label="One follow-up" pressed={f.followUp} disabled={!canEdit} onChange={(followUp) => set({ followUp })} />
        </div>
        {f.followUp && <NumberInput label="Follow up after (days)" value={f.followUpDays} onChange={(v) => set({ followUpDays: v ?? 7 })} readOnly={!canEdit} hint="Never more than 2 asks per loan" />}
        <TextArea label="Text wording" value={f.textTemplate} onChange={(textTemplate) => set({ textTemplate })} readOnly={!canEdit} rows={3} span={4} hint="{first} = their first name, {lo} = the loan officer's first name, {link} = the review link" />
        <Input label="Email subject" value={f.emailSubject} onChange={(emailSubject) => set({ emailSubject })} readOnly={!canEdit} span={4} />
        <TextArea label="Email wording" value={f.emailTemplate} onChange={(emailTemplate) => set({ emailTemplate })} readOnly={!canEdit} rows={6} span={4} />
      </FormGrid>
      {/* COMPLIANCE: review wording is subject to Connor's compliance review (neutral, no gating, no incentives). */}
      <p className="mt-2 text-xs text-muted-foreground">Keep it neutral: ask every client the same way, never only happy ones, and offer nothing in return.</p>
      {problem && <p className="mt-2 text-sm text-destructive">{problem}</p>}
      {canEdit && dirty && (
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setF(saved)}>
            Discard
          </Button>
          <Button size="sm" disabled={save.isPending || !!problem} onClick={() => save.mutate(f, { onSuccess: () => toast.success('Review settings saved'), onError: (e) => toast.error(e.message) })}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}
      <div className="mt-4 border-t pt-3">
        <MyReviewLink />
      </div>
    </Card>
  )
}

function MyReviewLink() {
  const link = useMyReviewLink()
  const save = useSaveMyReviewLink()
  const [value, setValue] = useState<string | null>(null)
  const shown = value ?? link.data ?? ''
  const dirty = value !== null && value !== (link.data ?? '')
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-64 flex-1">
        <Input label="Your personal review link (optional)" value={shown} onChange={setValue} placeholder="https://…" hint="Used instead of the company link on your files" error={!https(shown) ? 'Must start with https://' : undefined} />
      </div>
      {dirty && (
        <Button size="sm" disabled={save.isPending || !https(shown)} onClick={() => save.mutate(shown, { onSuccess: () => (setValue(null), toast.success('Your review link is saved')), onError: (e) => toast.error(e.message) })}>
          Save
        </Button>
      )}
    </div>
  )
}
