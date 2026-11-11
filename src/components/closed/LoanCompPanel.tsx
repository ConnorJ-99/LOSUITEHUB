import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { FormGrid, NumberInput, PercentInput, Select } from '@/components/shared'
import { DEFAULT_COMP, useCompSettings, useLoanCompFields, useSaveLoanComp } from '@/lib/api/compSettings'
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
 * comp and net worked out from them. Not stored.
 */
export function LoanCompPanel({ loanId, loanAmount, revenueType, revenueValue }: { loanId: string; loanAmount: number | null; revenueType: 'percent' | 'amount' | null; revenueValue: number | null }) {
  const fields = useLoanCompFields(loanId)
  const settings = useCompSettings()
  if (fields.isError) return <p className="text-xs text-muted-foreground">Comp shows once the comp settings database script has run.</p>
  if (!fields.data) return null
  const s = settings.data ?? DEFAULT_COMP
  // A loan closed before comp settings existed starts from today's settings (saved only when you press Save).
  const start: CompSnapshot = fields.data.snapshot ?? { baseMode: s.baseMode, baseBps: s.baseBps, splitPct: fields.data.leadSourceType === 'company' ? s.companySplitPct : s.selfSplitPct, memberType: 'commission' }
  return <Form key={JSON.stringify(fields.data)} loanId={loanId} saved={fields.data} start={start} revenue={loanRevenue(loanAmount, revenueType, revenueValue).amount} loanAmount={loanAmount} splits={s} />
}

function Form({ loanId, saved, start, revenue, loanAmount, splits }: { loanId: string; saved: ReturnType<typeof useLoanCompFields>['data'] & object; start: CompSnapshot; revenue: number | null; loanAmount: number | null; splits: { companySplitPct: number; selfSplitPct: number } }) {
  const save = useSaveLoanComp(loanId)
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
        <Select label="Lead source" value={source} options={SOURCE} onChange={(v) => (setSource(v), set({ splitPct: v === 'company' ? splits.companySplitPct : splits.selfSplitPct }))} span={2} />
        <Select label="Comp base" value={snap.baseMode} options={BASE} onChange={(baseMode) => set({ baseMode })} span={2} />
        {snap.baseMode === 'loan_bps' && <NumberInput label="Basis points" value={snap.baseBps} onChange={(baseBps) => set({ baseBps })} />}
        <PercentInput label="LO split" value={snap.splitPct} onChange={(v) => set({ splitPct: v ?? 0 })} />
        <Select label="Comp type" value={snap.memberType} options={MEMBER} onChange={(memberType) => set({ memberType })} />
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
      {dirty && (
        <div className="mt-2 flex justify-end">
          <Button size="sm" disabled={save.isPending || (snap.baseMode === 'loan_bps' && !snap.baseBps)} onClick={() => save.mutate({ leadSourceType: source, snapshot: snap }, { onSuccess: () => toast.success('Comp saved (logged)'), onError: (e) => toast.error(e.message) })}>
            {save.isPending ? 'Saving…' : 'Save comp'}
          </Button>
        </div>
      )}
    </div>
  )
}
