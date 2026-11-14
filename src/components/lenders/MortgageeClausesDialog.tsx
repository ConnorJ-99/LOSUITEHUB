// Lenders → Mortgagee clauses: export every lender's clause as a CSV, or
// import one (lender_name, clause_name, address_line1, address_line2, city,
// state, zip, email, notes). Rows are matched to lenders by name; the ones
// that don't match are listed and nothing is saved for them.
import { useState } from 'react'
import { DownloadIcon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { lenderClause, useSaveClauses, type Lender } from '@/lib/api/lenders'
import { clauseCsv, lenderClauseLines, matchClauseRows, parseClauseCsv, type ClauseRow } from '@/lib/loans/mortgagee'

const download = (name: string, text: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
}

export function MortgageeClausesDialog({ lenders, onClose }: { lenders: Lender[]; onClose: () => void }) {
  const save = useSaveClauses()
  const [read, setRead] = useState<{ matched: { lenderId: string; lenderName: string; row: ClauseRow }[]; unmatched: ClauseRow[]; problems: string[] } | null>(null)
  const withClause = lenders.filter((l) => lenderClauseLines(lenderClause(l)))

  const onFile = async (file: File) => {
    const { rows, problems } = parseClauseCsv(await file.text())
    setRead({ ...matchClauseRows(rows, lenders), problems })
  }

  const apply = () => {
    if (!read) return
    save.mutate(
      read.matched.map(({ lenderId, row }) => ({
        lenderId,
        clause: { clauseName: row.clauseName, addressLine1: row.addressLine1, addressLine2: row.addressLine2, city: row.city, state: row.state, zip: row.zip, insuranceEmail: row.email, insuranceFax: lenders.find((l) => l.id === lenderId)?.clause?.insuranceFax ?? null, notes: row.notes },
      })),
      {
        onSuccess: () => {
          toast.success(`${read.matched.length} mortgagee ${read.matched.length === 1 ? 'clause' : 'clauses'} saved`)
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
          <DialogTitle>Mortgagee clauses</DialogTitle>
          <DialogDescription>
            {withClause.length} of {lenders.length} lenders have a clause. Import a CSV with the columns lender_name, clause_name, address_line1, address_line2, city, state, zip, email, notes. Rows are matched to lenders by name.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => download('mortgagee-clauses.csv', clauseCsv(lenders.map(lenderClause)))}>
            <DownloadIcon />
            Export CSV
          </Button>
          <Button variant="outline" asChild>
            <label className="cursor-pointer">
              <UploadIcon />
              Import CSV…
              <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
            </label>
          </Button>
        </div>
        {read && (
          <div className="space-y-3 text-sm">
            <p>
              <strong>{read.matched.length}</strong> {read.matched.length === 1 ? 'row matches a lender' : 'rows match lenders'}; their clause fields will be replaced.
            </p>
            {read.matched.length > 0 && (
              <ul className="max-h-40 overflow-y-auto rounded-md border p-2 text-xs">
                {read.matched.map((m) => (
                  <li key={m.row.line}>
                    Row {m.row.line}: {m.row.lenderName} → <strong>{m.lenderName}</strong> · {[m.row.clauseName, m.row.addressLine1, m.row.city].filter(Boolean).join(', ') || 'blank clause'}
                  </li>
                ))}
              </ul>
            )}
            {read.unmatched.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                <p className="font-semibold">No lender with this name ({read.unmatched.length}), not saved:</p>
                <ul className="mt-1 list-disc pl-4">
                  {read.unmatched.map((r) => (
                    <li key={r.line}>
                      Row {r.line}: {r.lenderName}
                    </li>
                  ))}
                </ul>
                <p className="mt-1">Add the lender first, or fix the name in the CSV to match the Lenders page.</p>
              </div>
            )}
            {read.problems.length > 0 && (
              <ul className="list-disc pl-4 text-xs text-muted-foreground">
                {read.problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={save.isPending}>
            Close
          </Button>
          {read && read.matched.length > 0 && (
            <Button onClick={apply} disabled={save.isPending}>
              {save.isPending ? 'Saving…' : `Save ${read.matched.length} ${read.matched.length === 1 ? 'clause' : 'clauses'}`}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
