import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, Navigate, useLocation, useSearchParams } from 'react-router'
import { DndContext, DragOverlay, KeyboardSensor, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { ArrowLeftIcon, ChevronDownIcon, PlusIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared'
import { useNewLead } from '@/components/leads/new-lead-context'
import { LeadCard } from '@/components/pipeline/LeadCard'
import { SearchBox, TypeChips } from '@/components/pipeline/PipelineParts'
import { useStageChanger } from '@/components/pipeline/useStageChanger'
import { useBoardFiles, type BoardFile } from '@/lib/api/board'
import { todayIso } from '@/lib/dates'
import { formatCompactCurrency } from '@/lib/format'
import { boardStats, cardType, matchesQuick, matchesSearch, QUICK_FILTERS, sortCards, type QuickFilter } from '@/lib/pipeline/card'
import type { LeadTypeId } from '@/lib/pipeline/leadType'
import { matchesLoanNumber } from '@/lib/loans/numbers'
import { BOARDS, isBoard, pipelineFor, pipelineInfo, type BoardId, type PipelineColumn } from '@/lib/pipeline/pipelines'
import type { LoanPurpose } from '@/lib/pipeline/stages'

const DENSITY_KEY = 'mpshq.boardDensity'
const NEW_LEAD_PURPOSE: Record<BoardId, LoanPurpose> = { purchase: 'purchase', refinance: 'refinance_rate_term', heloc: 'heloc' }
const readDensity = (): 'full' | 'compact' => {
  try {
    return localStorage.getItem(DENSITY_KEY) === 'compact' ? 'compact' : 'full'
  } catch {
    return 'full'
  }
}

/** /pipeline/purchase, /pipeline/refinance, /pipeline/heloc. */
export function PipelineBoardPage() {
  const pipelineId = useLocation().pathname.split('/')[2] ?? ''
  if (!isBoard(pipelineId)) return <Navigate to="/pipeline" replace />
  return <Board key={pipelineId} id={pipelineId} />
}

function Board({ id }: { id: BoardId }) {
  const info = pipelineInfo(id)
  const { files, loading, error } = useBoardFiles()
  const { openNewLead } = useNewLead()
  const { requestChange, dialog } = useStageChanger()
  const [params] = useSearchParams()
  const [search, setSearch] = useState('')
  const [type, setType] = useState<LeadTypeId | null>(null)
  const [quick, setQuick] = useState<Set<QuickFilter>>(new Set())
  const [holdOpen, setHoldOpen] = useState(true)
  const [density, setDensity] = useState<'full' | 'compact'>(readDensity)
  const [now] = useState(() => new Date())
  const today = todayIso()
  // Phones: one column at a time, picked with the stage tabs (a "+N more" link opens on its stage).
  const [phoneCol, setPhoneCol] = useState<string>(() => params.get('stage') ?? info.columns[0].id)
  const columnRefs = useRef(new Map<string, HTMLDivElement>())

  const all = useMemo(() => (files ?? []).filter((f) => f.stage !== 'closed' && f.stage !== 'nurture' && f.stage !== 'lost'), [files])
  const mine = useMemo(() => all.filter((f) => pipelineFor(f) === id), [all, id])
  const shown = useMemo(
    () => mine.filter((f) => (!type || cardType(f) === type) && (matchesSearch(search, [f.name, f.address]) || matchesLoanNumber(search, f.loanNumbers)) && [...quick].every((q) => matchesQuick(f, q, now, today))),
    [mine, type, search, quick, now, today],
  )
  const stats = boardStats(mine, now, today)

  // "+N more" on the overview: scroll the board to that stage.
  useEffect(() => {
    const stage = params.get('stage')
    if (stage && !loading) columnRefs.current.get(stage)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' })
  }, [params, loading])

  const changeDensity = (d: 'full' | 'compact') => {
    setDensity(d)
    try {
      localStorage.setItem(DENSITY_KEY, d)
    } catch {
      // Not remembered; harmless.
    }
  }
  const toggleQuick = (q: QuickFilter) =>
    setQuick((s) => {
      const next = new Set(s)
      if (next.has(q)) next.delete(q)
      else next.add(q)
      return next
    })

  if (loading) return <p className="py-12 text-center text-sm text-muted-foreground">Loading the board…</p>
  if (error) return <EmptyState title="The board could not load" description={error.message} />

  const counts = (b: BoardId) => all.filter((f) => pipelineFor(f) === b).length
  const closedCount = (files ?? []).filter((f) => f.stage === 'closed').length
  const nurtureCount = (files ?? []).filter((f) => f.stage === 'nurture').length

  return (
    <div className="flex flex-col gap-3 text-[#111827]">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/pipeline" aria-label="Back to the pipeline overview" className="flex size-10 items-center justify-center rounded-lg border border-[#d8dde5] bg-white text-[#374151]">
          <ArrowLeftIcon className="size-[18px]" />
        </Link>
        <nav aria-label="Pipelines" className="flex flex-wrap gap-0.5 rounded-[10px] bg-[#e9edf2] p-[3px]">
          {BOARDS.map((b) => (
            <Link key={b} to={`/pipeline/${b}`} aria-current={b === id ? 'page' : undefined} className={cn('rounded-lg px-3.5 py-2 text-[13px]', b === id ? 'bg-white font-bold text-[#111827] shadow-[0_1px_2px_rgba(0,0,0,.08)]' : 'font-medium text-[#374151]')}>
              {pipelineInfo(b).label} <span className={cn('text-[#5b6472]', b === id ? 'font-medium' : '')}>{counts(b)}</span>
            </Link>
          ))}
          <Link to="/contacts?tab=closed" className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-[#374151]">
            Closed <span className="text-[#5b6472]">{closedCount}</span>
          </Link>
          <Link to="/pipeline/nurture" className="rounded-lg px-3.5 py-2 text-[13px] font-medium text-[#374151]">
            Nurture <span className="text-[#5b6472]">{nurtureCount}</span>
          </Link>
        </nav>
        <div className="flex flex-wrap gap-[18px] px-1.5 text-[13px] text-[#374151]">
          <span>
            <strong>{formatCompactCurrency(stats.volume)}</strong> volume
          </span>
          <span>
            <strong>{stats.closingThisMonth}</strong> closing this month
          </span>
          <span>
            <strong>{stats.avgDays ?? 0}d</strong> avg in stage
          </span>
        </div>
        <span className="flex-1" />
        <SearchBox value={search} onChange={setSearch} placeholder="Search name, address, loan #" />
        <Button onClick={() => openNewLead({ purpose: NEW_LEAD_PURPOSE[id] })}>
          <PlusIcon />
          New lead
        </Button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <TypeChips files={mine} value={type} onChange={setType} />
        <span className="flex-1" />
        {QUICK_FILTERS.map((q) => (
          <button key={q.id} type="button" aria-pressed={quick.has(q.id)} onClick={() => toggleQuick(q.id)} className={cn('rounded-lg border px-3 py-[7px] text-xs font-semibold', quick.has(q.id) ? 'border-[#1d5fc4] bg-[#e8f0fd] text-[#1d4fa3]' : 'border-[#d8dde5] bg-white text-[#374151]')}>
            {q.label}
          </button>
        ))}
        <button type="button" onClick={() => setHoldOpen((o) => !o)} className={cn('rounded-lg border px-3 py-[7px] text-xs font-semibold', holdOpen ? 'border-[#d8dde5] bg-white text-[#374151]' : 'border-[#1d5fc4] bg-[#e8f0fd] text-[#1d4fa3]')}>
          On hold: {holdOpen ? 'shown' : 'collapsed'}
        </button>
        <div className="flex rounded-lg bg-[#e9edf2] p-[3px] text-xs" role="group" aria-label="Card density">
          {(['full', 'compact'] as const).map((d) => (
            <button key={d} type="button" aria-pressed={density === d} onClick={() => changeDensity(d)} className={cn('rounded-md px-2.5 py-1', density === d ? 'bg-white font-semibold shadow-sm' : 'text-[#374151]')}>
              {d === 'full' ? 'Full cards' : 'Compact'}
            </button>
          ))}
        </div>
      </div>
      <p className="text-xs text-[#5b6472]">★ Priority files sort to the top of each stage, then the longest in stage. Drag a card to another stage; it starts that stage at step 1.</p>

      {/* Phone: stage tabs, one column at a time */}
      <div className="flex gap-1.5 overflow-x-auto md:hidden" role="tablist" aria-label="Stages">
        {info.columns.map((c) => (
          <button key={c.id} type="button" role="tab" aria-selected={phoneCol === c.id} onClick={() => setPhoneCol(c.id)} className={cn('shrink-0 rounded-full border px-3 py-1.5 text-xs font-semibold', phoneCol === c.id ? 'border-primary bg-primary text-white' : 'border-[#d8dde5] bg-white text-[#374151]')}>
            {c.label} {shown.filter((f) => c.stages.includes(f.stage)).length}
          </button>
        ))}
      </div>

      <BoardColumns columns={info.columns} files={shown} now={now} density={density} holdOpen={holdOpen} onHoldToggle={() => setHoldOpen((o) => !o)} phoneCol={phoneCol} columnRefs={columnRefs} onMove={(f, c) => requestChange({ id: f.id, stage: f.stage, borrowerName: f.name, closingDate: f.closingDate }, c.dropStage!)} />
      {dialog}
    </div>
  )
}

function BoardColumns({
  columns,
  files,
  now,
  density,
  holdOpen,
  onHoldToggle,
  phoneCol,
  columnRefs,
  onMove,
}: {
  columns: PipelineColumn[]
  files: BoardFile[]
  now: Date
  density: 'full' | 'compact'
  holdOpen: boolean
  onHoldToggle: () => void
  phoneCol: string
  columnRefs: { current: Map<string, HTMLDivElement> }
  onMove: (f: BoardFile, c: PipelineColumn) => void
}) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Phones: press and hold to drag, so a swipe still scrolls.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )
  const active = activeId ? files.find((f) => f.id === activeId) : undefined
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null)
    const f = files.find((x) => x.id === active.id)
    const c = columns.find((x) => x.id === over?.id)
    if (!f || !c?.dropStage || c.stages.includes(f.stage)) return
    onMove(f, c)
  }
  return (
    <DndContext sensors={sensors} onDragStart={({ active }) => setActiveId(String(active.id))} onDragCancel={() => setActiveId(null)} onDragEnd={onDragEnd}>
      <div className="overflow-x-auto">
        <div className="grid grid-cols-1 items-start gap-2.5 md:min-w-[1200px] md:[grid-template-columns:repeat(var(--cols),minmax(0,1fr))]" style={{ ["--cols" as string]: columns.length }}>
          {columns.map((c) => (
            <Column
              key={c.id}
              column={c}
              files={files.filter((f) => c.stages.includes(f.stage))}
              now={now}
              density={density}
              holdOpen={holdOpen}
              onHoldToggle={onHoldToggle}
              phoneHidden={phoneCol !== c.id}
              refFn={(el) => (el ? columnRefs.current.set(c.id, el) : columnRefs.current.delete(c.id))}
            />
          ))}
        </div>
      </div>
      <DragOverlay>{active ? <LeadCard file={active} now={now} compact={density === 'compact'} className="w-64" dragging /> : null}</DragOverlay>
    </DndContext>
  )
}

function Column({ column, files, now, density, holdOpen, onHoldToggle, phoneHidden, refFn }: { column: PipelineColumn; files: BoardFile[]; now: Date; density: 'full' | 'compact'; holdOpen: boolean; onHoldToggle: () => void; phoneHidden: boolean; refFn: (el: HTMLDivElement | null) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id, disabled: !column.dropStage })
  const working = sortCards(files.filter((f) => !f.onHoldAt))
  const held = sortCards(files.filter((f) => f.onHoldAt))
  const volume = files.reduce((s, f) => s + (f.loanAmount ?? f.purchasePrice ?? 0), 0)
  return (
    <div
      ref={(el) => {
        setNodeRef(el)
        refFn(el)
      }}
      className={cn('flex-col rounded-xl bg-[#eaeef3] p-2', phoneHidden ? 'hidden md:flex' : 'flex', isOver && 'ring-2 ring-primary/50')}
      aria-label={column.label}
    >
      <div className="px-1 pt-1 pb-1.5">
        <div className="flex items-baseline justify-between">
          <span className="text-[13px] font-bold">{column.label}</span>
          <span className="rounded-full bg-white px-2 text-xs font-semibold text-[#374151]">{files.length}</span>
        </div>
        <div className="mt-0.5 text-[11px] text-[#4b5563]">{formatCompactCurrency(volume)}</div>
      </div>
      {/* The cards scroll inside the column; the header stays put. */}
      <div className="flex max-h-[calc(100svh-290px)] min-h-[120px] flex-col gap-2 overflow-y-auto pr-0.5">
        {working.length === 0 && held.length === 0 && <p className="px-1 py-2 text-xs text-[#5b6472]">No files</p>}
        {working.map((f) => (
          <DraggableCard key={f.id} file={f} now={now} compact={density === 'compact'} />
        ))}
        {held.length > 0 && (
          <div className="mt-1">
            <button type="button" onClick={onHoldToggle} className="flex w-full items-center gap-1 px-1 py-1 text-xs font-semibold text-[#374151]" aria-expanded={holdOpen}>
              <ChevronDownIcon className={cn('size-3.5 transition-transform', !holdOpen && '-rotate-90')} />
              On hold ({held.length})
            </button>
            {holdOpen && (
              <div className="flex flex-col gap-2">
                {held.map((f) => (
                  <DraggableCard key={f.id} file={f} now={now} compact={density === 'compact'} />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function DraggableCard({ file, now, compact }: { file: BoardFile; now: Date; compact: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: file.id })
  return (
    <div ref={setNodeRef} {...attributes} {...listeners} className="touch-manipulation">
      <LeadCard file={file} now={now} compact={compact} dragging={isDragging} />
    </div>
  )
}
