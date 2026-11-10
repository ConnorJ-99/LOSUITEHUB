import { useState } from 'react'
import { toast } from 'sonner'
import { DateInput, FormGrid, Input, Select, TextArea, ToggleChip } from '@/components/shared'
import { AddToGhl } from '@/components/messaging/AddToGhl'
import { EditDialog } from '@/components/urla/parts'
import { useOrgMembers } from '@/lib/api/loans'
import { useSavePartner, type Partner, type PartnerDraft } from '@/lib/api/partners'
import { useAuth } from '@/lib/auth/context'
import { formatIsoDate } from '@/lib/dates'
import { looksLikeEmail, matchPartner, PARTNER_KINDS, type PartnerKind } from '@/lib/partners/match'
import { PARTNER_STAGES, type PartnerStage } from '@/lib/partners/stages'

/** Recorded yes, recorded no, or not recorded (press the same chip again). */
function ConsentField({ label, value, optedOutAt, onChange }: { label: string; value: boolean | null; optedOutAt: string | null; onChange: (v: boolean | null) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2 lg:col-span-3">
      <span className="text-sm">{label}</span>
      {optedOutAt ? (
        <span className="text-xs text-red-700">Opted out {formatIsoDate(optedOutAt.slice(0, 10))}</span>
      ) : (
        <div className="flex gap-2" role="group" aria-label={label}>
          <ToggleChip label="Yes" pressed={value === true} onChange={(p) => onChange(p ? true : null)} />
          <ToggleChip label="No" pressed={value === false} onChange={(p) => onChange(p ? false : null)} />
        </div>
      )}
    </div>
  )
}

/** Add a partner by hand, or edit one. Matching runs as you type, by email or phone only. */
export function PartnerDialog({ partner, partners, onClose }: { partner: Partner | null; partners: Partner[]; onClose: () => void }) {
  const save = useSavePartner()
  const { state } = useAuth()
  const myId = state.status === 'signedIn' ? state.user.id : null
  const members = useOrgMembers()
  const [form, setForm] = useState({
    kind: partner?.kind ?? ('realtor' as PartnerKind),
    name: partner?.name ?? '',
    company: partner?.company ?? '',
    email: partner?.email ?? '',
    phone: partner?.phone ?? '',
    smsConsent: partner?.smsConsent ?? null,
    emailConsent: partner?.emailConsent ?? null,
    notes: partner?.notes ?? '',
    // Phase 4: a partner added by hand starts as Identified and yours.
    stage: partner?.stage ?? ('identified' as PartnerStage),
    assignedLoId: partner ? partner.assignedLoId : myId,
    nextFollowUpOn: partner?.nextFollowUpOn ?? null,
    lastMetOn: partner?.lastMetOn ?? null,
    source: partner?.source ?? '',
  })
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))
  // The stage fields exist once the partner stages script has run.
  const stagesReady = partner ? partner.stage !== undefined : partners.some((p) => p.stage !== undefined)
  const match = matchPartner({ email: form.email, phone: form.phone }, partners, partner?.id)
  const emailTaken = match.by === 'email' ? match.partner : null

  return (
    <EditDialog
      title={partner ? `Edit ${partner.name}` : 'Add a partner'}
      description={partner ? 'Changes show on every file they\'re on.' : 'Realtors, title, builders and referral partners. People are matched by email or phone, never by name.'}
      open
      onOpenChange={(o) => !o && onClose()}
      saving={save.isPending}
      submitLabel={partner ? 'Save' : 'Add partner'}
      onSubmit={() => {
        if (!form.name.trim()) return toast.error('Enter a name')
        if (form.email.trim() && !looksLikeEmail(form.email)) return toast.error('That email doesn\'t look right')
        if (emailTaken) return toast.error(`${emailTaken.name} already has this email`)
        const draft: PartnerDraft = {
          id: partner?.id,
          kind: form.kind,
          name: form.name,
          company: form.company,
          email: form.email,
          phone: form.phone,
          // An opt-out is only undone by restoring consent, never here.
          smsConsent: partner?.smsOptedOutAt ? undefined : form.smsConsent,
          emailConsent: partner?.emailOptedOutAt ? undefined : form.emailConsent,
          notes: form.notes,
          ...(stagesReady && { stages: { stage: form.stage, assignedLoId: form.assignedLoId, nextFollowUpOn: form.nextFollowUpOn, lastMetOn: form.lastMetOn, source: form.source } }),
        }
        save.mutate(draft, {
          onSuccess: () => {
            toast.success(partner ? `${form.name.trim()} saved` : `${form.name.trim()} added`)
            onClose()
          },
          onError: (e) => toast.error(e.message),
        })
      }}
    >
      <FormGrid>
        <Select label="Kind" value={form.kind} options={PARTNER_KINDS.map((k) => ({ value: k.value, label: k.label }))} onChange={(kind) => set({ kind })} span={2} />
        <Input label="Name" required value={form.name} onChange={(name) => set({ name })} span={2} />
        <Input label="Company" value={form.company} onChange={(company) => set({ company })} span={2} />
        <Input label="Email" type="email" value={form.email} onChange={(email) => set({ email })} span={3} error={emailTaken ? `${emailTaken.name} already has this email` : undefined} />
        <Input
          label="Phone"
          type="tel"
          value={form.phone}
          onChange={(phone) => set({ phone })}
          span={3}
          hint={
            match.by === 'phone'
              ? `Same phone as ${match.partner.name}. If it's the same person, edit them instead.`
              : match.by === 'shared_phone'
                ? `${match.partners.length} partners already share this phone (an office line?).`
                : undefined
          }
        />
        {stagesReady && (
          <>
            <Select label="Stage" value={form.stage} options={PARTNER_STAGES.map((s) => ({ value: s.value, label: s.label }))} onChange={(stage) => set({ stage })} span={2} />
            <Select label="Loan officer" value={form.assignedLoId} options={(members.data ?? []).filter((m) => m.role !== 'processor').map((m) => ({ value: m.id, label: m.name }))} onChange={(assignedLoId) => set({ assignedLoId })} onClear={() => set({ assignedLoId: null })} placeholder="No one yet" span={2} />
            <Input label="Source" value={form.source} onChange={(source) => set({ source })} placeholder="e.g. Open house, referral from Amy" span={2} />
            <DateInput label="Next follow-up" value={form.nextFollowUpOn} onChange={(nextFollowUpOn) => set({ nextFollowUpOn })} span={3} />
            <DateInput label="Last met" value={form.lastMetOn} onChange={(lastMetOn) => set({ lastMetOn })} span={3} />
          </>
        )}
        <ConsentField label="Consent to texts" value={form.smsConsent} optedOutAt={partner?.smsOptedOutAt ?? null} onChange={(smsConsent) => set({ smsConsent })} />
        <ConsentField label="Consent to email" value={form.emailConsent} optedOutAt={partner?.emailOptedOutAt ?? null} onChange={(emailConsent) => set({ emailConsent })} />
        <TextArea label="Notes" value={form.notes} onChange={(notes) => set({ notes })} rows={3} span={6} />
        {partner && (
          <div className="flex flex-wrap items-center justify-between gap-2 sm:col-span-2 lg:col-span-6">
            <span className="text-sm">GoHighLevel</span>
            <AddToGhl target={{ kind: 'partner', partnerId: partner.id }} linked={!!partner.ghlContactId} name={partner.name} />
          </div>
        )}
      </FormGrid>
    </EditDialog>
  )
}
