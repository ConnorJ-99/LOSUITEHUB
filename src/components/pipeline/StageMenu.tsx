import type * as React from 'react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { STAGES, type PipelineStage } from '@/lib/pipeline/stages'

/** Dropdown listing every stage; works on phones where dragging is awkward. */
export function StageMenu({
  stage,
  onSelect,
  children,
}: {
  stage: PipelineStage
  onSelect: (stage: PipelineStage) => void
  /** The trigger button. */
  children: React.ReactElement
}) {
  const main = STAGES.filter((s) => s.kind === 'main')
  const side = STAGES.filter((s) => s.kind === 'side')
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="text-xs text-muted-foreground">Move to stage</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={stage} onValueChange={(value) => onSelect(value as PipelineStage)}>
          {main.map((s) => (
            <DropdownMenuRadioItem key={s.value} value={s.value}>
              {s.label}
            </DropdownMenuRadioItem>
          ))}
          <DropdownMenuSeparator />
          {side.map((s) => (
            <DropdownMenuRadioItem key={s.value} value={s.value}>
              {s.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
