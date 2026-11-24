// Goals on a file's MyHome tab (Nurture goals Phase 1, Connor 2026-11-24):
// add savings, credit-score and debt goals for the primary borrower, see what
// they reported next to what you verified, edit the target, pause, remove,
// Verify (with "complete"), and each goal's full history. Completing a goal
// never changes the stage or pre-approval.
import { useState } from 'react'
import { CheckIcon, PauseIcon, PlayIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, confirmAction, CurrencyInput, DateInput, Input, NumberInput, Select, ToggleChip, ToggleChipGroup } from '@/components/shared'
import {
  DEBT_TYPE_LABEL,
  GOAL_STATUS_LABEL,
  useAddGoal,
  useEditGoal,
  useNurtureGoals,
  usePlanMilestones,
  useRemoveGoal,
  useVerifyGoal,
  type DebtType,
  type GoalInput,
  type GoalUpdate,
  type NurtureGoal,
} from '@/lib/api/nurtureGoals'
import { useApplication } from '@/lib/api/urla'
import type { LoanProfile } from '@/lib/api/types'
import { goalProgress, type GoalKind } from '@/lib/calc/goals'
import { formatIsoDate, relativeTime } from '@/lib/dates'
import { formatCurrency } from '@/lib/format'

const KINDS: { kind: GoalKind; label: string; defaultLabel: string }[] = [
  { kind: 'savings', label: 'Savings', defaultLabel: 'Down payment & closing costs' },
  { kind: 'credit', label: 'Credit score', defaultLabel: 'Credit score' },
  { kind: 'debt', label: 'Pay down a debt', defaultLabel: 'Credit card' },
]

const show = (kind: GoalKind, v: number | null) => (v == null ? '—' : kind === 'credit' ? String(Math.round(v)) : formatCurrency(v))

export function GoalsCard({ loan }: { loan: LoanProfile }) {
  const data = useNurtureGoals(loan.id)
  const [adding, setAdding] = useState(false)
  const person = loan.borrower
  if (data.isLoading || !person) return null
  if (data.data === null) return <Card title="Goals"><p className="text-sm text-muted-foreground">Goals turn on once their database script has run.</p></Card>
  const goals = (data.data?.goals ?? []).filter((g) => g.contactId === person.id)
  const nurture = loan.stage === 'nurture'
  if (!nurture && goals.length === 0) return null

  return (
    <Card
      title="Goals"
      description={`What ${person.firstName} is working toward. They update these in MyHome; you verify. Completing a goal never pre-approves them.`}
      action={
        nurture && !adding ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            <PlusIcon />
            Add goal
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-3">
        {adding && <AddGoal loan={loan} contactId={person.id} onDone={() => setAdding(false)} />}
        {goals.length === 0 && !adding && <p className="text-sm text-muted-foreground">No goals yet. Add a savings, credit score or debt goal; {person.firstName} sees it in MyHome.</p>}
        {goals.map((g) => (
          <GoalRow key={g.id} loanId={loan.id} goal={g} history={(data.data?.updates ?? []).filter((u) => u.goalId === g.id)} />
        ))}
      </div>
    </Card>
  )
}

function AddGoal({ loan, contactId, onDone }: { loan: LoanProfile; contactId: string; onDone: () => void }) {
  const add = useAddGoal(loan.id, loan.organizationId, contactId)
  const app = useApplication(loan.id)
  const milestones = usePlanMilestones(loan.id)
  const [f, setF] = useState<GoalInput>({ kind: 'savings', label: KINDS[0].defaultLabel, debtType: null, liabilityId: null, milestoneId: null, start: 0, target: 0, targetDate: null })
  const debts = (app.data?.liabilities ?? []).filter((l) => l.contactId === contactId && (l.unpaidBalance ?? 0) > 0)
  const credit = f.kind === 'credit'
  const problem =
    !f.label.trim() ? 'Name the goal.'
    : credit && (f.start < 300 || f.start > 850 || f.target < 300 || f.target > 850) ? 'Scores are between 300 and 850.'
    : f.kind === 'debt' ? (!f.debtType ? 'Pick the kind of debt.' : f.target >= f.start ? 'The target balance must be below the starting balance.' : null)
    : f.target <= f.start ? 'The target must be above the starting amount.'
    : null
  const kind = (k: GoalKind) =>
    setF((x) => ({ ...x, kind: k, label: KINDS.find((d) => d.kind === k)!.defaultLabel, debtType: k === 'debt' ? 'credit_card' : null, liabilityId: null, start: k === 'credit' ? 580 : 0, target: k === 'credit' ? 620 : 0 }))
  const save = () =>
    add.mutate(f, {
      onSuccess: () => {
        toast.success('Goal added. It shows in their MyHome now.')
        onDone()
      },
      onError: (e) => toast.error(e.message),
    })
  return (
    <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
      <ToggleChipGroup>
        {KINDS.map((k) => (
          <ToggleChip key={k.kind} label={k.label} pressed={f.kind === k.kind} onChange={() => kind(k.kind)} />
        ))}
      </ToggleChipGroup>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Goal name" value={f.label} onChange={(v) => setF((x) => ({ ...x, label: v }))} />
        {f.kind === 'debt' && (
          <Select label="Kind of debt" value={f.debtType} options={Object.entries(DEBT_TYPE_LABEL).map(([value, label]) => ({ value: value as DebtType, label }))} onChange={(v) => setF((x) => ({ ...x, debtType: v }))} />
        )}
        {f.kind === 'debt' && debts.length > 0 && (
          <Select
            label="Debt on the 1003 (optional)"
            value={f.liabilityId}
            placeholder="Not linked"
            options={debts.map((d) => ({ value: d.id, label: `${d.creditorName ?? 'Debt'}${d.accountLast4 ? ` ··${d.accountLast4}` : ''} · ${formatCurrency(d.unpaidBalance)}` }))}
            onChange={(id) => {
              const d = debts.find((x) => x.id === id)
              setF((x) => ({ ...x, liabilityId: id, start: d?.unpaidBalance ?? x.start, label: d?.creditorName ?? x.label }))
            }}
          />
        )}
        {credit ? (
          <>
            <NumberInput label="Starting score" value={f.start} onChange={(v) => setF((x) => ({ ...x, start: v ?? 0 }))} maxDecimals={0} />
            <NumberInput label="Target score" value={f.target} onChange={(v) => setF((x) => ({ ...x, target: v ?? 0 }))} maxDecimals={0} />
          </>
        ) : (
          <>
            <CurrencyInput label={f.kind === 'debt' ? 'Starting balance' : 'Starting savings'} value={f.start} onChange={(v) => setF((x) => ({ ...x, start: v ?? 0 }))} />
            <CurrencyInput label={f.kind === 'debt' ? 'Target balance' : 'Savings target'} value={f.target} onChange={(v) => setF((x) => ({ ...x, target: v ?? 0 }))} />
          </>
        )}
        <DateInput label="Target date (optional)" value={f.targetDate} onChange={(v) => setF((x) => ({ ...x, targetDate: v || null }))} />
        {(milestones.data?.length ?? 0) > 0 && (
          <Select
            label="Completes a plan milestone (optional)"
            value={f.milestoneId}
            placeholder="None"
            options={milestones.data!.map((m) => ({ value: m.id, label: m.title }))}
            onChange={(v) => setF((x) => ({ ...x, milestoneId: v }))}
          />
        )}
      </div>
      {problem && <p className="text-xs text-muted-foreground">{problem}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button size="sm" disabled={!!problem || add.isPending} onClick={save}>
          {add.isPending ? 'Adding…' : 'Add goal'}
        </Button>
      </div>
    </div>
  )
}

function GoalRow({ loanId, goal: g, history }: { loanId: string; goal: NurtureGoal; history: GoalUpdate[] }) {
  const edit = useEditGoal(loanId)
  const remove = useRemoveGoal(loanId)
  const verify = useVerifyGoal(loanId)
  const [open, setOpen] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [value, setValue] = useState<number | null>(g.current)
  const [complete, setComplete] = useState(g.status === 'reported_complete')
  const [target, setTarget] = useState<number | null>(null)
  const p = goalProgress({ kind: g.kind, start: g.start, target: g.target, current: g.current })
  const fail = (e: Error) => toast.error(e.message)
  const done = g.status === 'verified_complete'
  const doRemove = async () => {
    if (await confirmAction(`Remove the goal "${g.label}"? It leaves their MyHome. Its history is removed too.`, { confirmLabel: 'Remove', destructive: true })) remove.mutate(g.id, { onSuccess: () => toast.success('Goal removed'), onError: fail })
  }
  return (
    <div className={cn('rounded-lg border p-3', g.paused && 'opacity-70')}>
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {g.label}
            {g.debtType && <span className="ml-1 text-xs font-normal text-muted-foreground">· {DEBT_TYPE_LABEL[g.debtType]}</span>}
          </p>
          <p className="text-xs text-muted-foreground">
            {show(g.kind, g.start)} → {show(g.kind, g.target)}
            {g.targetDate && ` · by ${formatIsoDate(g.targetDate)}`}
            {g.followsAssets.length > 0 && ` · follows ${g.followsAssets.length} of their MyHome account${g.followsAssets.length === 1 ? '' : 's'}`}
          </p>
        </div>
        <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', done ? 'bg-emerald-50 text-emerald-700' : g.status === 'reported_complete' ? 'bg-amber-50 text-amber-800' : 'bg-muted text-muted-foreground')}>
          {g.paused ? 'Paused' : GOAL_STATUS_LABEL[g.status]}
        </span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={p.pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${g.label} progress`}>
        <div className={cn('h-full rounded-full', done ? 'bg-emerald-600' : 'bg-primary')} style={{ width: `${p.pct}%` }} />
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Reported</dt>
          <dd className="font-semibold tabular-nums">{show(g.kind, g.current)}</dd>
          {g.currentAt && <dd className="text-xs text-muted-foreground">{relativeTime(g.currentAt)}</dd>}
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Verified</dt>
          <dd className="font-semibold tabular-nums">{show(g.kind, g.verified)}</dd>
          {g.verifiedAt && <dd className="text-xs text-muted-foreground">{formatIsoDate(g.verifiedAt.slice(0, 10))}</dd>}
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Progress</dt>
          <dd className="font-semibold tabular-nums">{p.pct}%</dd>
          <dd className="text-xs text-muted-foreground">{p.reached ? 'Target reached' : `${show(g.kind, p.remaining)} to go`}</dd>
        </div>
      </dl>

      {verifying ? (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md bg-muted/40 p-2">
          <div className="w-40">
            {g.kind === 'credit' ? (
              <NumberInput label="Verified score" value={value} onChange={setValue} maxDecimals={0} hint="Becomes the file's credit score" />
            ) : (
              <CurrencyInput label={g.kind === 'debt' ? 'Verified balance' : 'Verified savings'} value={value} onChange={setValue} />
            )}
          </div>
          <ToggleChip label="Goal complete" pressed={complete} onChange={setComplete} />
          <Button size="sm" disabled={verify.isPending} onClick={() => verify.mutate({ id: g.id, value, complete }, { onSuccess: () => (setVerifying(false), toast.success(complete ? 'Verified complete' : 'Verified')), onError: fail })}>
            <CheckIcon />
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setVerifying(false)}>
            Cancel
          </Button>
        </div>
      ) : target !== null ? (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md bg-muted/40 p-2">
          <div className="w-40">{g.kind === 'credit' ? <NumberInput label="New target" value={target} onChange={(v) => setTarget(v ?? 0)} maxDecimals={0} /> : <CurrencyInput label="New target" value={target} onChange={(v) => setTarget(v ?? 0)} />}</div>
          <Button size="sm" disabled={edit.isPending} onClick={() => edit.mutate({ id: g.id, target }, { onSuccess: () => (setTarget(null), toast.success('Target changed')), onError: fail })}>
            Save
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setTarget(null)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button size="xs" onClick={() => setVerifying(true)}>
            <CheckIcon />
            Verify
          </Button>
          <Button size="xs" variant="outline" onClick={() => setTarget(g.target)}>
            Change target
          </Button>
          <Button size="xs" variant="outline" disabled={edit.isPending} onClick={() => edit.mutate({ id: g.id, paused: !g.paused }, { onError: fail })}>
            {g.paused ? <PlayIcon /> : <PauseIcon />}
            {g.paused ? 'Resume' : 'Pause'}
          </Button>
          <Button size="xs" variant="ghost" onClick={() => setOpen((o) => !o)}>
            {open ? 'Hide history' : `History (${history.length})`}
          </Button>
          <Button size="xs" variant="ghost" className="ml-auto text-destructive" onClick={() => void doRemove()}>
            <Trash2Icon />
            Remove
          </Button>
        </div>
      )}

      {open && (
        <ul className="mt-2 divide-y rounded-md border text-xs">
          {history.map((h) => (
            <li key={h.id} className="flex gap-2 px-2 py-1.5">
              <span className="w-20 shrink-0 text-muted-foreground">{formatIsoDate(h.happenedOn)}</span>
              <span className="min-w-0 flex-1">{historyLine(g.kind, h)}</span>
              <span className="shrink-0 text-muted-foreground">{h.byBorrower ? 'Borrower' : 'Team'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function historyLine(kind: GoalKind, h: GoalUpdate): string {
  const v = (n: number | null) => show(kind, n)
  switch (h.kind) {
    case 'created':
      return `Goal set: target ${v(h.after)}`
    case 'target_changed':
      return `Target changed ${v(h.before)} → ${v(h.after)}`
    case 'verified':
      return `Verified${h.after != null ? ` at ${v(h.after)}` : ''}${h.note ? ` · ${h.note}` : ''}`
    case 'reported_complete':
      return 'Reported the goal complete'
    case 'contribution':
      return `Added ${v(h.amount)} (${v(h.before)} → ${v(h.after)})`
    case 'payment':
      return `Paid ${v(h.amount)} (${v(h.before)} → ${v(h.after)})`
    case 'note':
      return `Note: ${h.note ?? ''}`
    default:
      return `Updated ${v(h.before)} → ${v(h.after)}${h.note ? ` · ${h.note}` : ''}`
  }
}
