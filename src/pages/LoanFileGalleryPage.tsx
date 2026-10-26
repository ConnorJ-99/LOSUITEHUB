import { useState } from 'react'
import type * as React from 'react'
import {
  BadgeDollarSignIcon,
  ClipboardListIcon,
  FileCheck2Icon,
  FileTextIcon,
  FolderIcon,
  HomeIcon,
  LandmarkIcon,
  LockIcon,
  MailIcon,
  MinusIcon,
  NotebookPenIcon,
  PenLineIcon,
  ReceiptIcon,
  SendIcon,
  ShieldCheckIcon,
  WorkflowIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { PageHeader } from '@/components/shared'
import {
  FileHeader,
  FileNav,
  GroupProgress,
  MetricStrip,
  MilestoneStepper,
  NextStepCard,
  SectionChecklist,
  StatusPill,
  StepGroup,
  StepRow,
  TeamRow,
  type ChecklistSection,
  type FileNavItem,
  type Milestone,
  type TeamMember,
} from '@/components/loanfile'
import { creditTier } from '@/lib/loanfile/display'

// Sample data only: a made-up purchase file to show each loan file piece.
// Nothing on this page reads or writes real records.

const tier = creditTier(681)!
const METRICS = [
  { label: 'Loan amount', value: '$440,000' },
  { label: 'Loan type', value: 'Conventional' },
  { label: 'Credit score', value: '681', note: tier.label, tone: tier.tone },
  { label: 'LTV', value: '80.00%' },
  { label: 'CLTV', value: '80.00%' },
  { label: 'DTI', value: '41.20%' },
  { label: 'Property', value: 'TBD, Frisco, TX' },
]

const MILESTONES: Milestone[] = [
  { label: 'Application', state: 'done', date: 'Oct 20' },
  { label: 'Disclosures sent', state: 'current' },
  { label: 'Submitted', state: 'future' },
  { label: 'In underwriting', state: 'future' },
  { label: 'Approved w/ conditions', state: 'future' },
  { label: 'Conditions submitted', state: 'future' },
  { label: 'Clear to close', state: 'future' },
  { label: 'Docs out', state: 'future' },
  { label: 'Closed', state: 'future' },
  { label: 'Funded', state: 'future' },
]

const FAILED_EXAMPLE: Milestone[] = [
  { label: 'Application', state: 'done', date: 'Oct 20' },
  { label: 'Disclosures sent', state: 'done', date: 'Oct 21' },
  { label: 'Submitted', state: 'failed' },
  { label: 'In underwriting', state: 'future' },
]

const INITIAL_TEAM: TeamMember[] = [
  { group: 'Broker', role: 'Loan Officer', name: 'Connor', options: ['Connor'] },
  { group: 'Broker', role: 'Processor', name: null, options: ['(future hire)'] },
  { group: 'Lender', role: 'Account Exec', name: null, options: ['Sample AE'] },
  { group: 'Contract', role: 'Title', name: 'Sample Title Co.', options: ['Sample Title Co.'] },
]

const NAV: FileNavItem[] = [
  { id: 'overview', label: 'Overview', icon: WorkflowIcon },
  { id: '1003', label: '1003', icon: FileTextIcon, marker: { type: 'count', value: 2 } },
  { id: 'income', label: 'Income', icon: BadgeDollarSignIcon, marker: { type: 'complete' } },
  { id: 'fees', label: 'Fees', icon: ReceiptIcon, marker: { type: 'review' } },
  { id: 'documents', label: 'Documents', icon: FolderIcon },
  { id: 'notes', label: 'Notes', icon: NotebookPenIcon },
  { id: 'loan', label: 'Loan', icon: LandmarkIcon },
  { id: 'properties', label: 'Properties', icon: HomeIcon },
  { id: 'letters', label: 'Letters', icon: MailIcon },
]

const SECTIONS: ChecklistSection[] = [
  { id: 'loan', label: 'Loan Information', missing: 1, started: true },
  { id: 'property', label: 'Subject Property', missing: 1, started: true },
  { id: 'borrower', label: 'Borrower Info', missing: 0, started: true },
  { id: 'credit', label: 'Credit Scores', missing: 0, started: false },
  { id: 'income', label: 'Employment & Income', missing: 0, started: false },
  { id: 'assets', label: 'Assets', missing: 0, started: false },
  { id: 'liabilities', label: 'Liabilities', missing: 0, started: false },
  { id: 'reo', label: 'Real Estate Owned', missing: 0, started: false },
  { id: 'declarations', label: 'Declarations', missing: 0, started: true },
  { id: 'demographics', label: 'Demographic Information', missing: 0, started: true },
  { id: 'origination', label: 'Origination Party', missing: 0, started: false },
]

const sample = (what: string) => () => toast.info(`Sample only: "${what}" will open the real screen once wired up.`)

function Specimen({ name, note, children }: { name: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <div>
        <h2 className="font-mono text-sm font-semibold">{name}</h2>
        {note && <p className="text-xs text-muted-foreground">{note}</p>}
      </div>
      <div className="rounded-xl border border-dashed bg-background p-4">{children}</div>
    </section>
  )
}

/** Sample-data preview of every loan file piece, for review before wiring to real data. */
export function LoanFileGalleryPage() {
  const [detailsOpen, setDetailsOpen] = useState(true)
  const [team, setTeam] = useState(INITIAL_TEAM)
  const [navActive, setNavActive] = useState('overview')
  const [navCollapsed, setNavCollapsed] = useState(false)
  const [openGroup, setOpenGroup] = useState<string | null>('Disclosure & Setup')
  const [section, setSection] = useState<string | null>('loan')

  return (
    <div className="space-y-8">
      <PageHeader title="Loan file pieces (sample data)" description="Each piece from the loan file design, filled with a made-up file. Nothing here is real or saved." />

      <Specimen name="FileHeader" note="Sticky at the top of every borrower page. Hide/Show details folds the metrics, milestones and team.">
        <div className="relative max-h-[28rem] overflow-y-auto rounded-lg bg-card px-4 md:px-6">
          <FileHeader
            borrowerName="Jordan Sample"
            fileNumber="ARV-000123"
            statusLabel="Application"
            nextStep="Send disclosures · Loan Officer · 3d"
            updatedLabel="Updated Oct 25, 2026, 4:16 PM"
            detailsOpen={detailsOpen}
            onToggleDetails={() => setDetailsOpen((o) => !o)}
            onSave={sample('Save')}
            saveDisabled
            onChangeStatus={sample('Change status')}
          >
            <MetricStrip metrics={METRICS} />
            <MilestoneStepper milestones={MILESTONES} band="Loan open" />
            <TeamRow members={team} onAssign={(role, name) => setTeam((t) => t.map((m) => (m.role === role ? { ...m, name } : m)))} />
          </FileHeader>
          <p className="py-6 text-sm text-muted-foreground">(The file's sections scroll under the header.)</p>
        </div>
      </Specimen>

      <Specimen name="MetricStrip" note="Label over value with thin dividers. The credit score dot follows the tier (681 = Good, green). Scrolls sideways on a phone.">
        <MetricStrip metrics={METRICS} />
      </Specimen>

      <Specimen name="MilestoneStepper" note="Done = green with a check and date; current = navy outline; future = grey. The second example shows a failed step in red.">
        <div className="space-y-6">
          <MilestoneStepper milestones={MILESTONES} band="Loan open" />
          <MilestoneStepper milestones={FAILED_EXAMPLE} />
        </div>
      </Specimen>

      <Specimen name="TeamRow" note="Filled dot = assigned; hollow dot and italic Unassigned = open. Each chip is a dropdown (try it).">
        <TeamRow members={team} onAssign={(role, name) => setTeam((t) => t.map((m) => (m.role === role ? { ...m, name } : m)))} />
      </Specimen>

      <Specimen name="FileNav" note="Left list on desktop (collapse with the button); a scrolling tab bar on phones. Red count = missing items, green check = complete, amber dot = needs review.">
        <div className="flex gap-6">
          <FileNav items={NAV} active={navActive} onSelect={setNavActive} collapsed={navCollapsed} onToggleCollapsed={() => setNavCollapsed((c) => !c)} />
          <div className="hidden flex-1 items-center justify-center rounded-lg border bg-card text-sm text-muted-foreground md:flex">
            Selected: {NAV.find((n) => n.id === navActive)?.label}
          </div>
        </div>
      </Specimen>

      <Specimen name="NextStepCard" note="The one thing to do now, plus up to four other ready items.">
        <NextStepCard
          icon={SendIcon}
          eyebrow="Disclosure & Setup · Your next step"
          title="Send disclosures"
          description="Send the initial disclosure package from Arive, then mark it done here."
          actionLabel="Open Arive"
          onAction={sample('Open Arive')}
          alsoReady={[
            { icon: ClipboardListIcon, label: 'Complete the 1003', actionLabel: 'Open 1003', onAction: sample('Open 1003') },
            { icon: FolderIcon, label: 'Request documents', actionLabel: 'Draft request', onAction: sample('Draft request') },
            { icon: HomeIcon, label: 'Order appraisal', actionLabel: 'Mark ordered', onAction: sample('Mark ordered') },
          ]}
        />
      </Specimen>

      <Specimen name="GroupProgress" note="One segment per step: green done, navy ready, red blocked. The dot marks the current group.">
        <GroupProgress
          groups={[
            { name: 'Origination', steps: ['done', 'done', 'done', 'ready', 'ready', 'not_started', 'not_started'] },
            { name: 'Disclosure & Setup', steps: ['ready', 'not_started', 'ready', 'na', 'blocked'], current: true },
            { name: 'Underwriting', steps: ['not_started', 'not_started', 'not_started', 'not_started', 'not_started', 'not_started'] },
            { name: 'Closing & Funding', steps: ['not_started', 'not_started'] },
          ]}
          summary="3 of 19 steps complete · now on Send disclosures, waiting on Loan Officer"
        />
      </Specimen>

      <Specimen name="StepGroup + StepRow + StatusPill" note="Accordions. The current group has the navy border, You are here, and who it's waiting on. Blocked steps say why in red.">
        <div className="space-y-3">
          <StepGroup name="Origination" statuses={['done', 'done', 'done', 'ready', 'ready', 'not_started', 'not_started']} open={openGroup === 'Origination'} onToggle={() => setOpenGroup((g) => (g === 'Origination' ? null : 'Origination'))}>
            <StepRow icon={NotebookPenIcon} name="Call notes and pre-qual" owner="Loan Officer" status="done" />
            <StepRow icon={ShieldCheckIcon} name="Pull credit" owner="Loan Officer" status="ready" actionLabel="Mark done" onAction={sample('Mark done')} />
          </StepGroup>
          <StepGroup
            name="Disclosure & Setup"
            statuses={['ready', 'not_started', 'ready', 'na', 'blocked']}
            current
            waitingOn="Loan Officer · Connor"
            days={3}
            open={openGroup === 'Disclosure & Setup'}
            onToggle={() => setOpenGroup((g) => (g === 'Disclosure & Setup' ? null : 'Disclosure & Setup'))}
          >
            <StepRow icon={SendIcon} name="Send disclosures" owner="Loan Officer" status="ready" actionLabel="Open Arive" onAction={sample('Open Arive')} />
            <StepRow icon={PenLineIcon} name="Sign disclosures" owner="Borrower" status="not_started" />
            <StepRow icon={HomeIcon} name="Order appraisal" owner="Loan Officer" status="ready" actionLabel="Mark ordered" onAction={sample('Mark ordered')} />
            <StepRow icon={MinusIcon} name="Pre-submission conditions" owner="Loan Officer" status="na" />
            <StepRow icon={LockIcon} name="File setup" owner="Loan Officer" status="blocked" reason="Can't submit: no lender or program selected." actionLabel="Submit" />
          </StepGroup>
          <StepGroup name="Underwriting" statuses={['not_started', 'not_started', 'not_started', 'not_started', 'not_started', 'not_started']} open={openGroup === 'Underwriting'} onToggle={() => setOpenGroup((g) => (g === 'Underwriting' ? null : 'Underwriting'))}>
            <StepRow icon={FileCheck2Icon} name="Submit to lender" owner="Loan Officer" status="not_started" />
          </StepGroup>
          <div className="flex flex-wrap gap-2 pt-2">
            {(['ready', 'not_started', 'in_progress', 'done', 'blocked', 'na'] as const).map((s) => (
              <StatusPill key={s} status={s} />
            ))}
          </div>
        </div>
      </Specimen>

      <Specimen name="SectionChecklist" note="The 1003 tab: yellow missing count, green check when complete, dashed circle when not started. Validate Application lists every missing field.">
        <div className="max-w-xl">
          <SectionChecklist
            sections={SECTIONS}
            active={section}
            onSelect={setSection}
            applicationsLabel="1 application, 1 borrower"
            onApplications={sample('Applications')}
            onValidate={sample('Validate Application')}
          />
        </div>
      </Specimen>
    </div>
  )
}
