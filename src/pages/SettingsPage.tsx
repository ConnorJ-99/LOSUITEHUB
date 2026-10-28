import { useRef } from 'react'
import { ImageIcon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, confirmAction, FormGrid, Input, PageHeader } from '@/components/shared'
import { BRAND_TYPES, useBrandImage, useRemoveBrandImage, useUploadBrandImage } from '@/lib/api/brandFiles'
import { DocumentRulesCard } from '@/components/documents/DocumentRulesCard'
import { FeeListCard } from '@/components/pricing/FeeListCard'
import { MessageTemplatesCard } from '@/components/queue/MessageTemplatesCard'
import { useDraft } from '@/components/urla/useDraft'
import { useOrgMembers } from '@/lib/api/loans'
import { useOrganization, useProfile, useUpdateMyProfile, useUpdateOrganization, type Organization, type Profile } from '@/lib/api/settings'
import { roleLabels, useAuth } from '@/lib/auth/context'

function SaveBar({ dirty, saving, onSave, onDiscard }: { dirty: boolean; saving: boolean; onSave: () => void; onDiscard: () => void }) {
  if (!dirty) return null
  return (
    <div className="mt-4 flex justify-end gap-2">
      <Button variant="ghost" onClick={onDiscard}>
        Discard
      </Button>
      <Button onClick={onSave} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  )
}

/** A logo or signature: preview, upload or replace, remove. */
function BrandImageField({ kind, label, hint, path, organizationId, userId, canEdit }: { kind: 'logo' | 'signature'; label: string; hint: string; path: string | null; organizationId: string; userId: string; canEdit: boolean }) {
  const image = useBrandImage(path)
  const upload = useUploadBrandImage()
  const remove = useRemoveBrandImage()
  const input = useRef<HTMLInputElement>(null)
  const target = { kind, organizationId, userId, current: path }
  return (
    <div className="mt-4 border-t pt-4">
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <div className="flex h-16 w-56 items-center justify-center rounded-lg border border-dashed bg-white p-2">
          {path && image.data ? <img src={image.data} alt={`Current ${kind}`} className="max-h-full max-w-full object-contain" /> : <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><ImageIcon className="size-4" />{path ? 'Loading…' : kind === 'logo' ? 'Built-in MPS logo' : 'None yet'}</span>}
        </div>
        {canEdit && (
          <>
            <input
              ref={input}
              type="file"
              accept={BRAND_TYPES.join(',')}
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) upload.mutate({ target, file }, { onSuccess: () => toast.success(`${label} saved`), onError: (err) => toast.error(err.message) })
              }}
            />
            <Button size="sm" variant="outline" disabled={upload.isPending} onClick={() => input.current?.click()}>
              <UploadIcon />
              {upload.isPending ? 'Uploading…' : path ? 'Replace' : 'Upload'}
            </Button>
            {path && (
              <Button
                size="sm"
                variant="ghost"
                disabled={remove.isPending}
                onClick={async () => (await confirmAction(kind === 'logo' ? 'Remove the logo? PDFs go back to the built-in MPS logo.' : 'Remove your signature? Letters will have a blank space to sign by hand.', { confirmLabel: 'Remove', destructive: true })) && remove.mutate(target, { onSuccess: () => toast.success(`${label} removed`), onError: (err) => toast.error(err.message) })}
              >
                Remove
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function MyProfileCard({ profile, organizationId }: { profile: Profile; organizationId: string }) {
  const update = useUpdateMyProfile()
  const { form, set, dirty, reset } = useDraft<Profile>(profile)
  const text = (key: keyof Profile) => (v: string) => set(key)(v || null)
  return (
    <Card title="My profile" description="Shown as the loan originator on the 1003 (section 9).">
      <FormGrid className="lg:grid-cols-4">
        <Input label="Full name" value={form.fullName ?? ''} onChange={text('fullName')} span={2} />
        <Input label="Email" value={form.email} readOnly hint="Your sign-in email" span={2} />
        <Input label="Individual NMLS #" value={form.nmls ?? ''} onChange={text('nmls')} />
        <Input label="State license #" value={form.stateLicense ?? ''} onChange={text('stateLicense')} />
        <Input label="Phone" type="tel" value={form.phone ?? ''} onChange={text('phone')} span={2} />
      </FormGrid>
      <SaveBar
        dirty={dirty}
        saving={update.isPending}
        onDiscard={reset}
        onSave={() => update.mutate(form, { onSuccess: () => toast.success('Profile saved'), onError: (e) => toast.error(e.message) })}
      />
      <BrandImageField kind="signature" label="Signature" hint="Shown above your name and NMLS on pre-approval letters. A PNG of your signature in dark ink on a white or clear background works best." path={profile.signaturePath} organizationId={organizationId} userId={profile.id} canEdit />
    </Card>
  )
}

function CompanyCard({ org, canEdit, userId }: { org: Organization; canEdit: boolean; userId: string }) {
  const update = useUpdateOrganization()
  const { form, set, dirty, reset } = useDraft<Organization>(org)
  const text = (key: keyof Organization) => (v: string) => set(key)((v || null) as never)
  return (
    <Card title="Company" description={canEdit ? 'Used on the 1003 and on pre-approval letters.' : 'Only owners and admins can change company details.'}>
      <FormGrid className="lg:grid-cols-4">
        <Input label="Company name" value={form.name} onChange={(v) => set('name')(v)} readOnly={!canEdit} required span={2} />
        <Input label="Company NMLS #" value={form.nmls ?? ''} onChange={text('nmls')} readOnly={!canEdit} />
        <Input label="Phone" type="tel" value={form.phone ?? ''} onChange={text('phone')} readOnly={!canEdit} />
        <Input label="Street address" value={form.addressLine ?? ''} onChange={text('addressLine')} readOnly={!canEdit} span={2} />
        <Input label="City" value={form.city ?? ''} onChange={text('city')} readOnly={!canEdit} />
        <div className="grid grid-cols-2 gap-x-4">
          <Input label="State" value={form.state ?? ''} onChange={(v) => set('state')(v.toUpperCase().slice(0, 2) || null)} readOnly={!canEdit} />
          <Input label="ZIP" value={form.zip ?? ''} onChange={text('zip')} readOnly={!canEdit} />
        </div>
      </FormGrid>
      <SaveBar
        dirty={dirty && canEdit}
        saving={update.isPending}
        onDiscard={reset}
        onSave={() => {
          if (!form.name.trim()) return toast.error('Company name is required')
          update.mutate(form, { onSuccess: () => toast.success('Company details saved'), onError: (e) => toast.error(e.message) })
        }}
      />
      <BrandImageField kind="logo" label="Logo" hint="Used at the top of every PDF (Fee Worksheet, loan comparison, pre-approval letters). A wide PNG with a clear background works best." path={org.logoPath} organizationId={org.id} userId={userId} canEdit={canEdit} />
    </Card>
  )
}

export function SettingsPage() {
  const { state } = useAuth()
  const me = state.status === 'signedIn' ? state.user : null
  const profile = useProfile(me?.id)
  const org = useOrganization()
  const members = useOrgMembers()

  if (state.status === 'preview') {
    return (
      <>
        <PageHeader title="Settings" />
        <Card>
          <p className="text-sm text-muted-foreground">Connect Supabase to edit settings.</p>
        </Card>
      </>
    )
  }

  const canEditCompany = me?.role === 'owner' || me?.role === 'admin'

  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-4">
        {profile.data && me?.organizationId && <MyProfileCard key={JSON.stringify(profile.data)} profile={profile.data} organizationId={me.organizationId} />}
        {org.data && me && <CompanyCard key={JSON.stringify(org.data)} org={org.data} canEdit={canEditCompany} userId={me.id} />}
        <MessageTemplatesCard />
        <DocumentRulesCard canEdit={canEditCompany} />
        <FeeListCard canEdit={canEditCompany} />
        <Card title="Team" description="People in your organization. Inviting new loan officers comes later.">
          <ul className="divide-y">
            {(members.data ?? []).map((m) => (
              <li key={m.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  {m.name}
                  <span className="ml-2 text-xs text-muted-foreground">{m.email}</span>
                </span>
                <span className="text-xs text-muted-foreground">{roleLabels[m.role]}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  )
}
