import type * as React from 'react'
import { useState } from 'react'
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Card, ToggleChip } from '@/components/shared'

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
  return (
    <section id={id} className="scroll-mt-28">
      <Card
        title={title}
        description={description}
        className={cn(dirty && 'ring-2 ring-primary/30')}
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
}: {
  label: string
  prefix?: string
  value: boolean | null
  onChange: (value: boolean | null) => void
  /** Follow-up fields shown when the answer is Yes. */
  children?: React.ReactNode
}) {
  return (
    <div className="space-y-2 py-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <p className="text-sm">
          {prefix && <span className="mr-1.5 font-semibold text-muted-foreground">{prefix}.</span>}
          {label}
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
}: {
  title: React.ReactNode
  detail?: React.ReactNode
  amount?: React.ReactNode
  onEdit: () => void
  onDelete: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
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
