import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { ChevronDownIcon, CopyIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Card, EmptyState, confirmAction } from '@/components/shared'
import { copyScenario, useCreateScenario, useDeleteScenario, useFeeTemplates, usePricingScenarios } from '@/lib/api/pricing'
import { useProperties } from '@/lib/api/properties'
import type { LoanProfile, Property } from '@/lib/api/types'
import { useApplication } from '@/lib/api/urla'
import { useQueryClient } from '@tanstack/react-query'
import { keys } from '@/lib/api/client'
import { scenarioFrom, scenarioName } from '@/lib/pricing/scenario'
import { ScenarioEditor } from './ScenarioEditor'

/** Fees: saved scenarios for this file, each with its payment, fees A–H and cash to close. */
export function PricingTab({ loan }: { loan: LoanProfile }) {
  const scenarios = usePricingScenarios(loan.id)
  const properties = useProperties(loan.id)
  const templates = useFeeTemplates()
  const app = useApplication(loan.id)
  const create = useCreateScenario(loan.id, loan.organizationId)
  const remove = useDeleteScenario(loan.id)
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [copying, setCopying] = useState(false)

  if (scenarios.isLoading || properties.isLoading || templates.isLoading || app.isLoading) return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
  const error = scenarios.error ?? properties.error ?? app.error
  if (error) return <p className="py-12 text-center text-sm text-destructive">{error.message.includes('pricing_scenarios') ? 'Run the pricing script in Supabase to use Pricing.' : error.message}</p>

  const list = scenarios.data ?? []
  const homes = properties.data ?? []
  const pick = (id: string | null) =>
    setSearchParams(
      (p) => {
        const next = new URLSearchParams(p)
        if (id) next.set('scenario', id)
        else next.delete('scenario')
        return next
      },
      { replace: true },
    )
  const wanted = searchParams.get('scenario')
  const selected = list.find((s) => s.id === wanted) ?? list.find((s) => s.id === loan.details.pricingScenarioId) ?? list.at(-1) ?? null

  const start = (property: Property | null) =>
    create.mutate(scenarioFrom(loan, property, scenarioName(property, list.length)), {
      onSuccess: (s) => {
        pick(s.id)
        toast.success(`Started "${s.name}"`)
      },
      onError: (e) => toast.error(e.message),
    })
  const copy = async () => {
    if (!selected) return
    setCopying(true)
    try {
      const s = await copyScenario(selected, `${selected.name} (copy)`, loan.organizationId)
      await queryClient.invalidateQueries({ queryKey: keys.pricingScenarios(loan.id) })
      pick(s.id)
      toast.success('Copied')
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setCopying(false)
    }
  }
  const del = async () => {
    if (!selected || !(await confirmAction(`Delete "${selected.name}" and its fee changes?`, { confirmLabel: 'Delete', destructive: true }))) return
    remove.mutate(selected.id, { onSuccess: () => (pick(null), toast.success('Deleted')), onError: (e) => toast.error(e.message) })
  }

  const newMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant={list.length ? 'outline' : 'default'} disabled={create.isPending}>
          <PlusIcon />
          New scenario
          <ChevronDownIcon />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => start(homes.find((h) => h.id === loan.details.subjectPropertyId) ?? null)}>From this loan</DropdownMenuItem>
        {homes.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs text-muted-foreground">From a property</DropdownMenuLabel>
            {homes.map((h) => (
              <DropdownMenuItem key={h.id} onSelect={() => start(h)}>
                {h.addressLine}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  if (!selected) {
    return (
      <Card>
        <EmptyState title="No fee worksheet yet" description="Start a scenario from this loan's numbers, or from one of its properties. Each one has its own payment, fees A–H and cash to close, and you can save as many as you like." action={newMenu} />
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {list.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => pick(s.id)}
              className={cn('rounded-full border px-3 py-1 text-sm transition-colors', s.id === selected.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-card hover:bg-muted')}
            >
              {s.name}
              {s.lenderName && <span className={cn('ml-1.5 text-xs', s.id === selected.id ? 'text-primary-foreground/80' : 'text-muted-foreground')}>{s.lenderName}</span>}
              {s.id === loan.details.pricingScenarioId && <span className="ml-1.5 text-xs">✓</span>}
            </button>
          ))}
        </div>
        <Button size="sm" variant="ghost" onClick={copy} disabled={copying}>
          <CopyIcon />
          Copy
        </Button>
        <Button size="sm" variant="ghost" onClick={del} disabled={remove.isPending}>
          <Trash2Icon />
          Delete
        </Button>
        {newMenu}
      </div>
      <ScenarioEditor
        key={JSON.stringify(selected)}
        loan={loan}
        scenario={selected}
        properties={homes}
        templates={templates.data ?? []}
        earnestMoney={(app.data?.assets ?? []).filter((a) => a.assetType === 'earnest_money').reduce((sum, a) => sum + a.amount, 0)}
        borrowerNames={(app.data?.borrowers ?? []).map((b) => `${b.person.firstName} ${b.person.lastName}`)}
      />
    </div>
  )
}
