// Lenders → Import lenders CSV (Connor, 2026-11-17): reads the lender
// spreadsheet, shows what each row changes, and saves on one click. Rules in
// src/lib/products/lenderCsv.ts.
import { useState } from 'react'
import { UploadIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ToggleChip } from '@/components/shared'
import { fetchLendersForImport, useImportLenders } from '@/lib/api/lenders'
import { parseLenderCsv, planLenderImport } from '@/lib/products/lenderCsv'

type Read = ReturnType<typeof planLenderImport> & { problems: string[]; ready: boolean; fileName: string }

export function ImportLendersDialog({ onClose }: { onClose: () => void }) {
  const save = useImportLenders()
  const [read, setRead] = useState<Read | null>(null)
  const [addNew, setAddNew] = useState(true)
  const [reading, setReading] = useState(false)

  const onFile = async (file: File) => {
    setReading(true)
    try {
      const { rows, problems } = parseLenderCsv(await file.text())
      const { ready, lenders } = await fetchLendersForImport()
      setRead({ ...planLenderImport(rows, lenders), problems, ready, fileName: file.name })
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setReading(false)
    }
  }

  const adds = read && addNew ? read.adds : []
  const count = (read?.updates.length ?? 0) + adds.length

  const apply = () => {
    if (!read) return
    save.mutate(
      { updates: read.updates, adds },
      {
        onSuccess: (r) => {
          const parts = [r.updated && `${r.updated} updated`, r.added && `${r.added} added`, r.contacts && `${r.contacts} ${r.contacts === 1 ? 'contact' : 'contacts'} saved`].filter(Boolean)
          toast.success(`Lenders imported: ${parts.join(', ')}`)
          onClose()
        },
        onError: (e) => toast.error(e.message),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !save.isPending && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import lenders</DialogTitle>
          <DialogDescription>
            Rows are matched to your lenders by name. A filled cell replaces what's here; a blank cell leaves it alone. Notes are added below the lender's notes. The second AE, scenario desk, closing and condition upload go in each lender's Contacts. Sample rows are skipped.
          </DialogDescription>
        </DialogHeader>
        <Button variant="outline" asChild className="w-fit">
          <label className="cursor-pointer">
            <UploadIcon />
            {reading ? 'Reading…' : read ? `Choose another file (${read.fileName})` : 'Choose CSV…'}
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
          </label>
        </Button>
        {read && !read.ready && (
          <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
            Paste the lender details script (<code>20270212000000_lender_details.sql</code>) into the Supabase SQL Editor first, then choose the file again.
          </p>
        )}
        {read && read.ready && (
          <div className="max-h-[50vh] space-y-3 overflow-y-auto text-sm">
            {read.updates.length > 0 && (
              <div>
                <p className="font-semibold">Update {read.updates.length} {read.updates.length === 1 ? 'lender' : 'lenders'}</p>
                <ul className="mt-1 space-y-0.5 rounded-md border p-2 text-xs">
                  {read.updates.map((u) => (
                    <li key={u.row.line}>
                      <strong>{u.lenderName}</strong>
                      {u.lenderName !== u.row.name && <span className="text-muted-foreground"> (row says {u.row.name})</span>}: {u.summary.join(', ')}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {read.adds.length > 0 && (
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-semibold">
                    {read.adds.length} {read.adds.length === 1 ? 'row has' : 'rows have'} no lender in MPS HQ
                  </p>
                  <ToggleChip label="Add them as new lenders" pressed={addNew} onChange={setAddNew} />
                </div>
                <ul className="mt-1 list-disc pl-5 text-xs">
                  {read.adds.map((r) => (
                    <li key={r.line}>
                      Row {r.line}: {r.name}
                    </li>
                  ))}
                </ul>
                {!addNew && <p className="mt-1 text-xs text-muted-foreground">Left out. Fix the name in the CSV to match the Lenders page, or turn this on.</p>}
              </div>
            )}
            {read.unchanged.length > 0 && <p className="text-xs text-muted-foreground">Already up to date: {read.unchanged.map((u) => u.lenderName).join(', ')}.</p>}
            {read.problems.length > 0 && (
              <ul className="list-disc pl-5 text-xs text-muted-foreground">
                {read.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            {count === 0 && <p className="text-muted-foreground">Nothing to change.</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Close
          </Button>
          {read?.ready && count > 0 && (
            <Button onClick={apply} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : `Save ${count} ${count === 1 ? 'lender' : 'lenders'}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
