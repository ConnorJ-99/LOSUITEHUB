import { useState } from 'react'
import { ClipboardPasteIcon, CopyIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { FormGrid, Input, NumberInput, Select, TextArea, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { formatPercent } from '@/lib/format'
import { parseSquare } from '@/lib/products/matrixImport'
import { CITIZENSHIPS, DOC_TYPES, MATRIX_PROPERTY_TYPES, MATRIX_PURPOSES, OCCUPANCIES, type DocType, type MatrixPurpose } from '@/lib/products/taxonomy'
import { addColumn, addRow, applyPaste, parsePaste, removeColumn, removeRow, RULE_PRESETS, ruleFromInput, setColumnHeader, setRowBand, unitsFor, withCounts, type RulePresetId } from '@/lib/products/typedMatrix'
import type { ReadGrid, ReadRule } from '../../../supabase/functions/assistant/matrix'

const options = <T extends string>(l: { values: readonly T[]; label: Record<T, string> }) => l.values.map((v) => ({ value: v, label: l.label[v] }))
const RATIO_OPTIONS = [
  { value: 'ltv' as const, label: 'Max LTV (1st liens)' },
  { value: 'cltv' as const, label: 'Max CLTV (2nd liens, HELOCs)' },
]

/** Applies a grid edit, or explains why it couldn't be done. */
const attempt = (r: ReadGrid | { error: string }, onChange: (g: ReadGrid) => void) => ('error' in r ? toast.error(r.error) : onChange(r))

/**
 * One grid of a matrix: what it covers, then credit bands × loan amount columns.
 * Every square, band and column header can be typed; a block copied from Excel
 * can be pasted onto any square (or with its headers, to replace the grid).
 * The lender's PDF page shows beside it when there is one.
 */
export function GridEditor({ grid: g, docTypes, pdfUrl, editable, onChange, onCopy, onRemove }: { grid: ReadGrid; docTypes: DocType[]; pdfUrl: string | null; editable: boolean; onChange: (g: ReadGrid) => void; onCopy?: () => void; onRemove?: () => void }) {
  const [pasting, setPasting] = useState(false)
  const [settings, setSettings] = useState(g.values.flat().every((v) => v == null))
  const set = <K extends keyof ReadGrid>(key: K, value: ReadGrid[K]) => onChange(withCounts({ ...g, [key]: value }))
  const setSquare = (ri: number, ci: number, text: string) => {
    const v = parseSquare(text)
    if (v === 'invalid') return toast.error(`"${text}" isn't a percent. Use a number like 85, or leave it blank for not offered.`)
    onChange({ ...g, values: g.values.map((row, r) => (r === ri ? row.map((x, c) => (c === ci ? v : x)) : row)) })
  }
  /** A block with tabs or line breaks fills the grid from this square (or replaces it, if headers were copied too). */
  const pasteAt = (e: React.ClipboardEvent<HTMLInputElement>, row: number, col: number) => {
    const text = e.clipboardData.getData('text/plain')
    if (!/[\t\n]/.test(text.trim())) return
    e.preventDefault()
    const r = applyPaste(g, parsePaste(text), { row, col })
    if ('error' in r) return toast.error(r.error)
    onChange(r)
    toast.success('Pasted')
  }
  const docOptions = (docTypes.length ? docTypes : DOC_TYPES.values).map((d) => ({ value: d, label: DOC_TYPES.label[d] }))
  const describe = [OCCUPANCIES.label[g.occupancy], g.propertyTypes.map((t) => MATRIX_PROPERTY_TYPES.label[t]).join(', '), g.purposes.map((x) => MATRIX_PURPOSES.label[x]).join(', '), DOC_TYPES.label[g.docType], g.unitsMin === g.unitsMax ? `${g.unitsMin} unit${g.unitsMin === 1 ? '' : 's'}` : `${g.unitsMin}–${g.unitsMax} units`].join(' · ')
  const limits = g.values.flat().filter((x): x is number => x != null)

  const table = (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-xs text-muted-foreground">
          <tr>
            <th className="px-2 py-2 text-left font-medium">Credit score</th>
            {g.columns.map((c, ci) => (
              <th key={ci} className="px-1 py-1 text-center font-medium">
                {editable ? (
                  <div className="flex items-center justify-center gap-0.5">
                    <input
                      key={c.label}
                      aria-label={`Loan amount column ${ci + 1}`}
                      defaultValue={c.label}
                      onBlur={(e) => e.target.value.trim() !== c.label && attempt(setColumnHeader(g, ci, e.target.value), onChange)}
                      size={Math.max(8, c.label.length)}
                      className="h-7 min-w-24 rounded border border-transparent bg-transparent px-1 text-center hover:border-border focus:border-ring focus:outline-none"
                    />
                    {g.columns.length > 1 && (
                      <button type="button" aria-label={`Remove column ${c.label}`} className="rounded p-0.5 hover:bg-muted hover:text-destructive" onClick={() => onChange(removeColumn(g, ci))}>
                        <XIcon className="size-3" />
                      </button>
                    )}
                  </div>
                ) : (
                  c.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {g.rows.map((r, ri) => (
            <tr key={ri}>
              <th className="px-1 py-1 text-left font-semibold tabular-nums">
                {editable ? (
                  <div className="flex items-center gap-0.5">
                    <input
                      key={r.label}
                      aria-label={`Credit band ${ri + 1}`}
                      defaultValue={r.label}
                      onBlur={(e) => e.target.value.trim() !== r.label && attempt(setRowBand(g, ri, e.target.value), onChange)}
                      className="h-7 w-20 rounded border border-transparent bg-transparent px-1 tabular-nums hover:border-border focus:border-ring focus:outline-none"
                    />
                    {g.rows.length > 1 && (
                      <button type="button" aria-label={`Remove band ${r.label}`} className="rounded p-0.5 font-normal text-muted-foreground hover:bg-muted hover:text-destructive" onClick={() => onChange(removeRow(g, ri))}>
                        <XIcon className="size-3" />
                      </button>
                    )}
                  </div>
                ) : (
                  r.label || `${r.ficoMin}–${r.ficoMax}`
                )}
              </th>
              {g.columns.map((_, ci) => {
                const v = g.values[ri]?.[ci] ?? null
                const shown = v == null ? '' : String(v)
                return (
                  <td key={ci} className="px-1 py-1 text-center">
                    <input
                      key={shown}
                      aria-label={`${r.label} ${g.columns[ci].label}`}
                      defaultValue={shown}
                      placeholder="—"
                      readOnly={!editable}
                      onPaste={editable ? (e) => pasteAt(e, ri, ci) : undefined}
                      onBlur={(e) => e.target.value.trim() !== shown && setSquare(ri, ci, e.target.value)}
                      className="h-8 w-16 rounded border border-transparent bg-transparent text-center tabular-nums hover:border-border focus:border-ring focus:outline-none"
                    />
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="border-t px-2 py-1.5 text-xs text-muted-foreground">
        {g.rows.length} × {g.columns.length}
        {g.printedRows !== g.rows.length || g.printedColumns !== g.columns.length ? ` · the page shows ${g.printedRows} × ${g.printedColumns}` : ''} · blank = not offered
        {limits.length > 0 && ` · top limit ${formatPercent(Math.max(...limits), 3)}`}
      </p>
      {g.notes && !editable && <p className="border-t px-2 py-1.5 text-xs text-muted-foreground">Notes: {g.notes}</p>}
    </div>
  )

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">
          {g.title || 'Grid'} <span className="font-normal text-muted-foreground">· max {g.ratio.toUpperCase()}{g.page > 0 && ` · p.${g.page}`}</span>
        </h3>
        <p className="text-xs text-muted-foreground">{describe}</p>
      </div>

      {editable && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          <Button size="sm" variant="outline" onClick={() => setPasting(true)}>
            <ClipboardPasteIcon />
            Paste from Excel
          </Button>
          <Button size="sm" variant="outline" onClick={() => onChange(addRow(g))}>
            <PlusIcon />
            Credit band
          </Button>
          <Button size="sm" variant="outline" onClick={() => onChange(addColumn(g))}>
            <PlusIcon />
            Loan amount column
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setSettings((s) => !s)}>
            {settings ? 'Hide grid settings' : 'Grid settings'}
          </Button>
          {onCopy && (
            <Button size="sm" variant="ghost" onClick={onCopy}>
              <CopyIcon />
              Copy grid
            </Button>
          )}
          {onRemove && (
            <Button size="sm" variant="ghost" className="text-destructive" onClick={onRemove}>
              <Trash2Icon />
              Remove grid
            </Button>
          )}
        </div>
      )}

      {editable && settings && (
        <div className="mb-3 space-y-2 rounded-lg border bg-muted/30 p-3">
          <FormGrid>
            <Input label="Grid title" value={g.title} onChange={(v) => set('title', v)} placeholder="Primary · Purchase & R/T" span={2} />
            <Select label="Numbers are" value={g.ratio} options={RATIO_OPTIONS} onChange={(v) => set('ratio', v)} span={2} />
            <Select label="Occupancy" value={g.occupancy} options={options(OCCUPANCIES)} onChange={(v) => set('occupancy', v)} />
            <NumberInput label="PDF page" value={g.page > 0 ? g.page : null} onChange={(v) => set('page', v != null && v > 0 ? Math.round(v) : 0)} maxDecimals={0} />
            <Select label="Doc type" value={g.docType} options={docOptions} onChange={(v) => set('docType', v)} span={2} />
            <Input label="Notes" value={g.notes ?? ''} onChange={(v) => set('notes', v.trim() ? v : null)} placeholder="e.g. Texas 50(a)(6) capped at 80% CLTV" span={4} />
          </FormGrid>
          <ChipLine label="Property types" values={MATRIX_PROPERTY_TYPES.values} labels={MATRIX_PROPERTY_TYPES.label} picked={g.propertyTypes} onToggle={(v, on) => {
            const propertyTypes = on ? [...g.propertyTypes, v] : g.propertyTypes.filter((x) => x !== v)
            onChange(withCounts({ ...g, propertyTypes, ...unitsFor(propertyTypes) }))
          }} />
          <ChipLine label="Purposes" values={MATRIX_PURPOSES.values} labels={MATRIX_PURPOSES.label} picked={g.purposes} onToggle={(v, on) => set('purposes', on ? [...g.purposes, v] : g.purposes.filter((x) => x !== v))} />
          <p className="text-xs text-muted-foreground">A column header can also name an occupancy or purpose (e.g. "Investment" or "Cash-Out ≤ $1M"); it overrides these for that column.</p>
        </div>
      )}

      {pdfUrl ? (
        <div className="grid gap-3 xl:grid-cols-2">
          <div className="overflow-hidden rounded-lg border bg-muted/30">
            <iframe title={`PDF page ${g.page}`} src={`${pdfUrl}#page=${Math.max(1, g.page)}&view=FitH`} className="h-[520px] w-full" loading="lazy" />
          </div>
          {table}
        </div>
      ) : (
        table
      )}

      {pasting && <PasteDialog grid={g} onClose={() => setPasting(false)} onPaste={(next) => (onChange(next), setPasting(false))} />}
    </section>
  )
}

function ChipLine<T extends string>({ label, values, labels, picked, onToggle }: { label: string; values: readonly T[]; labels: Record<T, string>; picked: T[]; onToggle: (v: T, on: boolean) => void }) {
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <ToggleChipGroup>
        {values.map((v) => (
          <ToggleChip key={v} label={labels[v]} pressed={picked.includes(v)} onChange={(on) => onToggle(v, on)} />
        ))}
      </ToggleChipGroup>
    </div>
  )
}

/** Paste a whole block: with the header row and credit scores it replaces the grid; numbers alone fill it from the top-left square. */
function PasteDialog({ grid, onClose, onPaste }: { grid: ReadGrid; onClose: () => void; onPaste: (g: ReadGrid) => void }) {
  const [text, setText] = useState('')
  const parsed = text.trim() ? parsePaste(text) : null
  const result = parsed ? applyPaste(grid, parsed) : null
  const filled = parsed?.values.flat().filter((v) => v != null).length ?? 0
  const blank = parsed ? parsed.values.flat().length - filled : 0
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Paste from Excel</DialogTitle>
          <DialogDescription>In Excel (or the PDF), select the grid with its header row and credit scores, copy it, and paste it here. Numbers alone fill the grid from the top-left square.</DialogDescription>
        </DialogHeader>
        <TextArea label="Copied grid" value={text} onChange={setText} rows={10} className="font-mono text-xs" placeholder={'Credit score\t≤ $150,000\t$150,001 – $250,000\n760+\t90%\t85%\n740 – 759\t90%\t85%'} />
        {parsed && (
          <div className="space-y-1 text-sm">
            <p>
              Read {parsed.rows ? `${parsed.rows.length} credit bands` : `${parsed.values.length} rows of numbers`} × {parsed.columns ? `${parsed.columns.length} loan amount columns` : `${parsed.values[0]?.length ?? 0} columns of numbers`} · {filled} limits, {blank} not offered.
            </p>
            {parsed.columns && <p className="text-xs text-muted-foreground">Columns: {parsed.columns.map((c) => c.label).join(' · ')}</p>}
            {parsed.rows && <p className="text-xs text-muted-foreground">Credit bands: {parsed.rows.map((r) => r.label).join(' · ')}</p>}
            {result && 'error' in result && <p className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">{result.error}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!result || 'error' in result} onClick={() => result && !('error' in result) && onPaste(result)}>
            {parsed?.rows || parsed?.columns ? 'Replace the grid' : 'Fill the grid'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Adds one program-wide rule (max DTI, reserves, seasoning, states...) with its page. */
export function RuleForm({ onAdd }: { onAdd: (r: ReadRule) => void }) {
  const [preset, setPreset] = useState<RulePresetId>('max_dti')
  const [number, setNumber] = useState<number | null>(null)
  const [min, setMin] = useState<number | null>(null)
  const [max, setMax] = useState<number | null>(null)
  const [states, setStates] = useState('')
  const [citizenship, setCitizenship] = useState<string[]>([])
  const [verify, setVerify] = useState(false)
  const [page, setPage] = useState<number | null>(null)
  const [purposes, setPurposes] = useState<MatrixPurpose[]>([])
  const p = RULE_PRESETS.find((r) => r.id === preset)!

  const add = () => {
    const r = ruleFromInput({ preset, number, min, max, list: p.input === 'states' ? [states] : citizenship, severity: verify ? 'verify' : 'hard', page, purposes })
    if ('error' in r) return toast.error(r.error)
    onAdd(r)
    setNumber(null)
    setMin(null)
    setMax(null)
    setStates('')
    setCitizenship([])
    setPurposes([])
  }

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <FormGrid>
        <Select label="Rule" value={preset} options={RULE_PRESETS.map((r) => ({ value: r.id, label: r.label }))} onChange={setPreset} span={3} />
        {p.input === 'number' && <NumberInput label={p.unit ? `Value (${p.unit})` : 'Value'} value={number} onChange={setNumber} maxDecimals={2} />}
        {p.input === 'range' && (
          <>
            <NumberInput label="Min loan ($)" value={min} onChange={setMin} maxDecimals={0} />
            <NumberInput label="Max loan ($)" value={max} onChange={setMax} maxDecimals={0} />
          </>
        )}
        {p.input === 'states' && <Input label="States" value={states} onChange={setStates} placeholder="TX, OK" span={2} />}
        <NumberInput label="PDF page" value={page} onChange={setPage} maxDecimals={0} />
      </FormGrid>
      {p.input === 'citizenship' && <ChipLine label="Allowed" values={CITIZENSHIPS.values} labels={CITIZENSHIPS.label} picked={citizenship as (typeof CITIZENSHIPS.values)[number][]} onToggle={(v, on) => setCitizenship((c) => (on ? [...c, v] : c.filter((x) => x !== v)))} />}
      <ChipLine label="Only for (leave blank for all)" values={MATRIX_PURPOSES.values} labels={MATRIX_PURPOSES.label} picked={purposes} onToggle={(v, on) => setPurposes((ps) => (on ? [...ps, v] : ps.filter((x) => x !== v)))} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleChip label={verify ? 'Verify (shows as a check, never blocks)' : 'Must meet (blocks the program)'} pressed={verify} onChange={setVerify} />
        <Button size="sm" onClick={add}>
          <PlusIcon />
          Add rule
        </Button>
      </div>
    </div>
  )
}

