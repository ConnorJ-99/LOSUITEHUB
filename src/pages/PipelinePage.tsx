import { useState } from 'react'
import { KanbanIcon, ListIcon, PlusIcon, SearchXIcon, TriangleAlertIcon, UsersIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, PageHeader, SearchInput, Select } from '@/components/shared'
import { useNewLead } from '@/components/leads/new-lead-context'
import { PipelineBoard } from '@/components/pipeline/PipelineBoard'
import { PipelineList } from '@/components/pipeline/PipelineList'
import { useStageChanger } from '@/components/pipeline/useStageChanger'
import { useOrgMembers, usePipeline } from '@/lib/api/loans'
import { emptyFilters, isOnBoard, matchesFilters, type PipelineFilters } from '@/lib/pipeline/helpers'
import { PURPOSES, STAGES } from '@/lib/pipeline/stages'

type View = 'board' | 'list'
const VIEW_KEY = 'losuite.pipelineView'

function initialView(): View {
  try {
    const saved = localStorage.getItem(VIEW_KEY)
    if (saved === 'board' || saved === 'list') return saved
  } catch {
    // Storage unavailable: fall through to the screen-size default.
  }
  return window.matchMedia('(max-width: 767px)').matches ? 'list' : 'board'
}

function ViewToggle({ view, onChange }: { view: View; onChange: (view: View) => void }) {
  const option = (value: View, label: string, Icon: typeof KanbanIcon) => (
    <button
      type="button"
      aria-pressed={view === value}
      onClick={() => onChange(value)}
      className={cn(
        'inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
        view === value ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
      )}
    >
      <Icon className="size-3.5" />
      {label}
    </button>
  )
  return (
    <div className="inline-flex rounded-lg bg-muted p-0.5 ring-1 ring-border">
      {option('board', 'Board', KanbanIcon)}
      {option('list', 'List', ListIcon)}
    </div>
  )
}

export function PipelinePage() {
  const pipeline = usePipeline()
  const members = useOrgMembers()
  const { openNewLead } = useNewLead()
  const { requestChange, dialog } = useStageChanger()
  const [view, setView] = useState<View>(initialView)
  const [filters, setFilters] = useState<PipelineFilters>(emptyFilters)

  const changeView = (next: View) => {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {
      // Not remembered; harmless.
    }
  }
  const setFilter = <K extends keyof PipelineFilters>(key: K) => (value: PipelineFilters[K]) =>
    setFilters((f) => ({ ...f, [key]: value }))

  const showLo = (members.data?.length ?? 0) > 1
  const allLoans = pipeline.data ?? []
  const visible = allLoans.filter((loan) => {
    const searchable = { ...loan, assignedLoId: loan.assignedLo?.id ?? null }
    if (view === 'board') return isOnBoard(loan.stage, loan.stageChangedAt) && matchesFilters(searchable, { ...filters, stage: 'all' })
    return matchesFilters(searchable, filters)
  })

  const active = allLoans.filter((l) => l.stage !== 'closed' && l.stage !== 'lost' && l.stage !== 'nurture').length
  const filtersActive = JSON.stringify(filters) !== JSON.stringify(emptyFilters)

  return (
    <>
      <PageHeader
        title="Pipeline"
        description={pipeline.data ? `${active} active ${active === 1 ? 'loan' : 'loans'}` : undefined}
        action={
          <div className="flex items-center gap-2">
            <ViewToggle view={view} onChange={changeView} />
            <Button onClick={openNewLead}>
              <PlusIcon />
              New Lead
            </Button>
          </div>
        }
      />

      {pipeline.isLoading && <p className="py-12 text-center text-sm text-muted-foreground">Loading pipeline…</p>}

      {pipeline.isError && (
        <Card>
          <EmptyState
            icon={TriangleAlertIcon}
            title="Couldn't load the pipeline"
            description={pipeline.error.message}
            action={<Button variant="outline" onClick={() => pipeline.refetch()}>Try again</Button>}
          />
        </Card>
      )}

      {pipeline.isSuccess && allLoans.length === 0 && (
        <Card>
          <EmptyState
            icon={UsersIcon}
            title="No leads yet"
            description="Add your first lead and it will show up here in the Lead stage."
            action={<Button onClick={openNewLead}><PlusIcon />New Lead</Button>}
          />
        </Card>
      )}

      {pipeline.isSuccess && allLoans.length > 0 && (
        <>
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <SearchInput
              value={filters.search}
              onChange={setFilter('search')}
              placeholder="Name, phone, email or source"
              className="w-full sm:w-72"
            />
            <div className="w-full sm:w-44">
              <Select label="Purpose" value={filters.purpose} onChange={setFilter('purpose')} options={[{ value: 'all', label: 'All purposes' }, ...PURPOSES]} />
            </div>
            {view === 'list' && (
              <div className="w-full sm:w-48">
                <Select label="Stage" value={filters.stage} onChange={setFilter('stage')} options={[{ value: 'all', label: 'All stages' }, ...STAGES]} />
              </div>
            )}
            {showLo && (
              <div className="w-full sm:w-44">
                <Select
                  label="Assigned LO"
                  value={filters.assignedLoId}
                  onChange={setFilter('assignedLoId')}
                  options={[{ value: 'all', label: 'Everyone' }, ...(members.data ?? []).map((m) => ({ value: m.id, label: m.name }))]}
                />
              </div>
            )}
            {filtersActive && (
              <Button variant="ghost" size="sm" onClick={() => setFilters(emptyFilters)}>
                Clear filters
              </Button>
            )}
          </div>

          {view === 'board' ? (
            <PipelineBoard loans={visible} showLo={showLo} onRequestChange={requestChange} />
          ) : visible.length === 0 ? (
            <Card>
              <EmptyState icon={SearchXIcon} title="No loans match" description="Try a different search or clear the filters." />
            </Card>
          ) : (
            <Card contentClassName="px-0 md:px-(--card-spacing)">
              <PipelineList loans={visible} showLo={showLo} onRequestChange={requestChange} />
            </Card>
          )}
        </>
      )}

      {dialog}
    </>
  )
}
