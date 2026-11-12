import { useCallback, useState } from 'react'
import { useSearchParams } from 'react-router'
import { ArchiveIcon, ArrowLeftRightIcon, CheckIcon, ChevronDownIcon, CopyIcon, ListIcon, ListChecksIcon, MoreHorizontalIcon, PencilIcon, PlusIcon, Share2Icon, SlidersHorizontalIcon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Card, EmptyState, Input } from '@/components/shared'
import { updateEstimate } from '@/lib/api/estimates'
import type { LoanProfile } from '@/lib/api/types'
import { nowIso } from '@/lib/dates'
import { ESTIMATE_DEFAULTS, estimateName, estimateStatus, type Estimate } from '@/lib/estimates/estimate'
import { formatCurrency, formatPercent } from '@/lib/format'
import { scenarioFrom } from '@/lib/pricing/scenario'
import { BuildEstimates } from './BuildEstimates'
import { MatchLenders } from './MatchLenders'
import { downPayment } from '@/lib/products/scenarioForm'
import type { Scenario } from '@/lib/products/types'
import { ChangeForAllDialog } from './ChangeForAllDialog'
import { CompareEstimates } from './CompareEstimates'
import { EstimateEditor, type SaveState } from './EstimateEditor'
import { SavedEstimates, StatusBadge } from './SavedEstimates'
import { SelectDialog } from './SelectDialog'
import { ShareEstimatesDialog } from './ShareEstimatesDialog'
import { SharedEstimatesCard } from './SharedEstimatesCard'
import { draftOf, useEstimateData } from './useEstimateData'
import { useSelectEstimate } from './useSelectEstimate'
import { useEstimatePdf } from './useEstimatePdf'
import { SendSavedPdf } from '@/components/messages/SendDocumentDialog'

type View = 'estimate' | 'list' | 'build' | 'compare' | 'match'

/** Scenarios & Estimate: every estimate on the file, one open at a time, and the one Selected for the file. */
export function EstimatesTab({ loan }: { loan: LoanProfile }) {
  const data = useEstimateData(loan)
  const selectEstimate = useSelectEstimate(loan, data)
  const pdf = useEstimatePdf(loan, data)
  const [params, setParams] = useSearchParams()
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [selecting, setSelecting] = useState<Estimate | null>(null)
  const [renaming, setRenaming] = useState<Estimate | null>(null)
  const [changingAll, setChangingAll] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const onSaveState = useCallback((s: SaveState) => setSaveState(s), [])
  const readOnly = loan.stage === 'closed'
  const isPurchase = loan.purpose === 'purchase'

  const setParam = (changes: Record<string, string | null>) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p)
        for (const [k, v] of Object.entries(changes)) if (v) next.set(k, v)
        else next.delete(k)
        return next
      },
      { replace: true },
    )

  if (data.loading) return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
  if (data.error) return <p className="py-12 text-center text-sm text-destructive">{data.error.message.includes('program_option_id') || data.error.message.includes('archived_at') ? 'Run the estimates script (20261217000000_estimates.sql) in Supabase to use Scenarios & Estimate.' : data.error.message}</p>

  const selectedId = loan.details.pricingScenarioId
  const all = data.list
  const active = all.filter((e) => !e.archivedAt)
  const selectedEstimate = all.find((e) => e.id === selectedId) ?? null
  const wanted = params.get('estimate') ?? params.get('scenario')
  const requested = params.get('view') as View | null
  const open = all.find((e) => e.id === wanted) ?? selectedEstimate ?? active.at(-1) ?? null
  const view: View = requested ?? (readOnly ? 'list' : open ? 'estimate' : 'list')
  const openEstimate = (id: string) => setParam({ estimate: id, view: null })
  const show = (v: View | null) => setParam({ view: v })

  const run = async (work: () => Promise<unknown>, done: string) => {
    try {
      await work()
      await data.refresh()
      toast.success(done)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const newBlank = () =>
    run(async () => {
      const subject = data.properties.find((p) => p.id === loan.details.subjectPropertyId) ?? null
      const base = scenarioFrom(loan, subject, estimateName('New estimate', all.map((e) => e.name)), data.properties)
      const created = await data.create({ ...base, ...ESTIMATE_DEFAULTS })
      openEstimate(created.id)
    }, 'Started a new estimate')
  const duplicate = (e: Estimate) =>
    run(async () => {
      const created = await data.create({ ...draftOf(e), name: estimateName(`${e.name} copy`, all.map((x) => x.name)), archivedAt: null, fromLoanId: null }, data.feesOf(e.id))
      openEstimate(created.id)
    }, `Duplicated "${e.name}"`)
  const archive = (e: Estimate) => {
    if (e.id === selectedId) return toast.error('This one is Selected for the file. Select another estimate first, then archive it.')
    run(() => updateEstimate(e.id, { archivedAt: nowIso() }), `Archived "${e.name}". Show archived to restore it.`)
    setChecked((c) => new Set([...c].filter((x) => x !== e.id)))
  }
  const restore = (e: Estimate) => run(() => updateEstimate(e.id, { archivedAt: null }), `Restored "${e.name}"`)
  const check = (id: string, on: boolean) => setChecked((c) => (on ? new Set([...c, id]) : new Set([...c].filter((x) => x !== id))))
  const checkedList = active.filter((e) => checked.has(e.id))

  const menu = (e: Estimate) => (
    <DropdownMenuContent align="start">
      <DropdownMenuItem onSelect={() => openEstimate(e.id)}>Open</DropdownMenuItem>
      {!readOnly && (
        <>
          <DropdownMenuItem onSelect={() => duplicate(e)}>
            <CopyIcon />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setRenaming(e)}>
            <PencilIcon />
            Rename
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => archive(e)} disabled={e.id === selectedId}>
            <ArchiveIcon />
            Archive
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setSelecting(e)} disabled={e.id === selectedId}>
            <CheckIcon />
            {e.id === selectedId ? 'Selected for this file' : 'Select for this file'}
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenuContent>
  )

  const header = (
    <div className="ml-auto flex flex-wrap items-center gap-1.5">
      {view === 'estimate' && open && !readOnly && <SaveIndicator state={saveState} />}
      {!readOnly && (
        <Button size="xs" variant="outline" onClick={() => show('match')} title="Check every program in your lender catalog against this file">
          <ListChecksIcon />
          Match lenders
        </Button>
      )}
      {!readOnly && (
        <Button size="xs" className="bg-money text-white hover:bg-money/90" onClick={() => show('build')}>
          <SparklesIcon />
          Build estimates
        </Button>
      )}
      <Button size="xs" variant="outline" onClick={() => show('compare')} disabled={active.length < 1} title="Compare estimates">
        <ArrowLeftRightIcon />
        <span className="hidden 2xl:inline">Compare</span>
      </Button>
      {!readOnly && (
        <Button size="xs" variant="outline" onClick={() => setChangingAll(true)} disabled={active.length < 1} title="Change one field on several estimates">
          <SlidersHorizontalIcon />
          <span className="hidden 2xl:inline">Change for all</span>
        </Button>
      )}
      {!readOnly && (
        <Button size="xs" variant="outline" onClick={() => setSharing(true)} disabled={active.length < 1}>
          <Share2Icon />
          {checkedList.length ? `Share selected (${checkedList.length})` : 'Share…'}
        </Button>
      )}
      {view === 'estimate' && open && !readOnly && (
        <>
          {open.id === selectedId ? (
            <span className="inline-flex h-6 items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2 text-xs font-medium text-emerald-700">
              <CheckIcon className="size-3.5" />
              Selected for file
            </span>
          ) : (
            <Button size="xs" className="bg-nurture text-white hover:bg-nurture/90" onClick={() => setSelecting(open)}>
              Select for this file
            </Button>
          )}
        </>
      )}
    </div>
  )

  // One estimate selector: the open estimate, a list of all of them, and New.
  const shownEstimate = view === 'estimate' ? open : null
  const chips = (
    <div className="flex min-w-0 items-center gap-1">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className="flex min-w-0 items-center gap-1.5 rounded-lg border bg-card px-2 py-1 text-left shadow-soft hover:bg-muted/50" aria-label="Pick an estimate">
            {shownEstimate ? (
              <>
                <span className="truncate text-xs font-semibold">{shownEstimate.name}</span>
                <StatusBadge status={estimateStatus(shownEstimate, selectedId)} />
                <span className="hidden text-[0.7rem] text-muted-foreground tabular-nums 2xl:inline">
                  {formatPercent(data.figuresOf(shownEstimate).ratePct)} · {formatCurrency(data.figuresOf(shownEstimate).pitia)}
                </span>
              </>
            ) : (
              <span className="text-xs font-semibold">{view === 'list' ? 'Saved estimates' : 'Pick an estimate'}</span>
            )}
            <span className="text-[0.7rem] text-muted-foreground tabular-nums">({active.length})</span>
            <ChevronDownIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-96">
          {active.map((e) => {
            const f = data.figuresOf(e)
            return (
              <DropdownMenuItem key={e.id} onSelect={() => openEstimate(e.id)} className={cn(shownEstimate?.id === e.id && 'bg-muted')}>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate font-medium">{e.name}</span>
                    <StatusBadge status={estimateStatus(e, selectedId)} />
                  </span>
                  <span className="block text-xs text-muted-foreground tabular-nums">
                    {formatPercent(f.ratePct)} · {formatCurrency(f.pitia)}/mo · {formatCurrency(Math.abs(f.cashToClose))} to close
                  </span>
                </span>
              </DropdownMenuItem>
            )
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => show(view === 'list' ? null : 'list')}>
            <ListIcon />
            {view === 'list' ? 'Back to the estimate' : `Saved estimates (${all.length})${all.some((e) => e.archivedAt) ? ' · Show archived' : ''}`}
          </DropdownMenuItem>
          {!readOnly && (
            <>
              <DropdownMenuItem onSelect={() => show('build')}>
                <SparklesIcon />
                Build estimates (several programs)
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={newBlank}>
                <PlusIcon />
                One estimate from the loan
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {shownEstimate && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon-sm" variant="ghost" aria-label={`${shownEstimate.name} menu`} title="Open, duplicate, rename, archive, select">
              <MoreHorizontalIcon />
            </Button>
          </DropdownMenuTrigger>
          {menu(shownEstimate)}
        </DropdownMenu>
      )}
    </div>
  )

  let body: React.ReactNode
  if (view === 'match') body = <MatchLenders loan={loan} data={data} onClose={() => show(null)} onCreate={(ids, s) => setParam({ view: 'build', programs: ids.join(','), ...matchedDeal(s) })} />
  else if (view === 'build') body = <BuildEstimates loan={loan} data={data} onClose={() => setParam({ view: null, programs: null, price: null, down: null, property: null })} onCreated={(ids) => (setChecked(new Set(ids)), setParam({ view: 'list', estimate: ids[0] ?? null, programs: null, price: null, down: null, property: null }))} />
  else if (view === 'compare')
    body = (
      <CompareEstimates
        loan={loan}
        data={data}
        estimates={checkedList.length >= 2 ? checkedList : active}
        selectedId={selectedId}
        readOnly={readOnly}
        onOpen={openEstimate}
        onDuplicate={duplicate}
        onSelect={setSelecting}
        onChangeForAll={() => setChangingAll(true)}
        onClose={() => show(null)}
      />
    )
  else if (view === 'list' || !open)
    body = all.length ? (
      <SavedEstimates estimates={all} selectedId={selectedId} figuresOf={data.figuresOf} checked={checked} onCheck={check} onOpen={openEstimate} onSelect={setSelecting} onRestore={restore} isPurchase={isPurchase} readOnly={readOnly} onPdf={(e) => void pdf.save(e)} />
    ) : (
      <Card>
        <EmptyState
          title="No estimates yet"
          description="Pick several programs and get a full estimate for each one at once: payment, Smart Fees, cash to close and DTI. Then tweak each one and select one for the file."
          action={
            !readOnly && (
              <div className="flex gap-2">
                <Button className="bg-money text-white hover:bg-money/90" onClick={() => show('build')}>
                  <SparklesIcon />
                  Build estimates
                </Button>
                <Button variant="outline" onClick={newBlank}>
                  One from the loan
                </Button>
              </div>
            )
          }
        />
      </Card>
    )
  else
    body = (
      <EstimateEditor
        key={open.id}
        loan={loan}
        estimate={open}
        data={data}
        selected={open.id === selectedId}
        onSelect={(e) => void selectEstimate(e).then(() => toast.success('The file is updated'), (err: Error) => toast.error(err.message))}
        onOpen={openEstimate}
        onCompare={() => show('compare')}
        onSaveState={onSaveState}
      />
    )

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 className="text-base font-bold tracking-tight">Scenarios & Estimate</h2>
        {view !== 'build' && view !== 'compare' && view !== 'match' && chips}
        {header}
      </div>
      {body}
      {view !== 'build' && view !== 'match' && <SharedEstimatesCard loanId={loan.id} readOnly={readOnly} />}
      <SendSavedPdf loan={loan} docId={pdf.sendingId} onClose={pdf.closeSend} />
      {selecting && <SelectDialog estimate={selecting} current={selectedEstimate} isPurchase={isPurchase} onSelect={selectEstimate} onClose={() => setSelecting(null)} />}
      {renaming && <RenameDialog estimate={renaming} onSave={(name) => run(() => updateEstimate(renaming.id, { name }), 'Renamed')} onClose={() => setRenaming(null)} />}
      {sharing && <ShareEstimatesDialog loan={loan} data={data} pdf={pdf} estimates={active} initial={checkedList.length ? checkedList.map((e) => e.id) : [open?.id ?? active[0]?.id].filter((x): x is string => !!x)} onClose={() => setSharing(false)} />}
      {changingAll && (
        <ChangeForAllDialog
          data={data}
          estimates={active}
          initial={checkedList.length ? checkedList.map((e) => e.id) : active.map((e) => e.id)}
          selectedId={selectedId}
          onSelectAgain={selectEstimate}
          onClose={() => setChangingAll(false)}
        />
      )}
    </div>
  )
}

/** A purchase's price and down payment from Match lenders' parameters, for Build estimates (?price=&down=). */
function matchedDeal(s: Scenario): Record<string, string | null> {
  const down = downPayment(s)
  return down && s.purchasePrice ? { price: String(s.purchasePrice), down: String(down.pct) } : { price: null, down: null }
}

function SaveIndicator({ state }: { state: SaveState }) {
  const text = { saved: 'Saved', saving: 'Saving…', unsaved: 'Saving soon…', waiting: 'Waiting: update the file?' }[state]
  return (
    <span className="mr-1 flex items-center gap-1.5 text-sm text-muted-foreground">
      <span className={cn('size-2 rounded-full', state === 'saved' ? 'bg-nurture' : state === 'waiting' ? 'bg-primary' : 'bg-money')} />
      {text}
    </span>
  )
}

function RenameDialog({ estimate, onSave, onClose }: { estimate: Estimate; onSave: (name: string) => Promise<void>; onClose: () => void }) {
  const [name, setName] = useState(estimate.name)
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename estimate</DialogTitle>
        </DialogHeader>
        <Input label="Name" value={name} onChange={setName} required />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!name.trim()} onClick={() => void onSave(name.trim()).then(onClose)}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
