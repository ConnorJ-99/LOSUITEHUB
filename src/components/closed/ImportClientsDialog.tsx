import { useMemo, useRef, useState } from 'react'
import { DownloadIcon, FileUpIcon, ShieldAlertIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useImportClients } from '@/lib/api/closed'
import { useOrgMembers } from '@/lib/api/loans'
import { useAuth } from '@/lib/auth/context'
import { downloadText } from '@/lib/download'
import { checkClientFile, COLUMNS, importTotals, reportCsv, templateCsv, type CheckedFile, type RowResult, type RowStatus } from '@/lib/import/clients'
import { stageLabel } from '@/lib/pipeline/stages'

type Step = 'pick' | 'preview' | 'done'

const STATUS: Record<RowStatus | 'not_sent', { preview: string; done: string; className: string }> = {
  added: { preview: 'Will add', done: 'Added', className: 'bg-emerald-50 text-emerald-800' },
  updated: { preview: 'Will fill in blanks', done: 'Updated', className: 'bg-sky-50 text-sky-800' },
  unchanged: { preview: 'Already in LOSuite', done: 'No change', className: 'bg-muted text-muted-foreground' },
  skipped: { preview: 'Skipped', done: 'Skipped', className: 'bg-amber-50 text-amber-900' },
  error: { preview: 'Problem', done: 'Not imported', className: 'bg-destructive/10 text-destructive' },
  not_sent: { preview: 'Checking…', done: 'Not sent', className: 'bg-muted text-muted-foreground' },
}

/**
 * Bulk import of current and closed clients from a CSV. Check the file, see
 * what would happen to each row (the database runs the import and undoes it),
 * then save and keep the report.
 */
export function ImportClientsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { state } = useAuth()
  const role = state.status === 'signedIn' ? state.user.role : null
  const members = useOrgMembers()
  const importClients = useImportClients()
  const input = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>('pick')
  const [fileName, setFileName] = useState('')
  const [checked, setChecked] = useState<CheckedFile | null>(null)
  const [results, setResults] = useState<RowResult[]>([])
  const [progress, setProgress] = useState(0)
  const [showGuide, setShowGuide] = useState(false)
  const [filter, setFilter] = useState<'all' | 'problems'>('all')

  const ready = useMemo(() => (checked?.rows ?? []).filter((r) => r.data), [checked])
  const byRow = useMemo(() => new Map(results.map((r) => [r.row, r])), [results])
  const totals = checked ? importTotals(checked.rows, results) : null
  const blocked = !checked || checked.missingRequired.length > 0 || ready.length === 0
  const busy = importClients.isPending

  const reset = () => {
    setStep('pick')
    setFileName('')
    setChecked(null)
    setResults([])
    setProgress(0)
    setFilter('all')
    if (input.current) input.current.value = ''
  }
  const close = (next: boolean) => {
    if (busy) return
    if (!next) reset()
    onOpenChange(next)
  }

  const run = (save: boolean) =>
    importClients.mutate(
      { rows: ready.map((r) => r.data!), save, onProgress: setProgress },
      {
        onSuccess: (r) => {
          setResults(r)
          setProgress(0)
          if (save) {
            setStep('done')
            const t = importTotals(checked!.rows, r)
            toast.success(`Import finished: ${t.added} added, ${t.updated} updated`)
          }
        },
        onError: (e) => {
          setProgress(0)
          toast.error(e.message)
        },
      },
    )

  const pick = async (file: File | undefined) => {
    if (!file) return
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
      toast.error('Choose a .csv file. In Excel or Google Sheets, use Save As / Download as CSV.')
      return
    }
    const text = await file.text()
    const result = checkClientFile(text)
    setFileName(file.name)
    setChecked(result)
    setResults([])
    setStep('preview')
    const rows = result.rows.filter((r) => r.data)
    if (result.missingRequired.length === 0 && rows.length > 0) {
      importClients.mutate(
        { rows: rows.map((r) => r.data!), save: false, onProgress: setProgress },
        { onSuccess: (r) => { setResults(r); setProgress(0) }, onError: (e) => { setProgress(0); toast.error(e.message) } },
      )
    }
  }

  const rowsShown = (checked?.rows ?? []).filter((r) => {
    if (filter === 'all') return true
    const s = byRow.get(r.row)?.status
    return !r.data || s === 'error' || s === 'skipped' || r.warnings.length > 0
  })
  const loNames = new Map((members.data ?? []).map((m) => [m.email.toLowerCase(), m.name]))

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Import clients</DialogTitle>
          <DialogDescription>
            Current and closed clients from a CSV. Each row goes to the loan officer in its lo_email column.
            {role === 'loan_officer' && ' Loan officers can import their own clients only.'}
          </DialogDescription>
        </DialogHeader>

        {step === 'pick' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={() => input.current?.click()}>
                <FileUpIcon />
                Choose CSV file
              </Button>
              <Button variant="outline" onClick={() => downloadText('losuite-client-import-template.csv', templateCsv(), 'text/csv')}>
                <DownloadIcon />
                Download template
              </Button>
              <button type="button" className="text-sm font-medium text-primary hover:underline" onClick={() => setShowGuide((s) => !s)}>
                {showGuide ? 'Hide the column guide' : 'What goes in each column?'}
              </button>
              <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            </div>
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              <li>Nothing is saved until you review every row and click Import.</li>
              <li>People are matched by the old site ID, then email, then phone (closed clients also by name and property address), so importing the same file again doesn't make duplicates.</li>
              <li>An import only fills in blanks. It never overwrites what's already in LOSuite and never moves a file's stage.</li>
              <li>Social Security numbers are never read. Delete that column from the export if it has one.</li>
            </ul>
            {showGuide && <ColumnGuide />}
          </div>
        )}

        {step !== 'pick' && checked && (
          <div className="min-w-0 space-y-3">
            <p className="text-sm">
              <span className="font-medium">{fileName}</span>
              <span className="text-muted-foreground"> · {checked.rows.length} row{checked.rows.length === 1 ? '' : 's'}</span>
            </p>
            {checked.missingRequired.length > 0 && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                The file is missing required column{checked.missingRequired.length === 1 ? '' : 's'}: {checked.missingRequired.join(', ')}. Add {checked.missingRequired.length === 1 ? 'it' : 'them'} (see the template) and choose the file again.
              </p>
            )}
            {checked.sensitiveColumns.length > 0 && (
              <p className="flex items-start gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <ShieldAlertIcon className="mt-0.5 size-4 shrink-0" />
                {checked.sensitiveColumns.join(', ')}: Social Security or tax ID columns were found and not read. Nothing from them is saved.
              </p>
            )}
            {checked.ignoredColumns.length > 0 && (
              <p className="text-xs text-muted-foreground">Columns LOSuite doesn't use (ignored): {checked.ignoredColumns.join(', ')}</p>
            )}

            {totals && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {(['added', 'updated', 'unchanged', 'skipped', 'error'] as const).map((s) => (
                  <span key={s} className={cn('rounded-full px-2.5 py-1 font-medium', STATUS[s].className)}>
                    {totals[s]} {(step === 'done' ? STATUS[s].done : STATUS[s].preview).toLowerCase()}
                  </span>
                ))}
                {busy && <span className="text-muted-foreground">{progress ? `Checking ${progress} of ${ready.length}…` : 'Checking with LOSuite…'}</span>}
                <span className="ml-auto flex gap-1">
                  <Button size="sm" variant={filter === 'all' ? 'secondary' : 'ghost'} onClick={() => setFilter('all')}>All rows</Button>
                  <Button size="sm" variant={filter === 'problems' ? 'secondary' : 'ghost'} onClick={() => setFilter('problems')}>Problems and warnings</Button>
                </span>
              </div>
            )}

            <div className="max-h-[50vh] overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 border-b bg-card text-[11px] tracking-wide text-muted-foreground uppercase">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">Row</th>
                    <th className="px-3 py-2 text-left font-medium">Client</th>
                    <th className="px-3 py-2 text-left font-medium">Loan officer</th>
                    <th className="px-3 py-2 text-left font-medium">Stage</th>
                    <th className="px-3 py-2 text-left font-medium">Result</th>
                    <th className="px-3 py-2 text-left font-medium">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rowsShown.map((r) => {
                    const result = byRow.get(r.row)
                    const status: RowStatus | 'not_sent' = !r.data ? 'error' : (result?.status ?? 'not_sent')
                    const details = [...r.errors, result?.message, result?.matched_by && `Matched by ${result.matched_by}.`, ...r.warnings].filter(Boolean)
                    return (
                      <tr key={r.row} className="align-top">
                        <td className="px-3 py-2 tabular-nums text-muted-foreground">{r.row}</td>
                        <td className="px-3 py-2 font-medium">{r.name}</td>
                        <td className="px-3 py-2">{loNames.get(r.loEmail.toLowerCase()) ?? r.loEmail ?? '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{r.stage ? stageLabel(r.stage) : '—'}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', STATUS[status].className)}>
                            {step === 'done' ? STATUS[status].done : STATUS[status].preview}
                          </span>
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">{details.join(' ') || '—'}</td>
                      </tr>
                    )
                  })}
                  {rowsShown.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">No problems or warnings.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <DialogFooter>
          {step === 'preview' && (
            <>
              <Button variant="ghost" className="mr-auto" disabled={busy} onClick={reset}>Choose another file</Button>
              <Button variant="outline" disabled={busy} onClick={() => close(false)}>Cancel</Button>
              <Button
                disabled={blocked || busy || results.length === 0 || (totals?.added ?? 0) + (totals?.updated ?? 0) === 0}
                onClick={() => run(true)}
              >
                {busy && results.length > 0 ? `Importing${progress ? ` ${progress} of ${ready.length}` : ''}…` : `Import ${(totals?.added ?? 0) + (totals?.updated ?? 0)} row${(totals?.added ?? 0) + (totals?.updated ?? 0) === 1 ? '' : 's'}`}
              </Button>
            </>
          )}
          {step === 'done' && checked && (
            <>
              <Button variant="outline" className="mr-auto" onClick={() => downloadText(`import-report-${fileName.replace(/\.csv$/i, '')}.csv`, reportCsv(checked.rows, results), 'text/csv')}>
                <DownloadIcon />
                Download report
              </Button>
              <Button onClick={() => close(false)}>Done</Button>
            </>
          )}
          {step === 'pick' && <Button variant="outline" onClick={() => close(false)}>Cancel</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Every column with whether it's needed and how to write it. */
function ColumnGuide() {
  const groups = [...new Set(COLUMNS.map((c) => c.group))]
  return (
    <div className="max-h-[45vh] overflow-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="sticky top-0 border-b bg-card text-[11px] tracking-wide text-muted-foreground uppercase">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Column</th>
            <th className="px-3 py-2 text-left font-medium">Needed?</th>
            <th className="px-3 py-2 text-left font-medium">How to write it</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g} className="divide-y">
            <tr className="bg-muted/40">
              <td colSpan={3} className="px-3 py-1.5 text-xs font-semibold tracking-wide text-primary uppercase">{g}</td>
            </tr>
            {COLUMNS.filter((c) => c.group === g).map((c) => (
              <tr key={c.key} className="align-top">
                <td className="px-3 py-1.5 font-mono text-xs">{c.key}</td>
                <td className="px-3 py-1.5 text-xs">{c.required ? <span className="font-medium text-destructive">Required</span> : (c.when ?? 'Optional')}</td>
                <td className="px-3 py-1.5 text-xs text-muted-foreground">{c.format}</td>
              </tr>
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}
