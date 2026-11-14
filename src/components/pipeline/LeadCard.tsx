// The one pipeline card (Pipeline redesign, Connor 2026-11-13), used on the
// overview, the boards and anywhere a file shows as a card. The lead type's
// color is a 3px L in the top-left corner with the type label inside it; the
// card keeps a light border. Clicking the step line moves to the next step
// (with Undo); clicking the type label changes the type. Clicking the card
// opens the file. All the wording comes from src/lib/pipeline/card.ts.
import type * as React from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { cn } from 'cn'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useSetLeadType, useSetStep, type BoardFile } from '@/lib/api/board'
import { amountLine, cardType, daysInStage, OCCUPANCY_LABEL, stepInfo, timelineLine } from '@/lib/pipeline/card'
import { LEAD_TYPES, leadTypeInfo } from '@/lib/pipeline/leadType'

/** Keeps a click on a control from opening the file or starting a drag. */
const stop = { onClick: (e: React.SyntheticEvent) => e.stopPropagation(), onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(), onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation() }

const Star = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="#d97706" stroke="#d97706" strokeWidth="1.5" role="img" aria-label="Priority">
    <path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" />
  </svg>
)

function TypeTag({ file, editable }: { file: BoardFile; editable: boolean }) {
  const setType = useSetLeadType()
  const t = leadTypeInfo(cardType(file))
  const label = <span className="pl-1 text-[11px] font-extrabold tracking-[.03em] whitespace-nowrap" style={{ color: t.color }}>{t.label}</span>
  if (!editable) return label
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild {...stop}>
        <button type="button" className="rounded hover:bg-muted/60" title="Change the loan type">
          {label}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" {...stop}>
        <DropdownMenuLabel>Loan type</DropdownMenuLabel>
        {LEAD_TYPES.map((x) => (
          <DropdownMenuItem key={x.id} onSelect={() => setType.mutate({ id: file.id, leadType: x.id }, { onError: (e) => toast.error(e.message) })}>
            <span className="font-bold" style={{ color: x.color }}>{x.label}</span>
            {file.leadType === x.id && <span className="ml-auto text-xs text-muted-foreground">set</span>}
          </DropdownMenuItem>
        ))}
        {file.leadType && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setType.mutate({ id: file.id, leadType: null }, { onError: (e) => toast.error(e.message) })}>From the file (automatic)</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export interface LeadCardProps {
  file: BoardFile
  /** One line: color tag, name, step, days. */
  compact?: boolean
  /** Small card for the overview's strips and columns (no step line actions). */
  mini?: boolean
  now: Date
  className?: string
  dragging?: boolean
}

export function LeadCard({ file, compact, mini, now, className, dragging }: LeadCardProps) {
  const navigate = useNavigate()
  const setStep = useSetStep()
  const t = leadTypeInfo(cardType(file))
  const step = stepInfo(file)
  const days = daysInStage(file.stageChangedAt, now)
  const onHold = !!file.onHoldAt
  const open = () => navigate(`/loans/${file.id}`)

  const advance = () => {
    if (!step || step.n >= step.total) return
    const before = file.currentStep
    setStep.mutate(
      { id: file.id, step: step.n + 1 },
      {
        onSuccess: () => toast.success(`${file.name}: ${stepInfo({ ...file, currentStep: step.n + 1 })!.name}`, { action: { label: 'Undo', onClick: () => setStep.mutate({ id: file.id, step: before }) } }),
        onError: (e) => toast.error(e.message),
      },
    )
  }

  if (compact) {
    return (
      <div
        role="link"
        tabIndex={0}
        onClick={open}
        onKeyDown={(e) => e.key === 'Enter' && open()}
        className={cn('flex cursor-pointer items-center gap-2 rounded-md border border-[#dfe4ea] px-2 py-1.5 text-xs shadow-[0_1px_2px_rgba(16,24,40,.04)] hover:border-primary/40', onHold ? 'bg-[#f3f4f6]' : 'bg-white', dragging && 'opacity-60', className)}
      >
        <span className="size-2.5 shrink-0 rounded-sm" style={{ background: t.color }} aria-label={t.label} />
        {file.priority && <Star />}
        <span className="min-w-0 flex-1 truncate font-semibold">{file.name}</span>
        {step && <span className="shrink-0 text-muted-foreground">{step.n}/{step.total}</span>}
        <span className="shrink-0 text-muted-foreground tabular-nums">{days}d</span>
      </div>
    )
  }

  const amount = amountLine(file)
  const when = timelineLine(file)
  return (
    <div
      role="link"
      tabIndex={0}
      onClick={open}
      onKeyDown={(e) => e.key === 'Enter' && open()}
      className={cn(
        'relative flex cursor-pointer flex-col rounded-[10px] border border-[#dfe4ea] text-[#111827] shadow-[0_1px_2px_rgba(16,24,40,.04)] hover:border-primary/40',
        mini ? 'gap-1.5 px-2.5 py-2' : 'gap-2 px-[11px] py-2.5',
        onHold ? 'bg-[#f3f4f6]' : 'bg-white',
        dragging && 'opacity-60',
        className,
      )}
    >
      <div aria-hidden className="pointer-events-none absolute -top-px -left-px h-[26px] w-14 rounded-tl-[10px] border-t-[3px] border-l-[3px]" style={{ borderColor: t.color }} />
      <div className="flex items-center gap-1.5">
        <TypeTag file={file} editable={!mini} />
        {file.occupancy && <span className="truncate text-[11px] text-[#4b5563]">· {OCCUPANCY_LABEL[file.occupancy] ?? file.occupancy}</span>}
        <span className="flex-1" />
        {file.priority && <Star />}
        {onHold && <span className="rounded bg-[#e5e9ef] px-1.5 py-0.5 text-[10px] font-bold text-[#374151]">ON HOLD</span>}
      </div>
      <div className="min-w-0">
        <p className={cn('truncate font-bold', mini ? 'text-sm' : 'text-[15px]')}>{file.name}</p>
        {amount && <p className="text-xs text-[#4b5563]">{amount}</p>}
      </div>
      {step && (
        <div>
          <div className="flex items-baseline justify-between gap-2 text-xs">
            {mini ? (
              <span className="min-w-0 truncate text-[#374151]">
                Step {step.n} of {step.total} · {step.name}
              </span>
            ) : (
              <button type="button" {...stop} onClick={(e) => (e.stopPropagation(), advance())} disabled={setStep.isPending || step.n >= step.total} className="min-w-0 truncate text-left text-[#374151] hover:text-primary hover:underline disabled:no-underline disabled:hover:text-[#374151]" title={step.n < step.total ? 'Mark this step done and move to the next' : 'Last step of this stage'}>
                Step {step.n} of {step.total} · {step.name}
              </button>
            )}
            <span className="shrink-0 text-[#4b5563] tabular-nums">{days}d in stage</span>
          </div>
          <div className="mt-1 flex gap-[3px]" aria-hidden>
            {Array.from({ length: step.total }, (_, i) => (
              <span key={i} className="h-1 flex-1 rounded-full" style={{ background: i < step.n ? t.color : '#e5e9ef' }} />
            ))}
          </div>
        </div>
      )}
      {!step && <p className="text-xs text-[#4b5563]">{days}d in stage</p>}
      {!mini && when && <p className="text-xs text-[#4b5563]">{when}</p>}
      {!mini && file.nextTask && (
        <p className="truncate text-xs text-[#374151]">
          <span className="font-semibold">Next:</span> {file.nextTask.title}
        </p>
      )}
    </div>
  )
}
