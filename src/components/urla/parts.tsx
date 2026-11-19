import type * as React from 'react'
import { useState } from 'react'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Card, ToggleChip } from '@/components/shared'
import { AiBadge, AiRowBadge, STILL_NEED_TO_ASK, useAiFieldState, useAiRowKeys } from '@/components/shared/AiBadge'
import { useAiFillAnim } from '@/lib/aifill/animStore'

/** A 1003 section card with an anchor id and Save/Discard buttons that appear after edits. */
export function SectionCard({
  id,
  title,
  description,
  dirty,
  saving,
  onSave,
  onDiscard,
  action,
  children,
}: {
  id: string
  title: string
  description?: string
  dirty?: boolean
  saving?: boolean
  onSave?: () => void
  onDiscard?: () => void
  action?: React.ReactNode
  children: React.ReactNode
}) {
  // AI Fill: while a card is flying here, a dashed outline and a note.
  const incoming = useAiFillAnim().incoming === id
  return (
    <section id={id} className="scroll-mt-28">
      <Card
        title={title}
        description={description}
        className={cn(dirty && 'ring-2 ring-primary/30', incoming && 'outline-2 outline-offset-2 outline-blue-400/80 outline-dashed')}
        action={
          dirty && onSave ? (
            <div className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={onDiscard}>
                Discard
              </Button>
              <Button size="sm" onClick={onSave} disabled={saving}>
                {saving ? 'Saving…' : 'Save section'}
              </Button>
            </div>
          ) : (
            action
          )
        }
      >
        {incoming && <p className="mb-3 rounded-md border border-dashed border-blue-400/80 px-3 py-2 text-center text-sm font-semibold text-blue-700">Incoming from AI Summary…</p>}
        {children}
      </Card>
    </section>
  )
}

/** A yes/no question answered with two chips. Null means not answered yet. */
export function YesNo({
  label,
  prefix,
  value,
  onChange,
  children,
  field,
  aiKey,
}: {
  label: string
  prefix?: string
  /** The 1003 field it answers, so the section list can jump to it. */
  field?: string
  /** AI Fill: shows the AI tag while this answer is AI-filled. */
  aiKey?: string
  value: boolean | null
  onChange: (value: boolean | null) => void
  /** Follow-up fields shown when the answer is Yes. */
  children?: React.ReactNode
}) {
  const ai = useAiFieldState(aiKey)
  return (
    <div className={cn('space-y-2 rounded-md py-2.5', ai && '-mx-2 px-2 ring-1', ai === 'filled' && 'bg-blue-500/10 ring-blue-400/50', ai === 'ask' && 'bg-amber-500/10 ring-amber-500/60')} data-urla-field={field}>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <p className="text-sm">
          {prefix && <span className="mr-1.5 font-semibold text-muted-foreground">{prefix}.</span>}
          {label}
          {aiKey && (
            <span className="ml-1.5 inline-block align-middle">
              <AiBadge k={aiKey} />
            </span>
          )}
          {ai === 'ask' && <span className="ml-1.5 text-xs font-medium text-amber-700">{STILL_NEED_TO_ASK}</span>}
        </p>
        <div className="flex shrink-0 gap-2" role="group" aria-label={label}>
          <ToggleChip label="Yes" pressed={value === true} onChange={(p) => onChange(p ? true : null)} />
          <ToggleChip label="No" pressed={value === false} onChange={(p) => onChange(p ? false : null)} />
        </div>
      </div>
      {value === true && children && <div className="pl-0 sm:pl-6">{children}</div>}
    </div>
  )
}

/** Dialog wrapper for adding or editing one row in a 1003 list. */
export function EditDialog({
  title,
  description,
  open,
  onOpenChange,
  onSubmit,
  saving,
  submitLabel = 'Save',
  wide,
  children,
}: {
  title: string
  description?: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: () => void
  saving?: boolean
  submitLabel?: string
  wide?: boolean
  children: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('max-h-[90svh] overflow-y-auto', wide ? 'sm:max-w-3xl' : 'sm:max-w-2xl')}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            onSubmit()
          }}
        >
          {children}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving…' : submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** One row in a 1003 list (a job, an account, a debt) with edit and two-step delete. */
export function ListRow({
  title,
  detail,
  amount,
  onEdit,
  onDelete,
  aiPrefixes,
}: {
  title: React.ReactNode
  detail?: React.ReactNode
  amount?: React.ReactNode
  onEdit: () => void
  onDelete: () => void
  /** AI Fill: this row's keys (rowPrefixes), so it shows the AI tag while AI-filled. */
  aiPrefixes?: string[]
}) {
  const [confirming, setConfirming] = useState(false)
  const aiRow = useAiRowKeys(aiPrefixes).length > 0
  return (
    <li className={cn('flex flex-wrap items-center justify-between gap-2 py-2.5', aiRow && 'my-1 rounded-lg border border-blue-400/50 bg-blue-500/10 px-3')}>
      {aiPrefixes && <AiRowBadge prefixes={aiPrefixes} />}
      <button type="button" onClick={onEdit} className="min-w-0 flex-1 text-left">
        <p className="text-sm font-medium">{title}</p>
        {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      </button>
      <div className="flex items-center gap-1">
        {amount && <span className="mr-2 text-sm font-medium tabular-nums">{amount}</span>}
        <Button size="icon-xs" variant="ghost" onClick={onEdit} aria-label="Edit">
          <PencilIcon />
        </Button>
        {confirming ? (
          <>
            <Button size="xs" variant="destructive" onClick={onDelete}>
              Delete
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </>
        ) : (
          <Button size="icon-xs" variant="ghost" onClick={() => setConfirming(true)} aria-label="Delete">
            <Trash2Icon />
          </Button>
        )}
      </div>
    </li>
  )
}

export function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button size="sm" variant="outline" onClick={onClick}>
      <PlusIcon />
      {label}
    </Button>
  )
}

export function SubHeading({ children }: { children: React.ReactNode }) {
  return <p className="pt-2 pb-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{children}</p>
}
