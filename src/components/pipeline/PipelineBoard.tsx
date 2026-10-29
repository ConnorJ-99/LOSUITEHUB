import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import { ChevronLeftIcon, ChevronRightIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import type { PipelineLoan, Task } from '@/lib/api/types'
import { formatCompactCurrency } from '@/lib/format'
import { fullName } from '@/lib/pipeline/helpers'
import { cardAmount, type PipelineColumn } from '@/lib/pipeline/pipelines'
import { STAGES, type PipelineStage } from '@/lib/pipeline/stages'
import { LoanCard } from './LoanCard'

type RequestChange = (loan: { id: string; stage: PipelineStage; borrowerName: string }, stage: PipelineStage) => void

interface BoardProps {
  loans: PipelineLoan[]
  showLo: boolean
  onRequestChange: RequestChange
  /** The pipeline's columns; one per stage when omitted (All loans). */
  columns?: readonly PipelineColumn[]
  /** Each file's open tasks, by loan id (shown under the card). */
  tasks?: Map<string, Task[]>
  /** "+ Add lead" at the bottom of a column: starts a lead in that column's stage. */
  onAddLead?: (stage: PipelineStage) => void
}

/** All loans: a column for every stage. */
const STAGE_COLUMNS: PipelineColumn[] = STAGES.map((s) => ({ id: s.value, label: s.label, stages: [s.value], dropStage: s.value }))

function DraggableCard({ loan, showLo, onRequestChange, tasks }: { loan: PipelineLoan; showLo: boolean; onRequestChange: RequestChange; tasks?: Task[] }) {
  const navigate = useNavigate()
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: loan.id })
  return (
    <LoanCard
      ref={setNodeRef}
      loan={loan}
      showLo={showLo}
      tasks={tasks}
      className={cn(isDragging && 'opacity-40')}
      onOpen={() => navigate(`/loans/${loan.id}`)}
      onStageSelect={(stage) => onRequestChange({ id: loan.id, stage: loan.stage, borrowerName: fullName(loan.borrower) }, stage)}
      {...attributes}
      {...listeners}
    />
  )
}

function Column({ column, loans, showLo, onRequestChange, tasks, onAddLead }: { column: PipelineColumn; loans: PipelineLoan[]; showLo: boolean; onRequestChange: RequestChange; tasks?: Map<string, Task[]>; onAddLead?: (stage: PipelineStage) => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id, disabled: !column.dropStage })
  const side = column.stages.every((s) => s === 'nurture' || s === 'lost')
  const total = loans.reduce((sum, l) => sum + (cardAmount(l) ?? 0), 0)
  return (
    <section
      ref={setNodeRef}
      aria-label={column.label}
      className={cn(
        'flex w-72 shrink-0 snap-start flex-col rounded-xl border bg-foreground/[0.025] transition-colors',
        side && 'border-dashed',
        isOver && 'border-primary/50 bg-accent',
      )}
    >
      <header className="px-3 pt-3 pb-2">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="font-heading text-base">{column.label}</h2>
          <span className="text-sm text-muted-foreground tabular-nums">{loans.length}</span>
        </div>
        <p className="text-xs font-medium text-money tabular-nums">{formatCompactCurrency(total)}</p>
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
        {loans.map((loan) => (
          <DraggableCard key={loan.id} loan={loan} showLo={showLo} onRequestChange={onRequestChange} tasks={tasks?.get(loan.id)} />
        ))}
        {onAddLead && column.dropStage && (
          <button type="button" onClick={() => onAddLead(column.dropStage!)} className="rounded-lg py-2 text-xs text-muted-foreground hover:bg-card hover:text-foreground">
            + Add lead
          </button>
        )}
      </div>
    </section>
  )
}

/** The columns in a sideways-scrolling row, with left/right buttons above it so you don't have to reach the scrollbar at the bottom. */
function ScrollRow({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [edges, setEdges] = useState({ left: false, right: false })
  const update = () => {
    const el = ref.current
    if (el) setEdges({ left: el.scrollLeft > 1, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 1 })
  }
  useEffect(() => {
    const el = ref.current
    if (!el) return
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  // About a screenful at a time, at least one column (w-72 plus the gap).
  const scroll = (direction: 1 | -1) => {
    const el = ref.current
    if (el) el.scrollBy({ left: direction * Math.max(300, el.clientWidth - 300), behavior: 'smooth' })
  }
  return (
    <>
      {(edges.left || edges.right) && (
        <div className="mb-2 flex justify-end gap-1">
          <Button variant="outline" size="icon-sm" aria-label="Scroll left" disabled={!edges.left} onClick={() => scroll(-1)}>
            <ChevronLeftIcon />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Scroll right" disabled={!edges.right} onClick={() => scroll(1)}>
            <ChevronRightIcon />
          </Button>
        </div>
      )}
      <div ref={ref} onScroll={update} className="-mx-4 flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-4 md:-mx-6 md:scroll-px-6 md:px-6">
        {children}
      </div>
    </>
  )
}

/** A one-column pipeline as a grid of cards with the column's count and dollar total. */
function SingleList({ column, loans, showLo, onRequestChange, tasks, onAddLead }: { column: PipelineColumn; loans: PipelineLoan[] } & Omit<BoardProps, 'loans' | 'columns'>) {
  const navigate = useNavigate()
  const total = loans.reduce((sum, l) => sum + (cardAmount(l) ?? 0), 0)
  return (
    <section aria-label={column.label} className="space-y-3">
      <header className="flex items-baseline gap-3">
        <h2 className="font-heading text-lg">{column.label}</h2>
        <span className="text-sm text-muted-foreground tabular-nums">{loans.length}</span>
        <span className="text-sm font-medium text-money tabular-nums">{formatCompactCurrency(total)}</span>
        {onAddLead && column.dropStage && column.dropStage !== 'lost' && (
          <button type="button" onClick={() => onAddLead(column.dropStage!)} className="ml-auto rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-card hover:text-foreground">
            + Add lead
          </button>
        )}
      </header>
      {loans.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Nothing here.</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {loans.map((loan) => (
            <LoanCard
              key={loan.id}
              loan={loan}
              showLo={showLo}
              tasks={tasks?.get(loan.id)}
              onOpen={() => navigate(`/loans/${loan.id}`)}
              onStageSelect={(stage) => onRequestChange({ id: loan.id, stage: loan.stage, borrowerName: fullName(loan.borrower) }, stage)}
            />
          ))}
        </div>
      )}
    </section>
  )
}

/** Kanban board: a pipeline's columns, each with a count and dollar total. Drag a card, or use its ⋯ menu, to move it. */
export function PipelineBoard({ loans, showLo, onRequestChange, columns = STAGE_COLUMNS, tasks, onAddLead }: BoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // On phones, press and hold briefly to drag so normal swiping still scrolls.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const inColumn = (c: PipelineColumn) => loans.filter((l) => c.stages.includes(l.stage))
  const active = activeId ? loans.find((l) => l.id === activeId) : undefined

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null)
    const loan = loans.find((l) => l.id === active.id)
    const target = columns.find((c) => c.id === over?.id)?.dropStage
    // Dropping in the column it's already in changes nothing.
    if (!loan || !target || columns.find((c) => c.id === over?.id)?.stages.includes(loan.stage)) return
    onRequestChange({ id: loan.id, stage: loan.stage, borrowerName: fullName(loan.borrower) }, target)
  }

  // One-column pipelines (New Leads, Nurture, Lost): a grid across the page, newest first; move cards with their ⋯ menu.
  if (columns.length === 1) {
    const column = columns[0]
    const here = inColumn(column).sort((a, b) => b.stageChangedAt.localeCompare(a.stageChangedAt))
    return <SingleList column={column} loans={here} showLo={showLo} onRequestChange={onRequestChange} tasks={tasks} onAddLead={onAddLead} />
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ active }) => setActiveId(String(active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <ScrollRow>
        {columns.map((column) => (
          <Column key={column.id} column={column} loans={inColumn(column)} showLo={showLo} onRequestChange={onRequestChange} tasks={tasks} onAddLead={onAddLead} />
        ))}
      </ScrollRow>
      <DragOverlay>{active ? <LoanCard loan={active} showLo={showLo} dragging className="w-60" /> : null}</DragOverlay>
    </DndContext>
  )
}
