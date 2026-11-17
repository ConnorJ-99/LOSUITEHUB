import { useState, type FormEvent } from 'react'
import { XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, confirmAction, FormGrid, Input, Select } from '@/components/shared'
import { useGhlLinks } from '@/lib/api/ghl'
import { useAddMember, useRemoveMember, useSetMemberRole } from '@/lib/api/settings'
import { useSaveMemberLinks, useSetMemberAccess, useTeamAccess, type TeamMember } from '@/lib/api/team'
import { roleLabels, type CurrentUser, type OrgRole } from '@/lib/auth/context'
import { formatPhone } from '@/lib/pipeline/helpers'
import { cleanLinks, firstNameFor, LINK_FIELDS, SECONDARY_ROLES, secondaryLabel, type LinkProfile, type SecondaryRole } from '@/lib/team/secondaryRoles'

const ROLES: OrgRole[] = ['owner', 'admin', 'loan_officer', 'processor']
const GRID = 'sm:grid sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-3'

const linksOf = (m: TeamMember): LinkProfile => ({ displayName: m.displayName, title: m.title, nmls: m.nmls, applicationUrl: m.applicationUrl, bookingUrl: m.bookingUrl, bioUrl: m.bioUrl })
const same = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))

/** "EDIT USER": primary role, secondary roles, who they assist and their links (owners and admins). */
function EditUser({ m, me, members, ready, onClose }: { m: TeamMember; me: CurrentUser; members: TeamMember[]; ready: boolean; onClose: () => void }) {
  const setRole = useSetMemberRole()
  const setAccess = useSetMemberAccess()
  const saveLinks = useSaveMemberLinks()
  const removeMember = useRemoveMember()
  const isOwner = me.role === 'owner'
  const roleOptions = ROLES.filter((r) => isOwner || r !== 'owner').map((r) => ({ value: r, label: roleLabels[r] }))
  const [role, setNewRole] = useState<OrgRole>(m.role)
  const [secondary, setSecondary] = useState<SecondaryRole[]>(m.secondaryRoles)
  const [assists, setAssists] = useState<string[]>(m.assists)
  const [links, setLinks] = useState<LinkProfile>(linksOf(m))
  const { problems } = cleanLinks(links)
  const isLoa = secondary.includes('loa')
  const nameOf = (id: string) => members.find((x) => x.id === id)?.name ?? 'Someone'
  const addable = members.filter((x) => x.id !== m.id && !assists.includes(x.id) && x.role !== 'processor')
  const saving = setRole.isPending || setAccess.isPending || saveLinks.isPending
  const first = m.fullName || m.displayName ? firstNameFor(m) : 'their'
  const own = first === 'their' ? 'Their' : `${first}'s`

  const save = async () => {
    if (Object.keys(problems).length) return toast.error('Fix the links marked in red first.')
    try {
      if (role !== m.role) {
        if (m.id === me.id && role !== 'owner' && role !== 'admin') {
          if (!(await confirmAction(`Change your own role to ${roleLabels[role].toLowerCase()}? You won't be able to manage the team or change it back yourself.`, { confirmLabel: 'Change my role', destructive: true }))) return
        } else if ((role === 'admin' || role === 'owner') && !(await confirmAction(`Make ${m.name} ${role === 'admin' ? 'an admin? Admins see every file in the company.' : 'an owner? Owners can manage the whole team, including other owners.'}`, { confirmLabel: `Make ${roleLabels[role].toLowerCase()}` }))) return
        await setRole.mutateAsync({ userId: m.id, role })
      }
      if (ready) {
        const keptAssists = isLoa ? assists : []
        if (!same(secondary, m.secondaryRoles) || !same(keptAssists, m.assists)) await setAccess.mutateAsync({ userId: m.id, secondaryRoles: secondary, assists: keptAssists })
        const cleaned = cleanLinks(links).links
        if (JSON.stringify(cleaned) !== JSON.stringify(linksOf(m))) await saveLinks.mutateAsync({ userId: m.id, links: cleaned })
      }
      toast.success(`${m.name} saved`)
      // Your own role shows across the app: reload so every screen uses the new one.
      if (m.id === me.id && role !== m.role) window.location.reload()
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const remove = async () => {
    if (!(await confirmAction(`Remove ${m.name} from the team? They won't see any company files anymore. Their files stay assigned to them; an admin can still see them and hand them to someone else.`, { confirmLabel: 'Remove', destructive: true }))) return
    removeMember.mutate(m.id, {
      onSuccess: () => {
        toast.success(`${m.name} removed from the team`)
        onClose()
      },
      onError: (e) => toast.error(e.message),
    })
  }

  return (
    <div className="mt-4 rounded-lg border bg-muted/30 p-4">
      <p className="eyebrow">Edit user</p>
      <p className="mt-1 text-base font-semibold">{m.name}</p>
      <FormGrid className="mt-3 lg:grid-cols-4">
        <Select label="Primary role" value={role} onChange={setNewRole} options={roleOptions} readOnly={!isOwner && m.role === 'owner'} span={2} />
      </FormGrid>

      {ready ? (
        <>
          <p className="mt-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">Secondary roles</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {SECONDARY_ROLES.map((r) => {
              const on = secondary.includes(r.value)
              return (
                <label key={r.value} className={cn('flex cursor-pointer items-start gap-2 rounded-md border bg-white p-3 text-sm', on && 'border-primary')}>
                  <input type="checkbox" className="mt-0.5 size-4 accent-primary" checked={on} onChange={(e) => setSecondary((s) => (e.target.checked ? [...s, r.value] : s.filter((x) => x !== r.value)))} />
                  <span>
                    <span className="font-medium">{r.label}</span>
                    <span className="block text-xs text-muted-foreground">{r.description}</span>
                  </span>
                </label>
              )
            })}
          </div>

          {isLoa && (
            <div className="mt-4">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Assists these loan officers</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {assists.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full border bg-white px-2.5 py-1 text-sm">
                    {nameOf(id)}
                    <button type="button" aria-label={`Remove ${nameOf(id)}`} className="text-muted-foreground hover:text-foreground" onClick={() => setAssists((a) => a.filter((x) => x !== id))}>
                      <XIcon className="size-3.5" />
                    </button>
                  </span>
                ))}
                {addable.length > 0 && (
                  <div className="w-44">
                    <Select label="Add LO" value={null} placeholder="+ Add LO" options={addable.map((x) => ({ value: x.id, label: x.name }))} onChange={(id) => setAssists((a) => [...a, id])} />
                  </div>
                )}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{first === 'their' ? 'They' : first} only see{first === 'their' ? '' : 's'} these loan officers in the "Add lead for…" picker.</p>
            </div>
          )}

          <p className="mt-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">{own} links (used when {first === 'their' ? 'they are' : `${first} is`} the LO)</p>
          <FormGrid className="mt-2 lg:grid-cols-6">
            {LINK_FIELDS.map((f) => (
              <Input key={f.key} label={f.label} value={links[f.key] ?? ''} onChange={(v) => setLinks((l) => ({ ...l, [f.key]: v || null }))} hint={f.hint} error={problems[f.key]} placeholder={f.url ? 'https://…' : undefined} span={f.url ? 3 : 2} />
            ))}
          </FormGrid>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">Secondary roles and links turn on once the LO assistant roles script has run in Supabase.</p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        {m.id !== me.id && (isOwner || m.role !== 'owner') ? (
          <Button size="sm" variant="ghost" className="text-destructive" disabled={removeMember.isPending} onClick={remove}>
            Remove from team
          </Button>
        ) : (
          <span />
        )}
        <span className="flex gap-2">
          <Button size="sm" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save user'}
          </Button>
        </span>
      </div>
    </div>
  )
}

/**
 * Settings → My profile: your own display name, title, application link and bio link
 * (NMLS # and booking link are edited above). Hidden before the LO assistant roles script.
 */
export function MyLinkFields({ userId }: { userId: string }) {
  const access = useTeamAccess()
  const mine = access.data?.members.find((m) => m.id === userId)
  if (!access.data?.ready || !mine) return null
  return <MyLinkForm key={JSON.stringify(linksOf(mine))} mine={mine} />
}

const MY_FIELDS: (keyof LinkProfile)[] = ['displayName', 'title', 'applicationUrl', 'bioUrl']

function MyLinkForm({ mine }: { mine: TeamMember }) {
  const saveLinks = useSaveMemberLinks()
  const [links, setLinks] = useState<LinkProfile>(linksOf(mine))
  const { problems } = cleanLinks(links)
  const dirty = JSON.stringify(links) !== JSON.stringify(linksOf(mine))
  return (
    <div className="mt-4 border-t pt-4">
      <p className="text-sm font-medium">Links in messages</p>
      <p className="text-xs text-muted-foreground">Used when a message on one of your files fills in the loan officer's links, and for your name and title when you send.</p>
      <FormGrid className="mt-2 lg:grid-cols-4">
        {LINK_FIELDS.filter((f) => MY_FIELDS.includes(f.key)).map((f) => (
          <Input key={f.key} label={f.label} value={links[f.key] ?? ''} onChange={(v) => setLinks((l) => ({ ...l, [f.key]: v || null }))} hint={f.hint} error={problems[f.key]} placeholder={f.url ? 'https://…' : undefined} span={2} />
        ))}
      </FormGrid>
      {dirty && (
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setLinks(linksOf(mine))}>
            Discard
          </Button>
          <Button
            size="sm"
            disabled={saveLinks.isPending}
            onClick={() => {
              if (Object.keys(problems).length) return toast.error('Fix the links marked in red first.')
              saveLinks.mutate({ userId: mine.id, links: cleanLinks(links).links }, { onSuccess: () => toast.success('Links saved'), onError: (e) => toast.error(e.message) })
            }}
          >
            {saveLinks.isPending ? 'Saving…' : 'Save links'}
          </Button>
        </div>
      )}
    </div>
  )
}

/** Settings → Team & roles (Connor, 2026-11-17): primary and secondary roles, who each LO Assistant assists, GHL number. */
export function TeamCard({ me }: { me: CurrentUser }) {
  const access = useTeamAccess()
  const ghl = useGhlLinks()
  const addMember = useAddMember()
  const [email, setEmail] = useState('')
  const [role, setNewRole] = useState<OrgRole>('loan_officer')
  const [editing, setEditing] = useState<string | null>(null)
  const canManage = me.role === 'owner' || me.role === 'admin'
  const isOwner = me.role === 'owner'
  const roleOptions = ROLES.filter((r) => isOwner || r !== 'owner').map((r) => ({ value: r, label: roleLabels[r] }))
  const members = access.data?.members ?? []
  const ready = access.data?.ready ?? false
  const nameOf = (id: string) => members.find((x) => x.id === id)?.name.split(/\s+/)[0] ?? 'Someone'
  const numberOf = (id: string) => ghl.data?.find((l) => l.profileId === id)?.ghlNumber ?? null
  const editingMember = members.find((m) => m.id === editing) ?? null

  const add = (e: FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return toast.error("Type the person's email")
    addMember.mutate(
      { email: email.trim(), role },
      {
        onSuccess: () => {
          toast.success(`${email.trim()} added as ${role === 'admin' || role === 'owner' ? 'an' : 'a'} ${roleLabels[role].toLowerCase()}`)
          setEmail('')
        },
        onError: (err) => toast.error(err.message),
      },
    )
  }

  return (
    <Card title="Team & roles" description={canManage ? 'Primary role sets what a user owns. Secondary roles add what they can do for others. Admins see every file.' : 'People in your company. Only owners and admins can change the team.'}>
      <div className={cn('hidden border-b pb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase', GRID)}>
        <span>User</span>
        <span>Primary role</span>
        <span>Secondary roles</span>
        <span>Assists</span>
        <span>GHL number</span>
        <span className="w-12" />
      </div>
      <ul className="divide-y">
        {members.map((m) => {
          const editable = canManage && (isOwner || m.role !== 'owner')
          const number = numberOf(m.id)
          return (
            <li key={m.id} className={cn('space-y-1 py-2 text-sm', GRID, editing === m.id && 'bg-primary/5')}>
              <span className="block min-w-0">
                <span className="font-medium">{m.name}</span>
                {m.id === me.id && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}
                <span className="block truncate text-xs text-muted-foreground">{m.nmls ? `NMLS ${m.nmls}` : m.email}</span>
              </span>
              <span className="block">{roleLabels[m.role]}</span>
              <span className="block text-muted-foreground">{m.secondaryRoles.length ? m.secondaryRoles.map(secondaryLabel).join(', ') : '—'}</span>
              <span className="block text-muted-foreground">{m.assists.length ? m.assists.map(nameOf).join(', ') : '—'}</span>
              <span className="block text-muted-foreground tabular-nums">{number ? formatPhone(number) : '—'}</span>
              <span className="block w-12 text-right">
                {editable && (
                  <Button size="sm" variant="ghost" onClick={() => setEditing(editing === m.id ? null : m.id)}>
                    Edit
                  </Button>
                )}
              </span>
            </li>
          )
        })}
      </ul>
      {editingMember && <EditUser key={editingMember.id} m={editingMember} me={me} members={members} ready={ready} onClose={() => setEditing(null)} />}
      {canManage && (
        <form onSubmit={add} className="mt-4 border-t pt-4">
          <p className="text-sm font-medium">Add a member</p>
          <p className="text-xs text-muted-foreground">They need a login first. In Supabase, go to Authentication → Users → Add user, then add their email here.</p>
          <FormGrid className="mt-2 lg:grid-cols-4">
            <Input label="Email" type="email" value={email} onChange={setEmail} span={2} />
            <Select label="Role" value={role} onChange={setNewRole} options={roleOptions} />
            <div className="flex items-end">
              <Button type="submit" disabled={addMember.isPending}>
                {addMember.isPending ? 'Adding…' : 'Add'}
              </Button>
            </div>
          </FormGrid>
        </form>
      )}
    </Card>
  )
}
