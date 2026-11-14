// The loan header's number chips (Connor, 2026-11-13): "Lender: [name] ·
// Loan # [x]", "Arive # [x]" (with Open in Arive) and "Title GF # [x]". Click
// a number to copy it; the pencil edits it in place (Enter saves, Esc
// cancels). The lender is picked in a small dialog, which the stage change
// also uses when a file moves to Processing or later without one.
import { useEffect, useRef, useState } from 'react'
import { CopyIcon, ExternalLinkIcon, PencilIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormGrid, Input, Select } from '@/components/shared'
import { useLenders } from '@/lib/api/lenders'
import { useLoanNumbers, useSaveLoanNumbers } from '@/lib/api/loanNumbers'
import { useOrganization } from '@/lib/api/settings'
import { ariveUrl } from '@/lib/arive'
import { resolveLender, type LoanNumbers, type ResolvedLender } from '@/lib/loans/numbers'

const copy = (label: string, v: string) => navigator.clipboard.writeText(v).then(() => toast.success(`${label} copied`), () => toast.error("Couldn't copy"))

function NumberChip({ label, value, onSave, extra, title }: { label: string; value: string | null; onSave: (v: string) => Promise<void>; extra?: React.ReactNode; title?: string }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value ?? '')
  const [saving, setSaving] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing) ref.current?.focus()
  }, [editing])

  const save = async () => {
    if ((draft.trim() || null) === (value ?? null)) return setEditing(false)
    setSaving(true)
    try {
      await onSave(draft)
      setEditing(false)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (editing)
    return (
      <span className="inline-flex items-center gap-1 rounded-md border bg-card px-1.5 py-0.5 text-[0.7rem]">
        <span className="text-muted-foreground">{label}</span>
        <input
          ref={ref}
          aria-label={label}
          value={draft}
          disabled={saving}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
            if (e.key === 'Escape') setEditing(false)
          }}
          onBlur={() => void save()}
          className="w-28 bg-transparent font-mono outline-none"
        />
      </span>
    )

  return (
    <span className="inline-flex items-center gap-0.5 rounded-md border bg-card text-[0.7rem]" title={title}>
      {value ? (
        <button type="button" onClick={() => copy(label, value)} className="inline-flex items-center gap-1 rounded-l-md py-0.5 pl-1.5 hover:bg-muted" title={`Copy ${label}`}>
          <span className="text-muted-foreground">{label}</span>
          <span className="font-mono">{value}</span>
          <CopyIcon className="size-3 text-muted-foreground" />
        </button>
      ) : (
        <span className="py-0.5 pl-1.5 text-muted-foreground">{label} —</span>
      )}
      <button
        type="button"
        onClick={() => {
          setDraft(value ?? '')
          setEditing(true)
        }}
        className="rounded-r-md px-1 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        aria-label={`Edit ${label}`}
      >
        <PencilIcon className="size-3" />
      </button>
      {extra}
    </span>
  )
}

export function LoanNumberChips({ loanId }: { loanId: string }) {
  const nums = useLoanNumbers(loanId)
  const lenders = useLenders()
  const org = useOrganization()
  const save = useSaveLoanNumbers(loanId)
  const [lenderOpen, setLenderOpen] = useState(false)
  if (!nums.data) return null
  const n = nums.data
  const lender = resolveLender(n, lenders.data ?? [])
  const arive = ariveUrl(org.data?.ariveLoanUrl, n.ariveLoanNumber)

  return (
    <>
      {n.ready && (
        <span className="inline-flex items-center gap-0.5 rounded-md border bg-card text-[0.7rem]">
          <button type="button" onClick={() => setLenderOpen(true)} className="rounded-l-md py-0.5 pl-1.5 hover:bg-muted" title="Change the lender or the lender's loan number">
            <span className="text-muted-foreground">Lender:</span> <span className="font-medium">{lender.name ?? 'not set'}</span>
          </button>
          <span className="text-muted-foreground">·</span>
          {n.lenderLoanNumber ? (
            <button type="button" onClick={() => copy('Loan #', n.lenderLoanNumber!)} className="inline-flex items-center gap-1 py-0.5 pr-1 hover:bg-muted" title="Copy the lender loan #">
              <span className="text-muted-foreground">Loan #</span>
              <span className="font-mono">{n.lenderLoanNumber}</span>
              <CopyIcon className="size-3 text-muted-foreground" />
            </button>
          ) : (
            <span className="py-0.5 pr-1 text-muted-foreground">Loan # —</span>
          )}
          <button type="button" onClick={() => setLenderOpen(true)} className="rounded-r-md px-1 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground" aria-label="Edit the lender and loan #">
            <PencilIcon className="size-3" />
          </button>
        </span>
      )}
      <NumberChip
        label="Arive #"
        value={n.ariveLoanNumber}
        onSave={(v) => save.mutateAsync({ ariveLoanNumber: v })}
        extra={
          arive && (
            <a href={arive} target="_blank" rel="noopener noreferrer" className="rounded-r-md px-1 py-0.5 text-primary hover:bg-muted" title="Open in Arive (new tab)" aria-label="Open in Arive">
              <ExternalLinkIcon className="size-3" />
            </a>
          )
        }
      />
      {n.ready && <NumberChip label="Title GF #" value={n.titleFileNumber} onSave={(v) => save.mutateAsync({ titleFileNumber: v })} />}
      <LenderNumberDialog open={lenderOpen} onOpenChange={setLenderOpen} numbers={n} lender={lender} onSave={(c) => save.mutateAsync(c)} />
    </>
  )
}

/**
 * Picks the file's lender (from the Lenders page) and its loan number. A
 * program's lender is shown and can't be changed here (change the program).
 * `required` = the stage change is waiting on both.
 */
export function LenderNumberDialog({
  open,
  onOpenChange,
  numbers,
  lender,
  onSave,
  required,
  description,
  saveLabel = 'Save',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  numbers: LoanNumbers
  lender: ResolvedLender
  onSave: (c: { lenderId?: string | null; lenderLoanNumber: string }) => Promise<void>
  required?: boolean
  description?: string
  saveLabel?: string
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && <LenderNumberBody onClose={() => onOpenChange(false)} numbers={numbers} lender={lender} onSave={onSave} required={required} description={description} saveLabel={saveLabel} />}
    </Dialog>
  )
}

function LenderNumberBody({
  onClose,
  numbers,
  lender,
  onSave,
  required,
  description,
  saveLabel,
}: {
  onClose: () => void
  numbers: LoanNumbers
  lender: ResolvedLender
  onSave: (c: { lenderId?: string | null; lenderLoanNumber: string }) => Promise<void>
  required?: boolean
  description?: string
  saveLabel: string
}) {
  const lenders = useLenders()
  const [lenderId, setLenderId] = useState<string | null>(lender.from === 'file' ? lender.id : null)
  const [loanNo, setLoanNo] = useState(numbers.lenderLoanNumber ?? '')
  const [saving, setSaving] = useState(false)

  const fixed = lender.from === 'program'
  const hasLender = fixed || !!lenderId || (lender.from === 'typed' && !lenderId)
  const ok = !required || (hasLender && !!loanNo.trim())
  const submit = async () => {
    setSaving(true)
    try {
      await onSave({ ...(!fixed && lenderId !== (lender.from === 'file' ? lender.id : null) && { lenderId }), lenderLoanNumber: loanNo })
      onClose()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
      <DialogContent onInteractOutside={(e) => saving && e.preventDefault()}>
        <DialogHeader>
          <DialogTitle>Lender and loan #</DialogTitle>
          <DialogDescription>{description ?? "The lender's loan number is used in the mortgagee clause, templates and to match emails."}</DialogDescription>
        </DialogHeader>
        <FormGrid className="lg:grid-cols-2">
          {fixed ? (
            <Input label="Lender" value={lender.name ?? ''} readOnly hint="From the file's program" />
          ) : (
            <Select
              label="Lender"
              required={required}
              value={lenderId}
              onChange={setLenderId}
              onClear={() => setLenderId(null)}
              placeholder={lender.from === 'typed' ? `${lender.name} (typed)` : 'Pick a lender'}
              options={(lenders.data ?? []).map((l) => ({ value: l.id, label: l.name }))}
            />
          )}
          <Input label="Lender loan #" required={required} value={loanNo} onChange={setLoanNo} autoComplete="off" />
        </FormGrid>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!ok || saving} className={cn(saving && 'opacity-80')}>
            {saving ? 'Saving…' : saveLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
  )
}
