import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, FormGrid, NumberInput, PercentInput, Select } from '@/components/shared'
import { DEFAULT_COMP, useCompSettings, useCompSettingsLog, useMemberCompTypes, useSaveCompSettings, useSetMemberCompType, type CompSettings } from '@/lib/api/compSettings'
import { useOrgMembers } from '@/lib/api/loans'

const BASE = [
  { value: 'revenue' as const, label: 'Company revenue on the loan' },
  { value: 'loan_bps' as const, label: 'Loan amount × bps' },
]
const COMP_TYPE = [
  { value: 'commission' as const, label: 'Commission' },
  { value: 'salary' as const, label: 'Salary-only (all to company)' },
]

/**
 * Settings → Compensation (owners and admins): what an LO's split applies to,
 * the company- and self-generated splits, and each person's comp type. A loan
 * keeps the settings in effect when it was marked Closed. Every change is logged.
 */
export function CompensationCard() {
  const settings = useCompSettings()
  if (settings.isLoading) return null
  if (settings.isError) return <Card title="Compensation"><p className="text-sm text-destructive">Compensation turns on once the comp settings database script has run.</p></Card>
  return <CompensationForm key={JSON.stringify(settings.data)} saved={settings.data ?? DEFAULT_COMP} />
}

function CompensationForm({ saved }: { saved: CompSettings }) {
  const save = useSaveCompSettings()
  const members = useOrgMembers()
  const compTypes = useMemberCompTypes()
  const setType = useSetMemberCompType()
  const log = useCompSettingsLog()
  const [form, setForm] = useState(saved)
  const [showLog, setShowLog] = useState(false)
  const set = (patch: Partial<CompSettings>) => setForm((f) => ({ ...f, ...patch }))
  const dirty = JSON.stringify(form) !== JSON.stringify(saved)

  return (
    <Card title="Compensation" description="Loan officer splits. A loan keeps the settings in effect when it was marked Closed, so changes here never rewrite closed loans. Every change is logged.">
      <FormGrid className="lg:grid-cols-4">
        <Select label="Comp base (what the split applies to)" value={form.baseMode} options={BASE} onChange={(baseMode) => set({ baseMode })} span={2} />
        {form.baseMode === 'loan_bps' && <NumberInput label="Basis points" value={form.baseBps} onChange={(baseBps) => set({ baseBps })} hint="100 bps = 1% of the loan amount" />}
        <PercentInput label="Company-generated lead split" value={form.companySplitPct} onChange={(v) => set({ companySplitPct: v ?? 0 })} hint="Website forms and Pages" />
        <PercentInput label="Self-generated lead split" value={form.selfSplitPct} onChange={(v) => set({ selfSplitPct: v ?? 0 })} />
      </FormGrid>
      {dirty && (
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => setForm(saved)}>
            Discard
          </Button>
          <Button
            size="sm"
            disabled={save.isPending || (form.baseMode === 'loan_bps' && !form.baseBps)}
            onClick={() => save.mutate(form, { onSuccess: () => toast.success('Compensation saved'), onError: (e) => toast.error(e.message) })}
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}

      <div className="mt-4 border-t pt-3">
        <p className="mb-2 text-sm font-medium">Comp type by team member</p>
        <ul className="divide-y">
          {(members.data ?? []).map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
              <span>{m.name}</span>
              <div className="w-60">
                <Select
                  label={`Comp type for ${m.name}`}
                  value={compTypes.data?.get(m.id) ?? 'commission'}
                  options={COMP_TYPE}
                  onChange={(compType) => setType.mutate({ userId: m.id, compType }, { onSuccess: () => toast.success(`${m.name}: ${compType === 'salary' ? 'salary-only' : 'commission'}`), onError: (e) => toast.error(e.message) })}
                />
              </div>
            </li>
          ))}
        </ul>
      </div>

      {(log.data?.length ?? 0) > 0 && (
        <div className="mt-3">
          <button type="button" className="text-xs text-muted-foreground hover:text-foreground" onClick={() => setShowLog((v) => !v)}>
            {showLog ? 'Hide' : 'Show'} change history
          </button>
          {showLog && (
            <ul className="mt-2 divide-y rounded-md border text-xs">
              {log.data!.map((c) => (
                <li key={c.id} className="px-3 py-1.5">
                  <span className="font-medium">{c.what}</span>: {c.old_value ?? 'blank'} → {c.new_value ?? 'blank'}
                  <span className="text-muted-foreground"> · {c.by ? c.by.full_name || c.by.email : 'system'} · {new Date(c.changed_at).toLocaleString('en-US', { timeZone: 'America/Chicago' })}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  )
}
