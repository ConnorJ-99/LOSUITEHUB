import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CurrencyInput, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { db, unwrap } from '@/lib/api/client'
import { useAuth } from '@/lib/auth/context'

/**
 * Settings → MyHome (closed view Step C, Connor 2026-11-24): what a closed
 * file's MyHome offers under "Options for my home": the equity card, the
 * refinance card ("You may be able to save about $X/mo" from Refi Watch
 * pricing, shown only at or above the minimum) and Start something new.
 * All on until changed (`myhome_settings`, one row per company). Owners and admins change it.
 */
interface MyHomeSettings {
  equityCard: boolean
  refiCard: boolean
  startNew: boolean
  minMonthlySavings: number
}

const DEFAULTS: MyHomeSettings = { equityCard: true, refiCard: true, startNew: true, minMonthlySavings: 100 }

function useMyHomeSettings() {
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useQuery({
    queryKey: ['myhomeSettings'],
    enabled: !!orgId,
    retry: false,
    queryFn: async (): Promise<MyHomeSettings | null> => {
      const r = await db().from('myhome_settings').select('*').eq('organization_id', orgId!).maybeSingle()
      if (r.error) return null
      const x = r.data as Record<string, unknown> | null
      if (!x) return DEFAULTS
      return { equityCard: x.equity_card !== false, refiCard: x.refi_card !== false, startNew: x.start_new !== false, minMonthlySavings: Number(x.min_monthly_savings ?? 100) }
    },
  })
}

function useSaveMyHomeSettings() {
  const queryClient = useQueryClient()
  const { state } = useAuth()
  const orgId = state.status === 'signedIn' ? state.user.organizationId : null
  return useMutation({
    mutationFn: async (s: MyHomeSettings) => {
      const r = unwrap<{ organization_id: string }[]>(
        await db()
          .from('myhome_settings')
          .upsert({ organization_id: orgId, equity_card: s.equityCard, refi_card: s.refiCard, start_new: s.startNew, min_monthly_savings: s.minMonthlySavings })
          .select('organization_id'),
      )
      if (!r.length) throw new Error('Only owners and admins can change MyHome settings.')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['myhomeSettings'] }),
  })
}

export function MyHomeSettingsCard({ canEdit }: { canEdit: boolean }) {
  const settings = useMyHomeSettings()
  if (settings.isLoading) return null
  if (!settings.data)
    return (
      <Card title="MyHome">
        <p className="text-sm text-destructive">These settings turn on once the MyHome Step C database script has run.</p>
      </Card>
    )
  return <Form key={JSON.stringify(settings.data)} saved={settings.data} canEdit={canEdit} />
}

function Form({ saved, canEdit }: { saved: MyHomeSettings; canEdit: boolean }) {
  const save = useSaveMyHomeSettings()
  const [f, setF] = useState(saved)
  const dirty = JSON.stringify(f) !== JSON.stringify(saved)
  const problem = f.minMonthlySavings < 0 || f.minMonthlySavings > 10000 ? 'The minimum is between $0 and $10,000.' : null
  return (
    <Card
      title="MyHome"
      description="What a closed client's MyHome offers under Options for my home. Asks and new applications come to you as MyHome notices and on Today."
    >
      <ToggleChipGroup>
        <ToggleChip label="Equity card" pressed={f.equityCard} disabled={!canEdit} onChange={(equityCard) => setF({ ...f, equityCard })} />
        <ToggleChip label="Refinance card" pressed={f.refiCard} disabled={!canEdit} onChange={(refiCard) => setF({ ...f, refiCard })} />
        <ToggleChip label="Start something new" pressed={f.startNew} disabled={!canEdit} onChange={(startNew) => setF({ ...f, startNew })} />
      </ToggleChipGroup>
      <div className="mt-3 max-w-xs">
        <CurrencyInput
          label="Show refinance savings from"
          value={f.minMonthlySavings}
          onChange={(v) => setF({ ...f, minMonthlySavings: v ?? 0 })}
          readOnly={!canEdit}
          hint="A month. Below this, the card only offers “check my refinance options”. Savings come from Refi Watch pricing (conventional and FHA), never shown as a rate."
        />
      </div>
      {problem && <p className="mt-2 text-sm text-destructive">{problem}</p>}
      {canEdit && dirty && (
        <div className="mt-3 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setF(saved)}>
            Discard
          </Button>
          <Button size="sm" disabled={save.isPending || !!problem} onClick={() => save.mutate(f, { onSuccess: () => toast.success('MyHome settings saved'), onError: (e) => toast.error(e.message) })}>
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      )}
    </Card>
  )
}
