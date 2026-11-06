import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Card, confirmAction, FormGrid, Input, NumberInput, PercentInput, Select, ToggleChip } from '@/components/shared'
import { useDeleteScenario, useRefiBenchmarks, useRefiScenarios, useSaveScenario, type ScenarioDraft } from '@/lib/api/refiWatch'
import { formatPoints, latestByScenario, orderScenarios, PROGRAM_OPTIONS, PURPOSE_OPTIONS, scenarioError, scenarioLabel, type RefiProgram, type RefiPurpose } from '@/lib/refi/benchmarks'

function ScenarioDialog({ initial, onClose }: { initial: ScenarioDraft; onClose: () => void }) {
  const [s, setS] = useState(initial)
  const save = useSaveScenario()
  const error = scenarioError(s)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{s.id ? 'Edit scenario' : 'New scenario'}</DialogTitle>
          <DialogDescription>Closed loans are matched to the nearest FICO at or below theirs and the nearest LTV at or above theirs, in the same program.</DialogDescription>
        </DialogHeader>
        <FormGrid className="lg:grid-cols-2">
          <Input label="Name" value={s.name} onChange={(name) => setS({ ...s, name })} required span={2} placeholder="e.g. Conventional R/T" />
          <Select label="Program" value={s.program} onChange={(program: RefiProgram) => setS({ ...s, program, purpose: program === 'conventional' ? 'rate_term' : s.purpose })} options={PROGRAM_OPTIONS} required />
          <Select label="Purpose" value={s.purpose} onChange={(purpose: RefiPurpose) => setS({ ...s, purpose })} options={s.program === 'fha' ? PURPOSE_OPTIONS : PURPOSE_OPTIONS.filter((p) => p.value === 'rate_term')} required />
          <NumberInput label="FICO" value={s.fico} onChange={(fico) => setS({ ...s, fico: fico ?? 0 })} maxDecimals={0} required />
          {s.purpose === 'rate_term' ? <PercentInput label="LTV" value={s.ltv} onChange={(ltv) => setS({ ...s, ltv })} maxDecimals={2} required /> : <Input label="LTV" value="— (no appraisal)" readOnly />}
          <NumberInput label="Order on the pricing screen" value={s.sortOrder} onChange={(n) => setS({ ...s, sortOrder: n ?? 0 })} maxDecimals={0} />
        </FormGrid>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!!error || save.isPending}
            onClick={() =>
              save.mutate(s, {
                onSuccess: () => {
                  toast.success('Scenario saved')
                  onClose()
                },
                onError: (e) => toast.error(e.message),
              })
            }
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Settings › Refi Watch: the benchmark scenarios an admin prices Mon/Wed/Fri. */
export function RefiScenariosCard({ canEdit }: { canEdit: boolean }) {
  const scenarios = useRefiScenarios()
  const benchmarks = useRefiBenchmarks()
  const saveScenario = useSaveScenario()
  const remove = useDeleteScenario()
  const [editing, setEditing] = useState<ScenarioDraft | null>(null)
  const list = orderScenarios(scenarios.data ?? [], false)
  const latest = latestByScenario(benchmarks.data ?? [])
  const nextOrder = list.reduce((max, s) => Math.max(max, s.sortOrder), 0) + 1
  const { hash } = useLocation()
  const loaded = scenarios.isSuccess

  // "Settings › Refi Watch" links land on this card once the page has drawn it.
  useEffect(() => {
    if (hash === '#refi-watch' && loaded) document.getElementById('refi-watch')?.scrollIntoView({ block: 'start' })
  }, [hash, loaded])

  return (
    <div id="refi-watch" className="scroll-mt-4">
      <Card
        title="Refi Watch"
        description="Benchmark scenarios an admin prices Mon, Wed and Fri at 8:00 AM Central. Closed loans are screened against them. The one marked MIP removal is what FHA loans at 80% LTV or less are compared to."
        action={
          canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" asChild>
                <Link to="/refi-watch/benchmarks">Price now</Link>
              </Button>
              <Button size="sm" variant="outline" onClick={() => setEditing({ id: null, name: '', program: 'conventional', purpose: 'rate_term', fico: 720, ltv: 80, active: true, sortOrder: nextOrder })}>
                <PlusIcon />
                Scenario
              </Button>
            </div>
          )
        }
      >
        {scenarios.isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : scenarios.isError ? (
          <p className="text-sm text-destructive">{scenarios.error.message}</p>
        ) : list.length === 0 ? (
          <p className="text-sm text-muted-foreground">No scenarios yet.</p>
        ) : (
          <ul className="divide-y">
            {list.map((s) => {
              const last = latest.get(s.id)
              return (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                      <span className={s.active ? undefined : 'text-muted-foreground line-through'}>{s.name}</span>
                      {s.mipRemoval && <span className="rounded-md bg-nurture/10 px-1.5 py-0.5 text-xs font-semibold text-nurture">MIP removal</span>}
                    </p>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {scenarioLabel(s)}
                      {last ? ` · last ${last.rate.toFixed(3)}% · ${formatPoints(last.pointsOrCredit)}` : ' · not priced yet'}
                    </p>
                  </div>
                  {canEdit && (
                    <div className="flex shrink-0 items-center gap-1">
                      <ToggleChip
                        label={s.active ? 'On' : 'Off'}
                        pressed={s.active}
                        disabled={saveScenario.isPending}
                        onChange={(active) => saveScenario.mutate({ ...s, active }, { onError: (e) => toast.error(e.message) })}
                      />
                      <Button size="xs" variant="ghost" onClick={() => setEditing(s)}>
                        Edit
                      </Button>
                      {!last && (
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={remove.isPending}
                          onClick={async () => {
                            if (!(await confirmAction(`Delete the scenario "${scenarioLabel(s)}"?`, { confirmLabel: 'Delete', destructive: true }))) return
                            remove.mutate(s.id, { onSuccess: () => toast.success('Scenario deleted'), onError: (e) => toast.error(e.message) })
                          }}
                        >
                          Delete
                        </Button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {editing && <ScenarioDialog key={editing.id ?? 'new'} initial={editing} onClose={() => setEditing(null)} />}
      </Card>
    </div>
  )
}
