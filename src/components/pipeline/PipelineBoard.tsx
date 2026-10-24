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
import { BOARD_ARCHIVE_DAYS, fullName } from '@/lib/pipeline/helpers'
import { STAGES, type PipelineStage, type StageInfo } from '@/lib/pipeline/stages'
import { LoanCard } from './LoanCard'

type RequestChange = (loan: { id: string; stage: PipelineStage; borrowerName: string }, stage: PipelineStage) => void

interface BoardProps {
  loans: PipelineLoan[]
  showLo: boolean
  onRequestChange: RequestChange
}

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

function Column({ stage, loans, showLo, onRequestChange }: { stage: StageInfo; loans: PipelineLoan[] } & Omit<BoardProps, 'loans'>) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.value })
  const archived = stage.value === 'closed' || stage.value === 'lost'
  return (
    <section
      ref={setNodeRef}
      aria-label={stage.label}
      className={cn(
        'flex w-64 shrink-0 snap-start flex-col rounded-xl border bg-foreground/[0.025] transition-colors',
        stage.kind === 'side' && 'border-dashed',
        isOver && 'border-primary/50 bg-accent',
      )}
    >
      <header className="flex items-baseline justify-between gap-2 px-3 pt-3 pb-2">
        <h2 className="text-xs font-semibold tracking-wide uppercase">{stage.label}</h2>
        <span className="text-xs text-muted-foreground tabular-nums">{loans.length}</span>
      </header>
      {archived && <p className="-mt-1 px-3 pb-2 text-[11px] text-muted-foreground">Last {BOARD_ARCHIVE_DAYS} days</p>}
      <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
        {loans.map((loan) => (
          <DraggableCard key={loan.id} loan={loan} showLo={showLo} onRequestChange={onRequestChange} />
        ))}
      </div>
    </section>
  )
}

/** Kanban board: one column per stage. Drag a card, or use its ⋯ menu, to move it. */
export function PipelineBoard({ loans, showLo, onRequestChange }: BoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // On phones, press and hold briefly to drag so normal swiping still scrolls.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor),
  )

  const byStage = new Map<PipelineStage, PipelineLoan[]>(STAGES.map((s) => [s.value, []]))
  for (const loan of loans) byStage.get(loan.stage)?.push(loan)
  const active = activeId ? loans.find((l) => l.id === activeId) : undefined

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveId(null)
    const loan = loans.find((l) => l.id === active.id)
    if (!loan || !over) return
    onRequestChange({ id: loan.id, stage: loan.stage, borrowerName: fullName(loan.borrower) }, over.id as PipelineStage)
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={({ active }) => setActiveId(String(active.id))}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-4 md:-mx-6 md:px-6">
        {STAGES.map((stage) => (
          <Column key={stage.value} stage={stage} loans={byStage.get(stage.value) ?? []} showLo={showLo} onRequestChange={onRequestChange} />
        ))}
      </div>
      <DragOverlay>{active ? <LoanCard loan={active} showLo={showLo} dragging className="w-60" /> : null}</DragOverlay>
    </DndContext>
  )
}
