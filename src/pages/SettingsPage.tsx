import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, FormGrid, Input, PageHeader } from '@/components/shared'
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

function MyProfileCard({ profile }: { profile: Profile }) {
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
    </Card>
  )
}

function CompanyCard({ org, canEdit }: { org: Organization; canEdit: boolean }) {
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
        {profile.data && <MyProfileCard key={JSON.stringify(profile.data)} profile={profile.data} />}
        {org.data && <CompanyCard key={JSON.stringify(org.data)} org={org.data} canEdit={canEditCompany} />}
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
