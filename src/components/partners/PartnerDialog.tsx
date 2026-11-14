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
import { defaultViaGmail, emailDomain, INSURANCE_LINES, splitEmails, type InsuranceLine } from '@/lib/partners/details'

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
    // Insurance / title fields (partner requests script).
    role: partner?.details?.role ?? '',
    extraEmails: (partner?.details?.extraEmails ?? []).join(', '),
    officeAddress: partner?.details?.officeAddress ?? '',
    preferred: partner?.details?.preferred ?? false,
    emailViaGmail: partner?.details ? partner.details.emailViaGmail : defaultViaGmail(partner?.kind ?? 'realtor'),
    gmailTouched: !!partner,
    agency: partner?.details?.agency ?? '',
    carriers: (partner?.details?.carriers ?? []).join(', '),
    licenseNumber: partner?.details?.licenseNumber ?? '',
    insuranceLines: partner?.details?.insuranceLines ?? ([] as InsuranceLine[]),
    escrowOfficerName: partner?.details?.escrowOfficerName ?? '',
    escrowOfficerEmail: partner?.details?.escrowOfficerEmail ?? '',
    processorName: partner?.details?.processorName ?? '',
    processorEmail: partner?.details?.processorEmail ?? '',
    titleUnderwriter: partner?.details?.titleUnderwriter ?? '',
    wireVerifyPhone: partner?.details?.wireVerifyPhone ?? '',
  })
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }))
  // The stage fields exist once the partner stages script has run.
  const stagesReady = partner ? partner.stage !== undefined : partners.some((p) => p.stage !== undefined)
  // The insurance / title fields exist once the partner requests script has run.
  const detailsReady = partner ? partner.details !== undefined : partners.some((p) => p.details !== undefined)
  const domain = emailDomain(form.email)
  const match = matchPartner({ email: form.email, phone: form.phone }, partners, partner?.id)
  const emailTaken = match.by === 'email' ? match.partner : null

  return (
    <EditDialog
      title={partner ? `Edit ${partner.name}` : 'Add a partner'}
      description={partner ? 'Changes show on every file they\'re on.' : 'Realtors, title, insurance agents, builders and referral partners. People are matched by email or phone, never by name.'}
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
          ...(detailsReady && {
            details: {
              role: form.role,
              extraEmails: splitEmails(form.extraEmails),
              officeAddress: form.officeAddress,
              preferred: form.preferred,
              emailViaGmail: form.emailViaGmail,
              agency: form.agency,
              carriers: form.carriers.split(',').map((c) => c.trim()).filter(Boolean),
              licenseNumber: form.licenseNumber,
              insuranceLines: form.insuranceLines,
              escrowOfficerName: form.escrowOfficerName,
              escrowOfficerEmail: form.escrowOfficerEmail,
              processorName: form.processorName,
              processorEmail: form.processorEmail,
              titleUnderwriter: form.titleUnderwriter,
              wireVerifyPhone: form.wireVerifyPhone,
            },
          }),
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
        <Select label="Kind" value={form.kind} options={PARTNER_KINDS.filter((k) => k.value !== 'insurance' || detailsReady).map((k) => ({ value: k.value, label: k.label }))} onChange={(kind) => set({ kind, ...(!form.gmailTouched && { emailViaGmail: defaultViaGmail(kind) }) })} span={2} />
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
        {detailsReady && (
          <>
            <Input label="Role / title" value={form.role} onChange={(role) => set({ role })} placeholder="e.g. Escrow officer, Agent" span={2} />
            <Input label="Other emails" value={form.extraEmails} onChange={(extraEmails) => set({ extraEmails })} placeholder="Separate with commas" span={2} />
            <Input label="Company email domain" value={domain ?? ''} readOnly hint={domain ? 'New emails from this domain can be matched to them' : 'From the email (public mailboxes like gmail.com never count)'} span={2} />
            <Input label="Office address" value={form.officeAddress} onChange={(officeAddress) => set({ officeAddress })} span={4} />
            <div className="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-2">
              <ToggleChip label="Preferred" pressed={form.preferred} onChange={(preferred) => set({ preferred })} />
              <ToggleChip label="Email via Gmail" pressed={form.emailViaGmail} onChange={(emailViaGmail) => set({ emailViaGmail, gmailTouched: true })} />
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-6">
              {form.emailViaGmail
                ? 'Emails go from your Gmail. They stay in MPS HQ only: never added to GoHighLevel, and no texts.'
                : 'Texts and emails go through GoHighLevel.'}
            </p>
            {form.kind === 'insurance' && (
              <>
                <Input label="Agency" value={form.agency} onChange={(agency) => set({ agency })} span={2} />
                <Input label="Carriers" value={form.carriers} onChange={(carriers) => set({ carriers })} placeholder="e.g. State Farm, Allstate" span={2} />
                <Input label="License #" value={form.licenseNumber} onChange={(licenseNumber) => set({ licenseNumber })} span={2} />
                <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-6" role="group" aria-label="Lines">
                  <span className="text-sm">Lines</span>
                  {INSURANCE_LINES.map((l) => (
                    <ToggleChip key={l.value} label={l.label} pressed={form.insuranceLines.includes(l.value)} onChange={(on) => set({ insuranceLines: on ? [...form.insuranceLines, l.value] : form.insuranceLines.filter((x) => x !== l.value) })} />
                  ))}
                </div>
              </>
            )}
            {form.kind === 'title' && (
              <>
                <Input label="Escrow officer" value={form.escrowOfficerName} onChange={(escrowOfficerName) => set({ escrowOfficerName })} span={3} />
                <Input label="Escrow officer email" type="email" value={form.escrowOfficerEmail} onChange={(escrowOfficerEmail) => set({ escrowOfficerEmail })} span={3} />
                <Input label="Processor" value={form.processorName} onChange={(processorName) => set({ processorName })} span={3} />
                <Input label="Processor email" type="email" value={form.processorEmail} onChange={(processorEmail) => set({ processorEmail })} span={3} />
                <Input label="Underwriter" value={form.titleUnderwriter} onChange={(titleUnderwriter) => set({ titleUnderwriter })} placeholder="e.g. Fidelity National" span={3} />
                <Input
                  label="Wire callback phone"
                  type="tel"
                  value={form.wireVerifyPhone}
                  onChange={(wireVerifyPhone) => set({ wireVerifyPhone })}
                  span={3}
                  hint="Type it from a number you trust (their website, a past closing). Never copy it from an email."
                />
              </>
            )}
          </>
        )}
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
            {partner.details?.emailViaGmail ? (
              <span className="text-xs text-muted-foreground">Emails through Gmail · not in GoHighLevel</span>
            ) : (
              <AddToGhl target={{ kind: 'partner', partnerId: partner.id }} linked={!!partner.ghlContactId} name={partner.name} pipelineMissing={partner.kind === 'realtor' && !partner.ghlOpportunityId} />
            )}
          </div>
        )}
      </FormGrid>
    </EditDialog>
  )
}
