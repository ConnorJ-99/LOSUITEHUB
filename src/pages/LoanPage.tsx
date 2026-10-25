import { useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { ArrowLeftIcon, ChevronDownIcon, PencilIcon, SearchXIcon, TriangleAlertIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Card, EmptyState, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/shared'
import { EditLeadDialog } from '@/components/leads/EditLeadDialog'
import { StageMenu } from '@/components/pipeline/StageMenu'
import { useStageChanger } from '@/components/pipeline/useStageChanger'
import { NotesTab } from '@/components/profile/NotesTab'
import { OverviewTab } from '@/components/profile/OverviewTab'
import { PropertiesTab } from '@/components/profile/PropertiesTab'
import { IncomeTab } from '@/components/income/IncomeTab'
import { PrequalTab } from '@/components/prequal/PrequalTab'
import { UrlaTab } from '@/components/urla/UrlaTab'
import { useLoan } from '@/lib/api/loans'
import { daysSince, formatDaysInStage, fullName } from '@/lib/pipeline/helpers'
import { purposeLabel, stageLabel } from '@/lib/pipeline/stages'

const TABS = ['overview', 'prequal', 'notes', 'properties', '1003', 'income'] as const
type Tab = (typeof TABS)[number]

/** Tabs planned for later phases, shown greyed out so the layout is clear. */
const LATER_TABS = [
  { label: 'Documents', phase: 'Phase 6' },
  { label: 'Loan Info', phase: 'Phase 5' },
]

/** The borrower profile for one loan. Its layout adapts to the loan purpose. */
export function LoanPage() {
  const { loanId = '' } = useParams()
  const [searchParams, setSearchParams] = useSearchParams()
  const loan = useLoan(loanId)
  const { requestChange, dialog } = useStageChanger()
  const [editing, setEditing] = useState(false)

  const tabParam = searchParams.get('tab')
  const tab: Tab = (TABS as readonly string[]).includes(tabParam ?? '') ? (tabParam as Tab) : 'overview'
  const goToTab = (next: Tab) => setSearchParams(next === 'overview' ? {} : { tab: next }, { replace: true })

  if (loan.isLoading) return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
  if (loan.isError) {
    return (
      <Card>
        <EmptyState icon={TriangleAlertIcon} title="Couldn't load this record" description={loan.error.message} />
      </Card>
    )
  }
  if (!loan.data) {
    return (
      <Card>
        <EmptyState
          icon={SearchXIcon}
          title="Record not found"
          description="It may have been deleted, or it isn't assigned to you."
          action={<Button variant="outline" asChild><Link to="/pipeline">Back to pipeline</Link></Button>}
        />
      </Card>
    )
  }

  const data = loan.data
  const name = fullName(data.borrower)
  // Remount the Overview form after its saved values change, so it shows what was saved.
  const { subjectPropertyId, ...savedDetails } = data.details
  void subjectPropertyId

  return (
    <>
      <Link to="/pipeline" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon className="size-4" />
        Pipeline
      </Link>

      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {purposeLabel(data.purpose)} · {formatDaysInStage(daysSince(data.stageChangedAt))} in {stageLabel(data.stage)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setEditing(true)}>
            <PencilIcon />
            Edit
          </Button>
          <StageMenu stage={data.stage} onSelect={(stage) => requestChange({ id: data.id, stage: data.stage, borrowerName: name }, stage)}>
            <Button>
              {stageLabel(data.stage)}
              <ChevronDownIcon />
            </Button>
          </StageMenu>
        </div>
      </div>

      {data.stage === 'lost' && data.lostReason && (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm">
          <span className="font-medium">Lost:</span> {data.lostReason}
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => goToTab(v as Tab)}>
        <div className="-mx-4 mb-4 overflow-x-auto px-4 md:mx-0 md:px-0">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="prequal">Prequal</TabsTrigger>
            <TabsTrigger value="notes">Notes</TabsTrigger>
            <TabsTrigger value="properties">Properties</TabsTrigger>
            <TabsTrigger value="1003">1003</TabsTrigger>
            <TabsTrigger value="income">Income</TabsTrigger>
            {LATER_TABS.map((t) => (
              <Tooltip key={t.label}>
                <TooltipTrigger asChild>
                  <span tabIndex={0} className="cursor-not-allowed px-2.5 text-sm text-muted-foreground/60">
                    {t.label}
                  </span>
                </TooltipTrigger>
                <TooltipContent>Coming in {t.phase}</TooltipContent>
              </Tooltip>
            ))}
          </TabsList>
        </div>
        <TabsContent value="overview">
          <OverviewTab key={JSON.stringify(savedDetails)} loan={data} onGoToTab={goToTab} />
        </TabsContent>
        <TabsContent value="prequal">
          <PrequalTab loan={data} />
        </TabsContent>
        <TabsContent value="notes">
          <NotesTab loan={data} />
        </TabsContent>
        <TabsContent value="properties">
          <PropertiesTab loan={data} />
        </TabsContent>
        <TabsContent value="1003">
          <UrlaTab loan={data} />
        </TabsContent>
        <TabsContent value="income">
          <IncomeTab loan={data} />
        </TabsContent>
      </Tabs>

      {editing && <EditLeadDialog loan={data} open={editing} onOpenChange={setEditing} />}
      {dialog}
    </>
  )
}
