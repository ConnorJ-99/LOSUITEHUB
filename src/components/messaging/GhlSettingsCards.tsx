import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Select as BaseSelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, confirmAction, Input, ToggleChip } from '@/components/shared'
import {
  useGhlCheck,
  useGhlLinks,
  useGhlStatus,
  useLastGhlCheck,
  useLinkGhlUser,
  useMessagingSettings,
  useSaveMessagingSettings,
  useUnlinkGhlUser,
  type CheckResult,
  type GhlCheckResult,
  type GhlLink,
  type GhlUser,
} from '@/lib/api/ghl'
import type { OrgMember } from '@/lib/api/types'
import { roleLabels } from '@/lib/auth/context'
import { relativeTime } from '@/lib/dates'
import { DAY_LABELS, DAYS, DEFAULT_SEND_HOURS, sendHoursProblem, sendHoursSummary, type SendHours } from '@/lib/messaging/sendHours'
import { formatPhone } from '@/lib/pipeline/helpers'

const chip = {
  ok: 'rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700',
  warn: 'rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800',
  bad: 'rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700',
}

const RESULT_CHIP: Record<CheckResult, { label: string; className: string }> = {
  works: { label: 'Works', className: chip.ok },
  missing_scope: { label: 'Needs a scope', className: chip.warn },
  bad_token: { label: 'Token refused', className: chip.bad },
  failed: { label: 'Failed', className: chip.bad },
}

function Note({ tone, children }: { tone: 'warn' | 'bad'; children: React.ReactNode }) {
  return <p className={tone === 'warn' ? 'rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900' : 'rounded-md bg-red-50 px-3 py-2 text-sm text-red-800'}>{children}</p>
}

function ChecksList({ result }: { result: GhlCheckResult }) {
  return (
    <div className="space-y-2">
      {result.tokenRejected && <Note tone="bad">GHL did not accept the token. Make a new Private Integration token in GHL and paste it into GHL_PRIVATE_TOKEN under Edge Functions → Secrets in Supabase.</Note>}
      {result.missingScopes.length > 0 && (
        <Note tone="warn">
          Add {result.missingScopes.length === 1 ? 'this scope' : 'these scopes'} in GHL → Settings → Private Integrations: <span className="font-medium">{result.missingScopes.join(', ')}</span>. The token stays the same.
        </Note>
      )}
      {result.logError && <Note tone="warn">{result.logError}</Note>}
      <ul className="divide-y text-sm">
        {result.checks.map((c) => (
          <li key={c.key} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
            <span>{c.label}</span>
            <span className="flex items-center gap-2">
              {c.result !== 'works' && <span className="text-xs text-muted-foreground">{c.detail}</span>}
              <span className={RESULT_CHIP[c.result].className}>{RESULT_CHIP[c.result].label}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const userLabel = (u: GhlUser, numberOf: (u: GhlUser) => string | null) => {
  const n = numberOf(u)
  return `${u.name} · ${n ? formatPhone(n) : 'no number'}`
}

function MemberRow({ member, link, result, takenBy }: { member: OrgMember; link: GhlLink | undefined; result: GhlCheckResult | undefined; takenBy: Map<string, string> }) {
  const linkUser = useLinkGhlUser()
  const unlinkUser = useUnlinkGhlUser()
  const users = result?.users ?? []
  // Same rule as the function: GHL's number list first, else the user's number in this sub-account.
  const numberOf = (u: GhlUser) => result?.numbers.find((n) => n.assignedUserId === u.id)?.number ?? u.ghlNumber
  const suggested = !link ? users.find((u) => u.email && u.email.toLowerCase() === member.email.toLowerCase() && !takenBy.has(u.id)) : undefined

  const linkTo = (ghlUserId: string) =>
    linkUser.mutate(
      { profileId: member.id, ghlUserId },
      {
        onSuccess: ({ link: saved, logError }) => {
          if (saved.number_confirmed_at && saved.ghl_number) toast.success(`${member.name} texts from ${formatPhone(saved.ghl_number)}`)
          else toast.warning(`${member.name} is linked, but GHL shows no number for ${saved.ghl_name ?? 'that user'}. Texts from their files will wait for review.`)
          if (logError) toast.warning(logError)
        },
        onError: (e) => toast.error(e.message),
      },
    )

  const unlink = async () => {
    if (!link) return
    if (!(await confirmAction(`Unlink ${member.name} from ${link.ghlName ?? 'their GHL user'}? Texts and emails on their files will wait for an admin to review until they're linked again.`, { confirmLabel: 'Unlink', destructive: true }))) return
    unlinkUser.mutate(link.id, { onSuccess: () => toast.success(`${member.name} unlinked`), onError: (e) => toast.error(e.message) })
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
      <span className="min-w-0">
        {member.name}
        <span className="ml-2 text-xs text-muted-foreground">{roleLabels[member.role]}</span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        {link && (
          <>
            <span className="tabular-nums">{link.ghlNumber ? formatPhone(link.ghlNumber) : 'No number'}</span>
            {link.numberConfirmedAt ? (
              <span className={chip.ok} title={`GHL showed this number assigned to ${link.ghlName ?? 'this user'} ${relativeTime(link.numberConfirmedAt)}`}>
                Confirmed
              </span>
            ) : (
              <span className={chip.warn} title="Texts on this person's files wait for review until GHL shows a number assigned to their GHL user.">
                Not confirmed
              </span>
            )}
          </>
        )}
        {!link && suggested && (
          <Button size="sm" variant="outline" disabled={linkUser.isPending} onClick={() => linkTo(suggested.id)}>
            Link to {suggested.name}
          </Button>
        )}
        <BaseSelect value={link?.ghlUserId ?? ''} onValueChange={linkTo} disabled={!result || linkUser.isPending}>
          <SelectTrigger size="sm" className="w-64" aria-label={`GHL user for ${member.name}`}>
            <SelectValue placeholder={result ? 'Pick their GHL user' : 'Check connection first'}>{link ? link.ghlName ?? 'Linked' : undefined}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {users.map((u) => {
              const other = takenBy.get(u.id)
              const taken = !!other && other !== member.id
              return (
                <SelectItem key={u.id} value={u.id} disabled={taken}>
                  {userLabel(u, numberOf)}
                  {taken ? ' (linked to someone else)' : ''}
                </SelectItem>
              )
            })}
          </SelectContent>
        </BaseSelect>
        {link && (
          <Button size="sm" variant="ghost" disabled={unlinkUser.isPending} onClick={unlink}>
            Unlink
          </Button>
        )}
      </span>
    </li>
  )
}

/**
 * GoHighLevel: the connection, what the token can do, and which GHL user and
 * number each team member texts from. Owners and admins only.
 */
export function GhlCard({ members }: { members: OrgMember[] }) {
  const status = useGhlStatus()
  const ready = status.data?.ready === true
  const check = useGhlCheck(ready)
  const links = useGhlLinks()
  const lastCheck = useLastGhlCheck()
  const linkOf = new Map((links.data ?? []).map((l) => [l.profileId, l]))
  const takenBy = new Map((links.data ?? []).map((l) => [l.ghlUserId, l.profileId]))

  const header = () => {
    if (status.isPending) return <p className="text-sm text-muted-foreground">Looking for the GHL connection…</p>
    if (status.data?.reason === 'not_set_up') return <Note tone="warn">GHL is not set up yet. Add GHL_PRIVATE_TOKEN and GHL_LOCATION_ID under Edge Functions → Secrets in Supabase.</Note>
    if (!ready) return <Note tone="warn">The ghl function isn't deployed on this Supabase project yet, so LOSuite can't reach GHL. Everything else works as usual.</Note>
    if (check.isFetching && !check.data) return <p className="text-sm text-muted-foreground">Checking the connection…</p>
    if (check.error) return <Note tone="bad">{check.error.message}</Note>
    return (
      <p className="text-sm">
        Connected to <span className="font-medium">{check.data?.location?.name ?? 'the MPS Mortgage sub-account'}</span>
        {lastCheck.data && <span className="text-muted-foreground"> · checked {relativeTime(lastCheck.data)}</span>}
      </p>
    )
  }

  return (
    <Card
      title="GoHighLevel"
      description="Texts and emails go through the MPS Mortgage sub-account. LOSuite stays the record; GHL only delivers."
      action={
        ready && (
          <Button size="sm" variant="outline" disabled={check.isFetching} onClick={() => check.refetch()}>
            {check.isFetching ? 'Checking…' : 'Check connection'}
          </Button>
        )
      }
    >
      <div className="space-y-4">
        {header()}
        {check.data && <ChecksList result={check.data} />}
        {ready && (
          <div>
            <p className="text-sm font-medium">Who texts from which number</p>
            <p className="text-xs text-muted-foreground">
              Each loan officer texts from their own GHL number, once GHL confirms it's assigned to them. A file whose loan officer isn't linked and confirmed doesn't send; it waits for an admin to review.
            </p>
            <ul className="mt-1 divide-y">
              {members.map((m) => (
                <MemberRow key={m.id} member={m} link={linkOf.get(m.id)} result={check.data} takenBy={takenBy} />
              ))}
            </ul>
          </div>
        )}
      </div>
    </Card>
  )
}

function HoursEditor({ saved, onSave, saving }: { saved: SendHours; onSave: (h: SendHours) => void; saving: boolean }) {
  const [hours, setHours] = useState<SendHours>(saved)
  const dirty = JSON.stringify(hours) !== JSON.stringify(saved)
  const setDay = (d: (typeof DAYS)[number], v: [string, string] | null) => setHours((h) => ({ ...h, [d]: v }))

  const save = () => {
    const problem = sendHoursProblem(hours)
    if (problem) return toast.error(problem)
    onSave(hours)
  }

  return (
    <div>
      <ul className="divide-y">
        {DAYS.map((d) => {
          const v = hours[d]
          return (
            <li key={d} className="flex flex-wrap items-center gap-3 py-1.5 text-sm">
              <span className="w-24">{DAY_LABELS[d]}</span>
              <ToggleChip label={v ? 'Sends' : 'No sending'} pressed={!!v} onChange={(on) => setDay(d, on ? (saved[d] ?? DEFAULT_SEND_HOURS[d]) : null)} />
              {v && (
                <span className="flex items-center gap-2">
                  <Input label={`${DAY_LABELS[d]} from`} hideLabel type="time" value={v[0]} onChange={(t) => setDay(d, [t, v[1]])} className="w-32" />
                  <span className="text-muted-foreground">to</span>
                  <Input label={`${DAY_LABELS[d]} until`} hideLabel type="time" value={v[1]} onChange={(t) => setDay(d, [v[0], t])} className="w-32" />
                </span>
              )}
            </li>
          )
        })}
      </ul>
      {dirty && (
        <div className="mt-3 flex gap-2">
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save hours'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setHours(saved)} disabled={saving}>
            Discard
          </Button>
        </div>
      )}
    </div>
  )
}

/** When messages may go out, and which address email comes from. Everyone sees it; owners and admins change it. */
export function SendingCard({ canEdit }: { canEdit: boolean }) {
  const settings = useMessagingSettings()
  const save = useSaveMessagingSettings()
  const s = settings.data

  const saveHours = (sendHours: SendHours) => save.mutate({ sendHours }, { onSuccess: () => toast.success('Sending hours saved'), onError: (e) => toast.error(e.message) })
  const setVerified = (emailDomainVerified: boolean) =>
    save.mutate(
      { emailDomainVerified },
      { onSuccess: () => toast.success(emailDomainVerified ? 'Loan officers will email from their own address' : 'Email will go from info@mps.mortgage'), onError: (e) => toast.error(e.message) },
    )

  return (
    <Card title="Sending" description="When texts and emails may go out, in Central time. Nothing is sent without someone clicking Send or Approve.">
      {!s ? (
        <p className="text-sm text-muted-foreground">{settings.error ? settings.error.message : 'Loading…'}</p>
      ) : (
        <div className="space-y-4">
          <div>
            <p className="text-sm">
              <span className="font-medium">{sendHoursSummary(s.sendHours)}</span>
              <span className="text-muted-foreground"> · being confirmed with compliance</span>
            </p>
            {canEdit && <HoursEditor key={JSON.stringify(s.sendHours)} saved={s.sendHours} onSave={saveHours} saving={save.isPending} />}
          </div>
          <div className="border-t pt-4">
            <p className="text-sm font-medium">Email sender</p>
            <p className="text-xs text-muted-foreground">
              {s.emailDomainVerified
                ? 'mps.mortgage is verified for sending in GHL, so each loan officer emails from their own address.'
                : 'Until mps.mortgage is verified for sending in GHL (Settings → Email Services → Dedicated Domain), email goes from info@mps.mortgage.'}
            </p>
            <ToggleChip className="mt-2" label="mps.mortgage is verified for sending in GHL" pressed={s.emailDomainVerified} onChange={setVerified} disabled={!canEdit || save.isPending} />
          </div>
        </div>
      )}
    </Card>
  )
}
