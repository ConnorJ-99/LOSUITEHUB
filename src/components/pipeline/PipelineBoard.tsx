import { useState } from 'react'
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
import { cn } from 'cn'
import type { PipelineLoan } from '@/lib/api/types'
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
}

/** All loans: a column for every stage. */
const STAGE_COLUMNS: PipelineColumn[] = STAGES.map((s) => ({ id: s.value, label: s.label, stages: [s.value], dropStage: s.value }))

function DraggableCard({ loan, showLo, onRequestChange }: { loan: PipelineLoan; showLo: boolean; onRequestChange: RequestChange }) {
  const navigate = useNavigate()
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: loan.id })
  return (
    <LoanCard
      ref={setNodeRef}
      loan={loan}
      showLo={showLo}
      className={cn(isDragging && 'opacity-40')}
      onOpen={() => navigate(`/loans/${loan.id}`)}
      onStageSelect={(stage) => onRequestChange({ id: loan.id, stage: loan.stage, borrowerName: fullName(loan.borrower) }, stage)}
      {...attributes}
      {...listeners}
    />
  )
}

function Column({ column, loans, showLo, onRequestChange }: { column: PipelineColumn; loans: PipelineLoan[]; showLo: boolean; onRequestChange: RequestChange }) {
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
          <h2 className="text-sm font-semibold">{column.label}</h2>
          <span className="text-sm text-muted-foreground tabular-nums">{loans.length}</span>
        </div>
        <p className="text-xs text-muted-foreground tabular-nums">{formatCompactCurrency(total)}</p>
      </header>
      <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
        {loans.map((loan) => (
          <DraggableCard key={loan.id} loan={loan} showLo={showLo} onRequestChange={onRequestChange} />
        ))}
      </div>
    </section>
  )
}

/** Kanban board: a pipeline's columns, each with a count and dollar total. Drag a card, or use its ⋯ menu, to move it. */
export function PipelineBoard({ loans, showLo, onRequestChange, columns = STAGE_COLUMNS }: BoardProps) {
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

  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ active }) => setActiveId(String(active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 md:-mx-6 md:px-6">
        {columns.map((column) => (
          <Column key={column.id} column={column} loans={inColumn(column)} showLo={showLo} onRequestChange={onRequestChange} />
        ))}
      </div>
      <DragOverlay>{active ? <LoanCard loan={active} showLo={showLo} dragging className="w-60" /> : null}</DragOverlay>
    </DndContext>
  )
}
