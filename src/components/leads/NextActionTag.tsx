// The lead's Next Action tag (Connor, 2026-11-16), on pipeline cards and the
// file header. Click to pick one by hand; the pick sticks until the file's
// data changes (an application, a document, a letter, a home), and
// "Automatic (from the file)" goes back. Shows "Next action?" when there's
// none yet.
import type * as React from 'react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { useSetNextAction } from '@/lib/api/nextAction'
import { NEXT_ACTIONS, nextActionInfo, type NextActionId } from '@/lib/leads/nextAction'

/** Keeps a click from opening the file or starting a drag (on a card). */
const stop = { onClick: (e: React.SyntheticEvent) => e.stopPropagation(), onPointerDown: (e: React.SyntheticEvent) => e.stopPropagation(), onKeyDown: (e: React.SyntheticEvent) => e.stopPropagation() }

export function NextActionTag({ loanId, value, manual, editable = true, className }: { loanId: string; value: NextActionId | null; manual: boolean; editable?: boolean; className?: string }) {
  const set = useSetNextAction()
  const info = nextActionInfo(value)
  const tag = info ? (
    <span className={cn('inline-flex max-w-full items-center truncate rounded px-1.5 py-0.5 text-[11px] font-semibold', info.className, className)} title={manual ? `${info.label} (picked by hand)` : info.label}>
      {info.label}
      {manual && <span className="ml-1 font-normal opacity-75">· set</span>}
    </span>
  ) : (
    <span className={cn('rounded border border-dashed border-[#d1d5db] px-1.5 py-0.5 text-[11px] text-muted-foreground', className)}>Next action?</span>
  )
  if (!editable) return info ? tag : null
  const pick = (nextAction: NextActionId | null) => set.mutate({ id: loanId, nextAction }, { onError: (e) => toast.error(e.message) })
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild {...stop}>
        <button type="button" className="min-w-0 self-start rounded text-left hover:opacity-80" title="What they need to do next">
          {tag}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" {...stop}>
        <DropdownMenuLabel>Next action</DropdownMenuLabel>
        {NEXT_ACTIONS.map((a) => (
          <DropdownMenuItem key={a.id} onSelect={() => pick(a.id)} className="flex-col items-start gap-0">
            <span className="flex w-full items-center">
              <span className={cn('rounded px-1.5 py-0.5 text-[11px] font-semibold', a.className)}>{a.label}</span>
              {value === a.id && <span className="ml-auto pl-3 text-xs text-muted-foreground">{manual ? 'set' : 'now'}</span>}
            </span>
            <span className="text-[11px] text-muted-foreground">{a.hint}</span>
          </DropdownMenuItem>
        ))}
        {manual && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => pick(null)}>Automatic (from the file)</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
