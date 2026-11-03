import { useState } from 'react'
import { ArrowRightIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatIsoDate, todayIso } from '@/lib/dates'
import { estimateLender, estimateProgramName, selectRows, type Estimate } from '@/lib/estimates/estimate'
import { formatPercent } from '@/lib/format'

/** "Select for this file?": exactly what changes on the file, then select. */
export function SelectDialog({ estimate, current, isPurchase, onSelect, onClose }: { estimate: Estimate; current: Estimate | null; isPurchase: boolean; onSelect: (e: Estimate) => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const rows = selectRows(current, estimate, isPurchase)
  const go = async () => {
    setBusy(true)
    try {
      await onSelect(estimate)
      toast.success(`"${estimate.name}" is selected for this file`)
      onClose()
    } catch (e) {
      toast.error(`Could not select it: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }
  const what = [estimateProgramName(estimate), estimateLender(estimate), formatPercent(estimate.noteRate)].filter(Boolean).join(' · ')
  return (
    <Dialog open onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Select "{estimate.name}" for this file?</DialogTitle>
          <DialogDescription>These loan fields will change.{current && ` "${current.name}" goes back to Draft and stays saved.`}</DialogDescription>
        </DialogHeader>
        <div className="overflow-hidden rounded-lg border">
          <table className="w-full text-sm">
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.label}>
                  <td className="px-3 py-2 text-muted-foreground">{r.label}</td>
                  <td className="px-3 py-2 text-muted-foreground line-through">{r.before ?? ''}</td>
                  <td className="w-6 text-muted-foreground">
                    <ArrowRightIcon className="size-3.5" />
                  </td>
                  <td className="px-3 py-2 font-semibold">{r.after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
          Updates the <b>1003</b>, <b>Overview</b>, <b>Prequal</b>, the <b>pre-approval letter</b> and the file header, and logs "Selected {what} on {formatIsoDate(todayIso())}" in Notes.
        </p>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button className="bg-nurture text-white hover:bg-nurture/90" onClick={go} disabled={busy}>
            {busy ? 'Selecting…' : 'Select for this file'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
