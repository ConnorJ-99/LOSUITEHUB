import { useState } from 'react'
import { CalendarCheckIcon, CheckCircle2Icon, MailIcon, UserPlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, ToggleChip } from '@/components/shared'
import { useAddToTeam, useContractPeople, usePastTeamMembers, useQueueIntroEmails, useSyncDeadlineTasks } from '@/lib/api/contract'
import { useLoanFile } from '@/lib/api/loanfile'
import { useOrganization, useProfile } from '@/lib/api/settings'
import { useLoanTasks } from '@/lib/api/tasks'
import type { LoanProfile } from '@/lib/api/types'
import type { Application } from '@/lib/api/urla'
import {
  deadlineTasks,
  findOnOtherFiles,
  introEmail,
  mergePerson,
  planTasks,
  samePerson,
  teamRoleFor,
  type Person,
  type TaskPlanRow,
  type TeamRoleFromContract,
} from '@/lib/contract/followThrough'
import { formatIsoDate } from '@/lib/dates'

const ROLE_LABEL: Record<TeamRoleFromContract, string> = {
  listing_agent: 'Listing agent',
  buyer_agent: "Buyer's agent",
  title: 'Title company',
  escrow_officer: 'Escrow officer',
}
const ROLES: TeamRoleFromContract[] = ['listing_agent', 'buyer_agent', 'title', 'escrow_officer']

const STATUS: Record<TaskPlanRow['status'], { label: (r: TaskPlanRow) => string; tone: string }> = {
  new: { label: () => 'New', tone: 'bg-primary/10 text-primary' },
  moved: { label: (r) => `Date changed (was ${formatIsoDate(r.existing?.dueOn)})`, tone: 'bg-amber-100 text-amber-900' },
  set: { label: () => 'Task set', tone: 'bg-muted text-muted-foreground' },
  done: { label: () => 'Done', tone: 'bg-emerald-100 text-emerald-800' },
}

function DeadlineTasksCard({ loan }: { loan: LoanProfile }) {
  const tasks = useLoanTasks(loan.id)
  const sync = useSyncDeadlineTasks(loan.id, loan.organizationId)
  const wanted = deadlineTasks(loan.details)
  const plan = planTasks(
    wanted,
    (tasks.data ?? []).map((t) => ({ id: t.id, sourceKey: t.sourceKey, title: t.title, dueOn: t.dueOn, completedAt: t.completedAt })),
  )
  const toCreate = plan.filter((p) => p.status === 'new').length
  const toMove = plan.filter((p) => p.status === 'moved').length
  const label = [toCreate && `Create ${toCreate}`, toMove && `update ${toMove}`].filter(Boolean).join(', ')

  return (
    <Card
      title="Deadline tasks"
      description="One task per contract deadline. If a date changes, the task's due date follows."
      action={
        label ? (
          <Button size="sm" disabled={sync.isPending} onClick={() => sync.mutate(plan, { onSuccess: () => toast.success('Deadline tasks saved'), onError: (e) => toast.error(e.message) })}>
            <CalendarCheckIcon />
            {sync.isPending ? 'Saving…' : `${label[0].toUpperCase()}${label.slice(1)} task${toCreate + toMove === 1 ? '' : 's'}`}
          </Button>
        ) : undefined
      }
    >
      {plan.length === 0 ? (
        <p className="text-sm text-muted-foreground">Fill in the contract dates (or apply a contract reading) to make deadline tasks.</p>
      ) : (
        <ul className="divide-y">
          {plan.map((r) => (
            <li key={r.task.key} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0">
                {r.task.title}
                <span className="text-muted-foreground"> · due {formatIsoDate(r.task.dueOn)}</span>
              </span>
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS[r.status].tone)}>{STATUS[r.status].label(r)}</span>
            </li>
          ))}
        </ul>
      )}
      {wanted.some((t) => t.key === 'contract:closing_disclosure') && (
        <p className="mt-2 text-xs text-muted-foreground">The Closing Disclosure date counts back 3 days, skipping Sundays and federal holidays. Arive's dates are the official ones.</p>
      )}
    </Card>
  )
}

function PeopleCard({ loan }: { loan: LoanProfile }) {
  const contacts = useContractPeople(loan.id)
  const file = useLoanFile(loan.id)
  const past = usePastTeamMembers()
  const add = useAddToTeam(loan.id, loan.organizationId)
  const people = (contacts.data ?? []).flatMap((c) => {
    const role = teamRoleFor(c.role)
    if (!role) return []
    const known = findOnOtherFiles(c, past.data ?? [], loan.id)
    return [{ role, person: mergePerson(c, known), known }]
  })

  if (people.length === 0) {
    return (
      <Card title="People from the contract" description="Agents and title contacts named in the contract.">
        <p className="text-sm text-muted-foreground">They appear here after the assistant reads the contract. You can also set the team by hand in the file header.</p>
      </Card>
    )
  }
  return (
    <Card title="People from the contract" description="Add them to the file's team. People you've worked with before are matched by email or phone.">
      <ul className="divide-y">
        {people.map(({ role, person, known }, i) => {
          const current = file.data?.team.find((t) => t.role === role) ?? null
          const onTeam = !!current && samePerson(person, { name: current.name, company: current.company, email: current.email, phone: current.phone })
          return (
            <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p>
                  <span className="text-muted-foreground">{ROLE_LABEL[role]}: </span>
                  {person.name}
                  {person.company && <span className="text-muted-foreground"> · {person.company}</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  {[person.email, person.phone].filter(Boolean).join(' · ') || 'No email or phone in the contract'}
                  {known && ` · worked with on ${known.borrowerName}'s file`}
                </p>
              </div>
              {onTeam ? (
                <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                  <CheckCircle2Icon className="size-3.5" />
                  On the team
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={add.isPending}
                  onClick={() => add.mutate({ role, person }, { onSuccess: () => toast.success(`${person.name} added as ${ROLE_LABEL[role].toLowerCase()}`), onError: (e) => toast.error(e.message) })}
                >
                  <UserPlusIcon />
                  {current ? `Replace ${current.name ?? 'current'}` : 'Add to team'}
                </Button>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}

function IntroEmailsCard({ loan, app, propertyAddress }: { loan: LoanProfile; app: Application; propertyAddress: string | null }) {
  const file = useLoanFile(loan.id)
  const profile = useProfile(loan.assignedLo?.id)
  const org = useOrganization()
  const queue = useQueueIntroEmails(loan.id, loan.organizationId)
  const team = ROLES.flatMap((role) => {
    const t = file.data?.team.find((m) => m.role === role && !m.profileId && m.name)
    return t ? [{ role, person: { name: t.name, company: t.company, email: t.email, phone: t.phone } as Person }] : []
  })
  const [picked, setPicked] = useState<Partial<Record<TeamRoleFromContract, boolean>>>({})
  const isPicked = (role: TeamRoleFromContract, person: Person) => picked[role] ?? !!person.email
  const chosen = team.filter((t) => isPicked(t.role, t.person))

  const buyerNames = app.borrowers.map((b) => `${b.person.firstName} ${b.person.lastName}`.trim()).join(' and ') || 'our buyer'
  const draft = () => {
    const signer = {
      loName: profile.data?.fullName ?? null,
      loNmls: profile.data?.nmls ?? null,
      loPhone: profile.data?.phone ?? null,
      companyName: org.data?.name ?? 'MPS Mortgage LLC',
      companyNmls: org.data?.nmls ?? '2501110',
    }
    const drafts = chosen.map(({ role, person }) => ({
      title: `Intro email to the ${ROLE_LABEL[role].toLowerCase()}${person.name ? ` (${person.name})` : ''}`,
      draft: introEmail(role, person, { buyerNames, propertyAddress, dates: loan.details, signer }),
    }))
    queue.mutate(drafts, { onSuccess: () => toast.success(`${drafts.length} intro email${drafts.length === 1 ? '' : 's'} added to the Action Queue`), onError: (e) => toast.error(e.message) })
  }

  return (
    <Card
      title="Intro emails"
      description="Drafted from the file, with the contract dates and your signature. They go to the Action Queue; you approve, copy and send them."
      action={
        chosen.length ? (
          <Button size="sm" onClick={draft} disabled={queue.isPending || (!!loan.assignedLo && !profile.data)}>
            <MailIcon />
            {queue.isPending ? 'Drafting…' : `Draft ${chosen.length} intro email${chosen.length === 1 ? '' : 's'}`}
          </Button>
        ) : undefined
      }
    >
      {team.length === 0 ? (
        <p className="text-sm text-muted-foreground">Add the agents and title company to the team first.</p>
      ) : (
        <ul className="divide-y">
          {team.map(({ role, person }) => (
            <li key={role} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <span className="min-w-0">
                <span className="text-muted-foreground">{ROLE_LABEL[role]}: </span>
                {person.name}
                <span className="text-xs text-muted-foreground"> · {person.email ?? 'no email on file'}</span>
              </span>
              <ToggleChip label="Draft" pressed={isPicked(role, person)} onChange={(p) => setPicked((s) => ({ ...s, [role]: p }))} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/** What happens after the contract: deadline tasks, the team, and intro emails. */
export function ContractFollowThrough({ loan, app, propertyAddress }: { loan: LoanProfile; app: Application; propertyAddress: string | null }) {
  return (
    <div className="space-y-4">
      <DeadlineTasksCard loan={loan} />
      <PeopleCard loan={loan} />
      <IntroEmailsCard loan={loan} app={app} propertyAddress={propertyAddress} />
    </div>
  )
}
