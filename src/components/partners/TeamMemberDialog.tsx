import { useState } from 'react'
import { Link } from 'react-router'
import { toast } from 'sonner'
import { FormGrid, Input, Select } from '@/components/shared'
import { EditDialog } from '@/components/urla/parts'
import type { TeamMemberRecord, TeamRole } from '@/lib/api/loanfile'
import { usePartners } from '@/lib/api/partners'
import { looksLikeEmail, matchPartner, partnerKindForRole } from '@/lib/partners/match'

export interface TeamMemberSave {
  name: string
  company: string
  email: string
  phone: string
  partnerId: string | null
}

/**
 * "Enter name…" for an outside person on the file's team. For agents and
 * title, pick a saved partner or type someone in; they're matched to a saved
 * partner by email or phone (never by name), or saved as a new one.
 */
export function TeamMemberDialog({
  role,
  label,
  withCompany,
  record,
  saving,
  onSave,
  onClose,
}: {
  role: TeamRole
  label: string
  withCompany: boolean
  record: TeamMemberRecord | null
  saving: boolean
  onSave: (member: TeamMemberSave) => void
  onClose: () => void
}) {
  const kind = partnerKindForRole(role)
  const partners = usePartners()
  const outside = record && !record.profileId ? record : null
  const [form, setForm] = useState<TeamMemberSave>({
    name: outside?.name ?? '',
    company: outside?.company ?? '',
    email: outside?.email ?? '',
    phone: outside?.phone ?? '',
    partnerId: outside?.partnerId ?? null,
  })
  const all = partners.data ?? []
  const picked = all.find((p) => p.id === form.partnerId) ?? null
  // Same kind first (realtors for agents, title for title), then everyone else.
  const choices = [...all.filter((p) => p.kind === kind), ...all.filter((p) => p.kind !== kind)]
  const match = matchPartner({ email: form.email, phone: form.phone }, all)

  // A different email or phone is a different person: let the database match them again.
  const setIdentity = (patch: Partial<TeamMemberSave>) => setForm((f) => ({ ...f, ...patch, partnerId: null }))

  let hint: React.ReactNode = null
  if (kind) {
    if (picked) hint = <>Linked to the saved partner {picked.name}. Change their details in the <Link to="/partners" className="text-primary underline-offset-2 hover:underline">Partner center</Link>.</>
    else if (match.by === 'email' || match.by === 'phone') hint = `Same ${match.by} as the saved partner ${match.partner.name}: they'll be linked, and the file shows their details.`
    else if (match.by === 'shared_phone') hint = `${match.partners.length} saved partners share this phone. Pick one above, or add an email.`
    else if (match.by === 'none') hint = "They'll be added to the Partner center."
    else hint = 'Add an email or phone to save them in the Partner center (people are matched by email or phone, never by name).'
  }

  return (
    <EditDialog
      title={label}
      open
      onOpenChange={(o) => !o && onClose()}
      saving={saving}
      onSubmit={() => {
        if (!form.name.trim()) return toast.error('Enter a name')
        if (form.email.trim() && !looksLikeEmail(form.email)) return toast.error('That email doesn\'t look right')
        onSave(form)
      }}
    >
      <FormGrid>
        {kind && choices.length > 0 && (
          <Select
            label="Saved partner"
            value={form.partnerId}
            placeholder="Pick a saved partner, or type someone below"
            options={choices.map((p) => ({ value: p.id, label: [p.name, p.company].filter(Boolean).join(' · ') }))}
            onChange={(id) => {
              const p = all.find((x) => x.id === id)
              if (p) setForm({ name: p.name, company: p.company ?? '', email: p.email ?? '', phone: p.phone ?? '', partnerId: p.id })
            }}
            onClear={() => setForm((f) => ({ ...f, partnerId: null }))}
            span={6}
          />
        )}
        <Input label="Name" required value={form.name} onChange={(v) => setForm((f) => ({ ...f, name: v }))} span={3} />
        {withCompany && <Input label="Company" value={form.company} onChange={(v) => setForm((f) => ({ ...f, company: v }))} span={3} />}
        <Input label="Email" type="email" value={form.email} onChange={(v) => setIdentity({ email: v })} span={3} />
        <Input label="Phone" type="tel" value={form.phone} onChange={(v) => setIdentity({ phone: v })} span={3} />
      </FormGrid>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </EditDialog>
  )
}
