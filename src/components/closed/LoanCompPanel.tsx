import { useState } from 'react'
import { CheckCircle2Icon, LockOpenIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { confirmAction, DateInput, FormGrid, NumberInput, PercentInput, Select } from '@/components/shared'
import { DEFAULT_COMP, useCompConfirmation, useCompSettings, useLoanCompFields, useSaveLoanComp, useSetCompConfirmation, type CompConfirmation } from '@/lib/api/compSettings'
import { loanComp, loanRevenue, type CompSnapshot } from '@/lib/calc'
import { formatCurrency } from '@/lib/format'

const SOURCE = [
  { value: 'company' as const, label: 'Company-generated' },
  { value: 'self' as const, label: 'Self-generated' },
]
const BASE = [
  { value: 'revenue' as const, label: 'Company revenue' },
  { value: 'loan_bps' as const, label: 'Loan amount × bps' },
]
const MEMBER = [
  { value: 'commission' as const, label: 'Commission' },
  { value: 'salary' as const, label: 'Salary-only' },
]

/**
 * A closed file's comp (owners and admins): the lead source and the snapshot
 * taken when it closed, editable (each change logged), with gross revenue, LO
 * comp and net worked out from them. Not stored. "Confirm commission" records
 * who checked it and locks the numbers (revenue, loan amount, lead source,
 * comp, loan officer) until Unlock; then "Paid on" records the payroll date.
 */
export function LoanCompPanel({ loanId, loanAmount, revenueType, revenueValue }: { loanId: string; loanAmount: number | null; revenueType: 'percent' | 'amount' | null; revenueValue: number | null }) {
  const fields = useLoanCompFields(loanId)
  const settings = useCompSettings()
  const confirmation = useCompConfirmation(loanId)
  if (fields.isError) return <p className="text-xs text-muted-foreground">Comp shows once the comp settings database script has run.</p>
  if (!fields.data) return null
  const s = settings.data ?? DEFAULT_COMP
  // A loan closed before comp settings existed starts from today's settings (saved only when you press Save).
  const start: CompSnapshot = fields.data.snapshot ?? { baseMode: s.baseMode, baseBps: s.baseBps, splitPct: fields.data.leadSourceType === 'company' ? s.companySplitPct : s.selfSplitPct, memberType: 'commission' }
  return <Form key={JSON.stringify(fields.data)} loanId={loanId} saved={fields.data} start={start} revenue={loanRevenue(loanAmount, revenueType, revenueValue).amount} loanAmount={loanAmount} splits={s} confirmation={confirmation.data ?? null} />
}

function Form({ loanId, saved, start, revenue, loanAmount, splits, confirmation }: { loanId: string; saved: ReturnType<typeof useLoanCompFields>['data'] & object; start: CompSnapshot; revenue: number | null; loanAmount: number | null; splits: { companySplitPct: number; selfSplitPct: number }; confirmation: CompConfirmation | null }) {
  const save = useSaveLoanComp(loanId)
  const confirmed = !!confirmation?.confirmedAt
  const [source, setSource] = useState<'company' | 'self'>(saved.leadSourceType ?? 'self')
  const [snap, setSnap] = useState<CompSnapshot>(start)
  const set = (patch: Partial<CompSnapshot>) => setSnap((x) => ({ ...x, ...patch }))
  const dirty = source !== saved.leadSourceType || JSON.stringify(snap) !== JSON.stringify(saved.snapshot)
  const c = loanComp({ loanAmount, revenue }, snap)
  const money = (v: number | null) => (v == null ? '—' : formatCurrency(v))

  return (
    <div className="rounded-md border px-3 py-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium">Comp</p>
        <p className="text-xs text-muted-foreground">{saved.snapshotAt ? `Snapshot taken when it closed (${new Date(saved.snapshotAt).toLocaleDateString('en-US')})` : 'No snapshot yet (closed before comp settings): saving takes one'}</p>
      </div>
      <FormGrid>
        <Select label="Lead source" value={source} options={SOURCE} readOnly={confirmed} onChange={(v) => (setSource(v), set({ splitPct: v === 'company' ? splits.companySplitPct : splits.selfSplitPct }))} span={2} />
        <Select label="Comp base" value={snap.baseMode} options={BASE} readOnly={confirmed} onChange={(baseMode) => set({ baseMode })} span={2} />
        {snap.baseMode === 'loan_bps' && <NumberInput label="Basis points" value={snap.baseBps} readOnly={confirmed} onChange={(baseBps) => set({ baseBps })} />}
        <PercentInput label="LO split" value={snap.splitPct} readOnly={confirmed} onChange={(v) => set({ splitPct: v ?? 0 })} />
        <Select label="Comp type" value={snap.memberType} options={MEMBER} readOnly={confirmed} onChange={(memberType) => set({ memberType })} />
      </FormGrid>
      <dl className="mt-3 grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">Gross revenue</dt>
          <dd className="font-semibold tabular-nums">{c.needsRevenue ? <span className="text-amber-700">Needs revenue</span> : money(c.gross)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">LO comp</dt>
          <dd className="font-semibold tabular-nums">{money(c.loComp)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Net to company</dt>
          <dd className="font-semibold tabular-nums">{c.needsRevenue ? '—' : money(c.net)}</dd>
        </div>
      </dl>
      {confirmation && <Confirmation loanId={loanId} c={confirmation} canConfirm={!dirty && !c.needsRevenue && !!saved.snapshotAt} why={dirty ? 'Save the comp first.' : c.needsRevenue ? 'Enter the revenue first.' : !saved.snapshotAt ? 'Save the comp first (it takes the snapshot).' : null} />}
      {dirty && !confirmed && (
        <div className="mt-2 flex justify-end">
          <Button size="sm" disabled={save.isPending || (snap.baseMode === 'loan_bps' && !snap.baseBps)} onClick={() => save.mutate({ leadSourceType: source, snapshot: snap }, { onSuccess: () => toast.success('Comp saved (logged)'), onError: (e) => toast.error(e.message) })}>
            {save.isPending ? 'Saving…' : 'Save comp'}
          </Button>
        </div>
      )}
    </div>
  )
}

/** Confirm commission (locks it), Unlock, and the payroll Paid on date. */
function Confirmation({ loanId, c, canConfirm, why }: { loanId: string; c: CompConfirmation; canConfirm: boolean; why: string | null }) {
  const set = useSetCompConfirmation(loanId)
  const fail = (e: Error) => toast.error(e.message)
  if (!c.confirmedAt)
    return (
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
        <p className="text-xs text-muted-foreground">{why ?? 'Check the revenue and the comp, then confirm. It locks them until unlocked.'}</p>
        <Button size="sm" disabled={!canConfirm || set.isPending} onClick={() => set.mutate({ confirmed: true }, { onSuccess: () => toast.success('Commission confirmed and locked'), onError: fail })}>
          <CheckCircle2Icon />
          Confirm commission
        </Button>
      </div>
    )
  const unlock = async () => {
    if (!(await confirmAction(c.paidOn ? 'Unlock this commission? It also clears the Paid on date. The revenue and comp can then be changed (every change is logged).' : 'Unlock this commission? The revenue and comp can then be changed (every change is logged).', { confirmLabel: 'Unlock' }))) return
    set.mutate({ confirmed: false }, { onSuccess: () => toast.success('Commission unlocked'), onError: fail })
  }
  return (
    <div className="mt-3 space-y-2 border-t pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-medium text-nurture">
          <CheckCircle2Icon className="size-4" />
          Confirmed by {c.confirmedBy ?? 'someone no longer on the team'} on {new Date(c.confirmedAt).toLocaleDateString('en-US')}
        </p>
        <Button size="sm" variant="ghost" disabled={set.isPending} onClick={() => void unlock()}>
          <LockOpenIcon />
          Unlock
        </Button>
      </div>
      <div className="max-w-56">
        <DateInput label="Paid on (payroll)" value={c.paidOn} onChange={(paidOn) => set.mutate({ paidOn }, { onSuccess: () => toast.success(paidOn ? 'Paid date saved' : 'Paid date cleared'), onError: fail })} />
      </div>
    </div>
  )
}
