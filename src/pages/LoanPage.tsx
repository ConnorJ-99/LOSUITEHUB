import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import {
  BadgeDollarSignIcon,
  ChevronDownIcon,
  FileSignatureIcon,
  FileTextIcon,
  FolderIcon,
  HomeIcon,
  LandmarkIcon,
  MailIcon,
  NotebookPenIcon,
  PencilIcon,
  ReceiptIcon,
  SearchXIcon,
  StarIcon,
  Trash2Icon,
  TriangleAlertIcon,
  UserCheckIcon,
  WorkflowIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, EmptyState, FormGrid, Input, confirmAction } from '@/components/shared'
import { ClosedLoanCard } from '@/components/closed/ClosedLoanCard'
import { ContractTab } from '@/components/contract/ContractTab'
import { DocumentsTab } from '@/components/documents/DocumentsTab'
import { EditLeadDialog } from '@/components/leads/EditLeadDialog'
import { FileHeader, FileNav, MetricStrip, MilestoneStepper, TeamRow, type FileNavItem, type TeamMember } from '@/components/loanfile'
import { MissingFieldsDialog } from '@/components/loanfile/MissingFieldsDialog'
import { UrlaChecklistPanel } from '@/components/loanfile/UrlaChecklistPanel'
import { WorkflowPanel } from '@/components/loanfile/WorkflowPanel'
import { StageMenu } from '@/components/pipeline/StageMenu'
import { useStageChanger } from '@/components/pipeline/useStageChanger'
import { NotesTab } from '@/components/profile/NotesTab'
import { OverviewTab } from '@/components/profile/OverviewTab'
import { TasksCard } from '@/components/profile/TasksCard'
import { PropertiesTab } from '@/components/profile/PropertiesTab'
import { IncomeTab } from '@/components/income/IncomeTab'
import { PrequalTab } from '@/components/prequal/PrequalTab'
import { EditDialog } from '@/components/urla/parts'
import { UrlaTab } from '@/components/urla/UrlaTab'
import { useLoanFile, useSaveTeamMember, useSetLoanOfficer, useStepTemplates, type TeamRole } from '@/lib/api/loanfile'
import { LoanPricingTab } from '@/components/pricing/LoanPricingTab'
import { PricingTab } from '@/components/pricing/PricingTab'
import { LettersTab } from '@/components/letters/LettersTab'
import { usePreapprovalLetters } from '@/lib/api/preapproval'
import { useDeleteLead } from '@/lib/api/closed'
import { useLoan, useOrgMembers, useSetPriority } from '@/lib/api/loans'
import { useProperties } from '@/lib/api/properties'
import { useOrganization, useProfile } from '@/lib/api/settings'
import type { LoanProfile } from '@/lib/api/types'
import { useApplication } from '@/lib/api/urla'
import { formatIsoDate, relativeTime, todayIso } from '@/lib/dates'
import { headerMetrics, qualifyingScore } from '@/lib/loanfile/metrics'
import { validateApplication } from '@/lib/loanfile/urla'
import { buildWorkflow, daysWaiting, milestoneView, OWNER_LABEL } from '@/lib/loanfile/workflow'
import { fullName } from '@/lib/pipeline/helpers'
import { purposeLabel, stageLabel } from '@/lib/pipeline/stages'
import { pipelineFor, pipelineInfo } from '@/lib/pipeline/pipelines'
import { applicationSummary } from '@/lib/urla/summary'
import { useAuth } from '@/lib/auth/context'

const SECTIONS = ['overview', 'prequal', '1003', 'income', 'contract', 'fees', 'documents', 'notes', 'loan', 'properties', 'letters'] as const
type Section = (typeof SECTIONS)[number]
const READY: Section[] = ['overview', 'prequal', '1003', 'income', 'contract', 'fees', 'documents', 'notes', 'loan', 'properties', 'letters']
/** A closed file's profile: the closed loan (Overview), its 1003, the home, documents and notes. */
const CLOSED_SECTIONS: Section[] = ['overview', '1003', 'properties', 'documents', 'notes']

/** Team roles shown in the header, in order. The loan officer is the file's Assigned LO. */
const TEAM: { role: TeamRole | 'loan_officer'; label: string; group: string; purchaseOnly?: boolean; company?: boolean }[] = [
  { role: 'loan_officer', label: 'Loan Officer', group: 'Broker' },
  { role: 'processor', label: 'Processor', group: 'Broker' },
  { role: 'lender_ae', label: 'Account Exec', group: 'Lender', company: true },
  { role: 'title', label: 'Title', group: 'Contract', company: true },
  { role: 'buyer_agent', label: "Buyer's agent", group: 'Contract', purchaseOnly: true, company: true },
  { role: 'listing_agent', label: 'Listing agent', group: 'Contract', purchaseOnly: true, company: true },
]

/** The borrower's loan file. Loads the record, then hands off to the workspace. */
export function LoanPage() {
  const { loanId = '' } = useParams()
  const loan = useLoan(loanId)

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
  return <LoanFileWorkspace loan={loan.data} />
}

/** Sticky header (metrics, milestones, team), left file navigation, and the chosen section. */
function LoanFileWorkspace({ loan }: { loan: LoanProfile }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const app = useApplication(loan.id)
  const properties = useProperties(loan.id)
  const setPriority = useSetPriority(loan.id)
  const letters = usePreapprovalLetters(loan.id, loan.purpose === 'purchase')
  const organization = useOrganization()
  const originator = useProfile(loan.assignedLo?.id)
  const templates = useStepTemplates()
  const file = useLoanFile(loan.id)
  const members = useOrgMembers()
  const setLo = useSetLoanOfficer(loan.id)
  const saveTeam = useSaveTeamMember(loan.id, loan.organizationId)
  const { requestChange, dialog } = useStageChanger()
  const { state } = useAuth()
  const navigate = useNavigate()
  const deleteLead = useDeleteLead()
  // Processors work files but don't delete them; the database checks the rest.
  const canDelete = state.status === 'signedIn' && state.user.role !== null && state.user.role !== 'processor'
  const [editing, setEditing] = useState(false)
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [completing, setCompleting] = useState(false)
  const [teamEdit, setTeamEdit] = useState<{ role: TeamRole; label: string; name: string; company: string; withCompany: boolean } | null>(null)

  const isPurchase = loan.purpose === 'purchase'
  const param = searchParams.get('tab') as Section | null
  const closedFile = loan.stage === 'closed'
  const section: Section = param && READY.includes(param) && ((param !== 'contract' && param !== 'letters') || isPurchase) && (!closedFile || CLOSED_SECTIONS.includes(param)) ? param : 'overview'
  const goTo = (next: string) => setSearchParams(next === 'overview' ? {} : { tab: next }, { replace: true })

  const name = fullName(loan.borrower)
  // The back link returns to the board this file shows on (Purchase, In Process, Nurture...).
  const home = pipelineFor(loan)
  const today = todayIso()
  const ready = app.data && properties.data
  const summary = ready ? applicationSummary(loan, app.data!, properties.data) : null
  const validation = ready ? validateApplication({ loan, app: app.data!, properties: properties.data!, organization: organization.data ?? null, originator: originator.data ?? null }) : null
  const creditScore = app.data ? qualifyingScore(app.data.borrowers.map((b) => b.estimatedCreditScore)) : null
  const stageSince = loan.stageChangedAt.slice(0, 10)
  const workflow =
    summary && validation && templates.data && file.data
      ? buildWorkflow(templates.data, file.data.marks, {
          purpose: loan.purpose,
          prequalReady: creditScore !== null && summary.qualifying.totalIncome > 0 && summary.housing !== null,
          urlaMissing: validation.totalMissing,
          urlaStarted: validation.sections.some((s) => s.started),
          hasContract: loan.details.contractDate !== null,
          hasLoanAmount: loan.details.loanAmount !== null,
          hasRate: loan.details.noteRate !== null,
          hasProgram: loan.details.programId !== null,
          hasPreapprovalLetter: letters.data ? letters.data.length > 0 : undefined,
          stageSince,
        })
      : null
  const days = file.data ? daysWaiting(file.data.marks, stageSince, today) : 0
  const next = workflow?.next

  const memberName = (id: string | null) => members.data?.find((m) => m.id === id)?.name ?? null
  const team: TeamMember[] = TEAM.filter((t) => !t.purchaseOnly || isPurchase).map((t) => {
    if (t.role === 'loan_officer') return { group: t.group, role: t.label, name: loan.assignedLo?.name ?? null, options: members.data?.map((m) => m.name) }
    const record = file.data?.team.find((r) => r.role === t.role)
    const shown = record ? (memberName(record.profileId) ?? [record.name, record.company && `(${record.company})`].filter(Boolean).join(' ')) : null
    return { group: t.group, role: t.label, name: shown || null, options: t.role === 'processor' ? members.data?.map((m) => m.name) : undefined, allowCustom: true }
  })
  const roleFor = (label: string) => TEAM.find((t) => t.label === label)!
  const assign = (label: string, picked: string | null) => {
    const t = roleFor(label)
    const memberId = picked ? (members.data?.find((m) => m.name === picked)?.id ?? null) : null
    const done = { onSuccess: () => toast.success(picked ? `${label}: ${picked}` : `${label} unassigned`), onError: (e: Error) => toast.error(e.message) }
    if (t.role === 'loan_officer') setLo.mutate(memberId, done)
    else saveTeam.mutate({ role: t.role, member: picked ? { profileId: memberId, name: memberId ? null : picked } : null }, done)
  }
  const custom = (label: string) => {
    const t = roleFor(label)
    if (t.role === 'loan_officer') return
    const record = file.data?.team.find((r) => r.role === t.role)
    setTeamEdit({ role: t.role, label, name: record?.name ?? '', company: record?.company ?? '', withCompany: !!t.company })
  }

  const allNav: FileNavItem[] = [
    { id: 'overview', label: 'Overview', icon: WorkflowIcon },
    { id: 'prequal', label: 'Prequal', icon: UserCheckIcon },
    { id: '1003', label: '1003', icon: FileTextIcon, marker: validation ? (validation.totalMissing ? { type: 'count', value: validation.totalMissing } : { type: 'complete' }) : undefined },
    { id: 'income', label: 'Income', icon: BadgeDollarSignIcon },
    ...(isPurchase ? [{ id: 'contract', label: 'Contract', icon: FileSignatureIcon }] : []),
    { id: 'fees', label: 'Fees', icon: ReceiptIcon },
    { id: 'documents', label: 'Documents', icon: FolderIcon },
    { id: 'notes', label: 'Notes', icon: NotebookPenIcon },
    { id: 'loan', label: 'Loan · Pricing', icon: LandmarkIcon },
    { id: 'properties', label: 'Properties', icon: HomeIcon },
    ...(isPurchase ? [{ id: 'letters', label: 'Letters', icon: MailIcon }] : []),
  ]
  const nav = closedFile
    ? CLOSED_SECTIONS.map((id) => allNav.find((n) => n.id === id)!).map((n) => (n.id === 'properties' ? { ...n, label: 'Property' } : { ...n, marker: undefined }))
    : allNav

  // Remount the Overview form after its saved values change, so it shows what was saved.
  const { subjectPropertyId, ...savedDetails } = loan.details
  void subjectPropertyId

  return (
    <>
      <FileHeader
        borrowerName={name}
        backTo={closedFile ? '/contacts?tab=closed' : home ? `/pipeline/${home}` : '/pipeline'}
        backLabel={closedFile ? 'Closed loans' : home ? pipelineInfo(home).label : 'Pipeline'}
        fileNumber={loan.details.ariveLoanNumber}
        statusLabel={`${purposeLabel(loan.purpose)} · ${stageLabel(loan.stage)}`}
        nextStep={next && !closedFile ? `${next.name} · ${OWNER_LABEL[next.owner]} · ${days}d` : null}
        updatedLabel={`In ${stageLabel(loan.stage)} since ${formatIsoDate(stageSince)} (${relativeTime(loan.stageChangedAt)})`}
        detailsOpen={detailsOpen}
        onToggleDetails={() => setDetailsOpen((o) => !o)}
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              aria-pressed={loan.priority}
              disabled={setPriority.isPending}
              onClick={() => setPriority.mutate(!loan.priority, { onError: (e) => toast.error(e.message) })}
              title={loan.priority ? 'Remove from Priority Leads' : 'Add to Priority Leads'}
            >
              <StarIcon className={loan.priority ? 'fill-amber-400 text-amber-500' : undefined} />
              {loan.priority ? 'Priority' : 'Star'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setEditing(true)}>
              <PencilIcon />
              Edit
            </Button>
            {canDelete && (
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive"
                disabled={deleteLead.isPending}
                title="Delete this file"
                onClick={async () => {
                  const ok = await confirmAction(
                    `Delete ${name}'s ${purposeLabel(loan.purpose)} file, with its tasks, documents and 1003? People on it who have no other file are deleted too, with their notes. This can't be undone.`,
                    { confirmLabel: 'Delete file', destructive: true },
                  )
                  if (!ok) return
                  deleteLead.mutate(
                    { loanId: loan.id, organizationId: loan.organizationId },
                    {
                      onSuccess: () => {
                        toast.success(`${name}'s file deleted`)
                        navigate(home ? `/pipeline/${home}` : '/pipeline')
                      },
                      onError: (e) => toast.error(e.message),
                    },
                  )
                }}
              >
                <Trash2Icon />
                Delete
              </Button>
            )}
            <StageMenu stage={loan.stage} onSelect={(stage) => requestChange({ id: loan.id, stage: loan.stage, borrowerName: name }, stage)}>
              <Button size="sm">
                Change status
                <ChevronDownIcon />
              </Button>
            </StageMenu>
          </>
        }
        notice={
          loan.stage === 'lost' && loan.lostReason ? (
            <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-sm">
              <span className="font-medium">Lost:</span> {loan.lostReason}
            </div>
          ) : null
        }
      >
        {summary && <MetricStrip metrics={headerMetrics(loan, summary, creditScore)} />}
        {file.data && !closedFile && (
          <MilestoneStepper
            milestones={milestoneView(file.data.milestones).map((m) => ({ label: m.label, state: m.state, date: m.date ? formatIsoDate(m.date) : null }))}
            band={loan.stage === 'closed' ? 'Loan closed' : loan.stage === 'lost' ? 'Loan lost' : `Loan open · ${stageLabel(loan.stage)}`}
          />
        )}
        <TeamRow members={team} onAssign={assign} onCustom={custom} />
      </FileHeader>

      <div className="mt-4 flex flex-col gap-4 md:flex-row md:gap-6">
        <FileNav items={nav} active={section} onSelect={goTo} collapsed={navCollapsed} onToggleCollapsed={() => setNavCollapsed((c) => !c)} />
        <div className="min-w-0 flex-1 space-y-4">
          {section === 'overview' && (
            <>
              {closedFile && (
                <>
                  <ClosedLoanCard loan={loan} />
                  <TasksCard loanId={loan.id} organizationId={loan.organizationId} />
                </>
              )}
              {!closedFile && (workflow ? (
                <WorkflowPanel workflow={workflow} loanId={loan.id} organizationId={loan.organizationId} days={days} onOpenSection={goTo} onCompleteFields={() => setCompleting(true)} />
              ) : templates.isError || file.isError ? (
                <p className="text-sm text-destructive">{(templates.error ?? file.error)?.message}</p>
              ) : (
                <p className="text-sm text-muted-foreground">Loading workflow…</p>
              ))}
              {!closedFile && <OverviewTab key={JSON.stringify(savedDetails)} loan={loan} onGoToTab={goTo} />}
            </>
          )}
          {section === 'prequal' && <PrequalTab loan={loan} />}
          {section === '1003' && (
            <>
              {validation && <UrlaChecklistPanel validation={validation} borrowerCount={app.data?.borrowers.length ?? 1} onCompleteFields={() => setCompleting(true)} />}
              <UrlaTab loan={loan} />
            </>
          )}
          {section === 'income' && <IncomeTab loan={loan} />}
          {section === 'contract' && <ContractTab loan={loan} />}
          {section === 'fees' && <PricingTab loan={loan} />}
          {section === 'loan' && <LoanPricingTab loan={loan} />}
          {section === 'letters' && isPurchase && <LettersTab loan={loan} />}
          {section === 'documents' && <DocumentsTab loan={loan} />}
          {section === 'notes' && <NotesTab loan={loan} />}
          {section === 'properties' && <PropertiesTab loan={loan} />}
        </div>
      </div>

      {validation && completing && (
        <MissingFieldsDialog
          validation={validation}
          open
          onOpenChange={setCompleting}
          loanId={loan.id}
          onOpenSection={(anchor) => {
            goTo('1003')
            // Wait for the 1003 to render, then scroll to the section.
            setTimeout(() => document.getElementById(anchor)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400)
          }}
        />
      )}
      {editing && <EditLeadDialog loan={loan} ariveLoanNumber={loan.details.ariveLoanNumber} open={editing} onOpenChange={setEditing} />}
      {teamEdit && (
        <EditDialog
          title={teamEdit.label}
          open
          onOpenChange={(o) => !o && setTeamEdit(null)}
          saving={saveTeam.isPending}
          onSubmit={() => {
            if (!teamEdit.name.trim()) return toast.error('Enter a name')
            saveTeam.mutate(
              { role: teamEdit.role, member: { name: teamEdit.name, company: teamEdit.company } },
              { onSuccess: () => { toast.success(`${teamEdit.label} saved`); setTeamEdit(null) }, onError: (e) => toast.error(e.message) },
            )
          }}
        >
          <FormGrid>
            <Input label="Name" required value={teamEdit.name} onChange={(v) => setTeamEdit({ ...teamEdit, name: v })} span={3} />
            {teamEdit.withCompany && <Input label="Company" value={teamEdit.company} onChange={(v) => setTeamEdit({ ...teamEdit, company: v })} span={3} />}
          </FormGrid>
        </EditDialog>
      )}
      {dialog}
    </>
  )
}
