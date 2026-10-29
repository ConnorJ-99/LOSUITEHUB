import { useState } from 'react'
import { Link } from 'react-router'
import { ArrowDownIcon, ArrowUpIcon, ExternalLinkIcon, PlusIcon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, FormGrid, Input, Select, TextArea, ToggleChip, ToggleChipGroup, confirmAction } from '@/components/shared'
import { ProgramDrawer } from '@/components/products/ProgramDrawer'
import { LenderMark } from '@/components/products/ProgramCard'
import { useDeleteProgram, useSaveLender, useSetProgramActive, type Lender, type LenderDocument, type LenderProgram } from '@/lib/api/lenders'
import { CONTACT_ROLES, useAddOverlay, useDeleteLenderContact, useDeleteOverlay, useLenderContacts, useSaveLenderContact, useSetOverlayActive, type LenderContact, type LenderFile, type LenderOverlay } from '@/lib/api/lenderPage'
import { formatCurrency, formatPercent } from '@/lib/format'
import { browseResult, programSummary } from '@/lib/products/browse'
import { groupProducts, licensedLine, type MatrixUpdate, type ProductRow } from '@/lib/products/lenderDetail'
import { OFFER_TAGS, type OfferTag } from '@/lib/products/lenderSummary'
import { LENDER_CHANNELS, LENDER_STATUSES, LIENS, termsSummary } from '@/lib/products/taxonomy'
import type { CatalogLender, ProgramResult } from '@/lib/products/types'
import { stageLabel, type PipelineStage } from '@/lib/pipeline/stages'
import { ProgramDialog } from './ProgramDialog'
import { RuleForm } from './MatrixGridEditor'

const STATUS_CLASS: Record<Lender['status'], string> = {
  approved: 'bg-emerald-50 text-emerald-700',
  pending: 'bg-accent text-accent-foreground',
  not_signed_up: 'bg-amber-50 text-amber-800',
  inactive: 'bg-muted text-muted-foreground',
}
const LIEN_SHORT = { first: '1st', ces: 'CES', heloc: 'HELOC' } as const
const shortDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
const monthYear = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

/** The lender's header: name, status, licensing and comp, the buttons, and the metric strip. */
export function LenderHeader({ lender: l, programs, matrixDate, loans, avgDays, canEdit, onEdit, onUpload }: { lender: Lender; programs: number; matrixDate: { date: string; verified: string | null } | null; loans: { closed: number; active: number }; avgDays: number | null; canEdit: boolean; onEdit: () => void; onUpload: () => void }) {
  const line = [licensedLine(l.states), l.compNotes ? `Broker comp: ${l.compNotes}` : null].filter(Boolean).join(' · ')
  return (
    <div className="mb-4 rounded-2xl border bg-card p-5 shadow-soft">
      <div className="flex flex-wrap items-start gap-4">
        <LenderMark name={l.shortName ?? l.name} className="size-14 rounded-xl text-lg" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl leading-tight">{l.name}</h1>
            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-medium', STATUS_CLASS[l.status])}>{LENDER_STATUSES.label[l.status]}</span>
            <span className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">{LENDER_CHANNELS.label[l.channel]}</span>
          </div>
          {line && <p className="mt-1 text-sm text-muted-foreground">{line}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {l.portalUrl && (
            <Button variant="outline" asChild>
              <a href={l.portalUrl} target="_blank" rel="noopener noreferrer">
                Lender portal
                <ExternalLinkIcon />
              </a>
            </Button>
          )}
          {canEdit && (
            <>
              <Button variant="outline" onClick={onEdit}>
                Edit lender
              </Button>
              <Button onClick={onUpload}>
                <UploadIcon />
                Upload documents
              </Button>
            </>
          )}
        </div>
      </div>
      <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-3 border-t pt-4">
        <Metric label="Programs" value={String(programs)} />
        <Metric label="Matrix" value={matrixDate ? monthYear(matrixDate.date) : 'None yet'} note={matrixDate?.verified ? `verified ${shortDate(matrixDate.verified)}` : undefined} />
        <Metric label="Your loans" value={`${loans.closed} closed · ${loans.active} active`} />
        <Metric label="Avg. app to close" value={avgDays == null ? '—' : `${avgDays} days`} />
        <Metric label="Account executive" value={l.aeName ?? 'Not set'} note={[l.aePhone, l.aeEmail].filter(Boolean).join(' · ') || undefined} />
      </dl>
    </div>
  )
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">
        {value}
        {note && <span className="ml-1.5 text-xs font-normal text-emerald-700">{note}</span>}
      </dd>
    </div>
  )
}

/** The tab strip across the top of the lender's page. */
export function LenderTabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: string; count?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
      {tabs.map((t) => (
        <button key={t.id} type="button" onClick={() => onChange(t.id)} className={cn('rounded-md px-3 py-1.5 text-sm font-medium', value === t.id ? 'bg-card text-primary shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          {t.label}
          {t.count != null && <span className="ml-1 text-xs tabular-nums opacity-70">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

/** The lender's programs grouped by product type, with filter chips; a row opens the same drawer as Product Search. */
export function ProductsTab({ rows, retired, catalogLender, lenderPrograms, verifiedOn, canEdit, lenderId }: { rows: ProductRow[]; retired: ProductRow[]; catalogLender: CatalogLender | null; lenderPrograms: LenderProgram[]; verifiedOn: Map<string, string | null>; canEdit: boolean; lenderId: string }) {
  const [tag, setTag] = useState<OfferTag | null>(null)
  const [showRetired, setShowRetired] = useState(false)
  const [viewing, setViewing] = useState<ProgramResult | null>(null)
  const [editing, setEditing] = useState<LenderProgram | null>(null)
  const setActive = useSetProgramActive(lenderId)
  const removeProgram = useDeleteProgram(lenderId)
  const all = showRetired ? [...rows, ...retired] : rows
  const shown = all.filter((r) => !tag || r.tags.includes(tag))
  const tags = OFFER_TAGS.filter((t) => rows.some((r) => r.tags.includes(t)))
  const toggle = (id: string, active: boolean) => setActive.mutate({ id, active }, { onError: (e) => toast.error(e.message) })
  const remove = async (id: string, name: string) => {
    if (!(await confirmAction(`Delete ${name} with its matrices and rules? This can't be undone. To keep its history, retire it instead.`, { confirmLabel: 'Delete', destructive: true }))) return
    removeProgram.mutate(id, { onSuccess: () => toast.success(`${name} deleted`), onError: (e) => toast.error(e.message) })
  }

  if (rows.length + retired.length === 0) return <p className="rounded-xl border bg-card py-10 text-center text-sm text-muted-foreground">No programs yet. Upload the lender's matrix or guidelines, or type a matrix in the Documents tab.</p>
  return (
    <div className="space-y-3">
      <ToggleChipGroup>
        <ToggleChip label={`All ${rows.length}`} pressed={tag === null} onChange={() => setTag(null)} />
        {tags.map((t) => (
          <ToggleChip key={t} label={`${t} ${rows.filter((r) => r.tags.includes(t)).length}`} pressed={tag === t} onChange={(on) => setTag(on ? t : null)} />
        ))}
      </ToggleChipGroup>
      <div className="overflow-x-auto rounded-xl border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b text-[11px] tracking-wide text-muted-foreground uppercase">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Program</th>
              <th className="px-3 py-2 text-left font-medium">Type</th>
              <th className="px-3 py-2 text-left font-medium">Lien</th>
              <th className="px-3 py-2 text-right font-medium">Min FICO</th>
              <th className="px-3 py-2 text-right font-medium">Max LTV/CLTV</th>
              <th className="px-3 py-2 text-left font-medium">Loan range</th>
              <th className="px-3 py-2 text-left font-medium">Occupancy</th>
              <th className="px-3 py-2 text-left font-medium">Verified</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          {groupProducts(shown).map((g) => (
            <tbody key={g.group} className="divide-y">
              <tr className="bg-muted/40">
                <td colSpan={9} className="px-3 py-1.5 text-xs font-semibold tracking-wide text-primary uppercase">
                  {g.label}
                </td>
              </tr>
              {g.rows.map((r) => {
                const lp = lenderPrograms.find((p) => p.id === r.program.id)
                const verified = verifiedOn.get(r.program.id) ?? null
                return (
                  <tr key={r.program.id} className={cn(!r.program.active && 'text-muted-foreground')}>
                    <td className="min-w-44 px-3 py-2">
                      <p className="font-medium">{r.program.name}</p>
                      <p className="text-xs text-muted-foreground">{[termsSummary(r.program.termOptions), !r.program.active && 'Retired'].filter(Boolean).join(' · ')}</p>
                    </td>
                    <td className="px-3 py-2">
                      <span className="flex flex-wrap gap-1">
                        {r.tags.map((t) => (
                          <span key={t} className="rounded-full border px-2 py-0.5 text-xs">
                            {t}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="px-3 py-2" title={LIENS.label[r.program.lien]}>
                      {LIEN_SHORT[r.program.lien]}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.minFico ?? '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.maxRatio == null ? '—' : `${formatPercent(r.maxRatio, 3)}${r.ratio === 'CLTV' ? ' CLTV' : ''}`}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{r.loanRange ?? <span className="text-xs text-amber-700">No matrix yet</span>}</td>
                    <td className="px-3 py-2">{r.occupancy ?? '—'}</td>
                    <td className="px-3 py-2 tabular-nums text-emerald-700">{verified ? shortDate(verified) : '—'}</td>
                    <td className="px-3 py-2">
                      <span className="flex justify-end gap-1">
                        {catalogLender && r.loanRange && (
                          <Button size="sm" variant="outline" onClick={() => setViewing(browseResult({ program: r.program, lender: catalogLender, summary: programSummary(r.program) }))}>
                            View
                          </Button>
                        )}
                        {canEdit && lp && (
                          <Button size="sm" variant="ghost" onClick={() => setEditing(lp)}>
                            Edit
                          </Button>
                        )}
                        {canEdit && !r.program.active && (
                          <Button size="sm" variant="ghost" disabled={setActive.isPending} onClick={() => toggle(r.program.id, true)}>
                            Put back
                          </Button>
                        )}
                        {canEdit && (
                          <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive" disabled={removeProgram.isPending} onClick={() => remove(r.program.id, r.program.name)}>
                            Delete
                          </Button>
                        )}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          ))}
        </table>
        <p className="border-t px-3 py-2 text-xs text-muted-foreground">
          Showing {shown.length} of {rows.length + retired.length}
          {retired.length > 0 && (
            <>
              {' · '}
              <button type="button" className="font-medium text-primary hover:underline" onClick={() => setShowRetired((s) => !s)}>
                {showRetired ? 'Hide retired programs' : `${retired.length} retired program${retired.length === 1 ? '' : 's'} hidden`}
              </button>
            </>
          )}
        </p>
      </div>
      {viewing && <ProgramDrawer result={viewing} scenario={null} onClose={() => setViewing(null)} />}
      {editing && <ProgramDialog lenderId={lenderId} program={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Overlays & notes
// ---------------------------------------------------------------------------

/** Your own stricter rules for this lender (Product Search applies them), and private notes about it. */
export function OverlaysTab({ lender, overlays, programs, canEdit, onSaveNotes }: { lender: Lender; overlays: LenderOverlay[]; programs: { id: string; name: string }[]; canEdit: boolean; onSaveNotes: (notes: string) => void }) {
  const add = useAddOverlay(lender.id)
  const setActive = useSetOverlayActive(lender.id)
  const remove = useDeleteOverlay(lender.id)
  const [programId, setProgramId] = useState<string | null>(null)
  const [notes, setNotes] = useState(lender.notes ?? '')
  const fail = { onError: (e: Error) => toast.error(e.message) }
  return (
    <div className="space-y-4">
      <Card title="Your overlays" description="Stricter rules you apply to this lender on top of its matrix. Product Search checks them like the lender's own rules.">
        {overlays.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {overlays.map((o) => (
              <li key={o.id} className={cn('flex flex-wrap items-center gap-2 px-3 py-2 text-sm', !o.active && 'text-muted-foreground')}>
                <span className="min-w-0 flex-1">
                  {o.message}
                  <span className="ml-2 text-xs text-muted-foreground">{o.programId ? (programs.find((p) => p.id === o.programId)?.name ?? 'One program') : 'All programs'}</span>
                  {o.severity === 'verify' && <span className="ml-2 text-xs text-amber-700">Verify</span>}
                </span>
                {canEdit && (
                  <>
                    <ToggleChip label={o.active ? 'On' : 'Off'} pressed={o.active} onChange={(active) => setActive.mutate({ id: o.id, active }, fail)} />
                    <Button size="sm" variant="ghost" onClick={async () => (await confirmAction(`Remove the overlay "${o.message}"?`, { confirmLabel: 'Remove', destructive: true })) && remove.mutate(o.id, fail)}>
                      Remove
                    </Button>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <div className="mt-3 space-y-2">
            <FormGrid>
              <Select label="Applies to" value={programId} options={programs.map((p) => ({ value: p.id, label: p.name }))} onChange={setProgramId} onClear={() => setProgramId(null)} placeholder="All of this lender's programs" span={3} />
            </FormGrid>
            <RuleForm onAdd={(rule) => add.mutate({ rule, programId }, { onSuccess: () => toast.success('Overlay added'), ...fail })} />
          </div>
        )}
      </Card>
      <Card title="Your notes" description="Private notes about working with this lender (turn times, who to ask for exceptions).">
        <TextArea label="Notes" value={notes} onChange={setNotes} rows={5} readOnly={!canEdit} />
        {canEdit && (
          <div className="mt-2 flex justify-end">
            <Button size="sm" disabled={notes === (lender.notes ?? '')} onClick={() => onSaveNotes(notes)}>
              Save notes
            </Button>
          </div>
        )}
      </Card>
    </div>
  )
}

/** Saves just the lender's notes (the rest of the lender unchanged). */
export function useSaveLenderNotes(lender: Lender) {
  const save = useSaveLender()
  return (notes: string) => {
    const { programs: _p, documentCount: _d, ...draft } = lender
    save.mutate({ ...draft, notes }, { onSuccess: () => toast.success('Notes saved'), onError: (e) => toast.error(e.message) })
  }
}

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

const blankContact = (): LenderContact => ({ id: null, name: '', role: 'Scenario desk', phone: null, email: null, notes: null })

/** The account executive (from the lender) and everyone else you work with there. */
export function ContactsTab({ lender, canEdit, onEditLender }: { lender: Lender; canEdit: boolean; onEditLender: () => void }) {
  const contacts = useLenderContacts(lender.id)
  const save = useSaveLenderContact(lender.id)
  const remove = useDeleteLenderContact(lender.id)
  const [editing, setEditing] = useState<LenderContact | null>(null)
  const set = <K extends keyof LenderContact>(key: K) => (value: LenderContact[K]) => setEditing((c) => (c ? { ...c, [key]: value } : c))
  return (
    <Card
      title="Contacts"
      action={
        canEdit && (
          <Button size="sm" variant="outline" onClick={() => setEditing(blankContact())}>
            <PlusIcon />
            Add contact
          </Button>
        )
      }
    >
      <ul className="divide-y rounded-lg border">
        <li className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
          <span className="min-w-0 flex-1">
            <span className="font-medium">{lender.aeName ?? 'No account executive yet'}</span> <span className="text-muted-foreground">· Account executive</span>
            <span className="block text-xs text-muted-foreground">{[lender.aePhone, lender.aeEmail].filter(Boolean).join(' · ') || '—'}</span>
          </span>
          {canEdit && (
            <Button size="sm" variant="ghost" onClick={onEditLender}>
              Edit
            </Button>
          )}
        </li>
        {(contacts.data ?? []).map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{c.name}</span> <span className="text-muted-foreground">· {c.role}</span>
              <span className="block text-xs text-muted-foreground">{[c.phone, c.email, c.notes].filter(Boolean).join(' · ') || '—'}</span>
            </span>
            {canEdit && (
              <>
                <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={async () => (await confirmAction(`Remove ${c.name}?`, { confirmLabel: 'Remove', destructive: true })) && remove.mutate(c.id!, { onError: (e) => toast.error(e.message) })}>
                  Remove
                </Button>
              </>
            )}
          </li>
        ))}
      </ul>
      {contacts.error && <p className="mt-2 text-sm text-destructive">{contacts.error.message.includes('lender_contacts') ? 'Run the lender contacts script in Supabase to add contacts.' : contacts.error.message}</p>}
      {editing && (
        <div className="mt-3 space-y-2 rounded-lg border bg-muted/30 p-3">
          <FormGrid>
            <Input label="Name" value={editing.name} onChange={set('name')} placeholder="Scenario desk" span={2} />
            <Select label="Role" value={editing.role} options={CONTACT_ROLES.map((r) => ({ value: r, label: r }))} onChange={set('role')} span={2} />
            <Input label="Phone" value={editing.phone ?? ''} onChange={set('phone')} type="tel" span={2} />
            <Input label="Email" value={editing.email ?? ''} onChange={set('email')} type="email" span={3} />
            <Input label="Notes" value={editing.notes ?? ''} onChange={set('notes')} span={3} />
          </FormGrid>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button size="sm" disabled={save.isPending} onClick={() => save.mutate(editing, { onSuccess: () => (toast.success('Contact saved'), setEditing(null)), onError: (e) => toast.error(e.message) })}>
              Save contact
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Loans
// ---------------------------------------------------------------------------

/** Your files that chose one of this lender's programs. */
export function LoansTab({ files }: { files: LenderFile[] }) {
  if (files.length === 0) return <p className="rounded-xl border bg-card py-10 text-center text-sm text-muted-foreground">No files with this lender yet. A file counts here once you choose one of its programs in Loan · Pricing.</p>
  return (
    <div className="overflow-x-auto rounded-xl border bg-card">
      <table className="w-full text-sm">
        <thead className="border-b text-[11px] tracking-wide text-muted-foreground uppercase">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Borrower</th>
            <th className="px-3 py-2 text-left font-medium">Program</th>
            <th className="px-3 py-2 text-left font-medium">Stage</th>
            <th className="px-3 py-2 text-right font-medium">Loan amount</th>
            <th className="px-3 py-2 text-left font-medium">Closing</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {files.map((f) => (
            <tr key={f.loanId}>
              <td className="px-3 py-2">
                <Link to={`/loans/${f.loanId}`} className="font-medium text-primary hover:underline">
                  {f.borrowerName}
                </Link>
              </td>
              <td className="px-3 py-2">{f.programName}</td>
              <td className="px-3 py-2">{stageLabel(f.stage as PipelineStage) ?? f.stage}</td>
              <td className="px-3 py-2 text-right tabular-nums">{f.loanAmount == null ? '—' : formatCurrency(f.loanAmount)}</td>
              <td className="px-3 py-2 tabular-nums">{f.closingDate ? new Date(`${f.closingDate}T12:00:00`).toLocaleDateString('en-US') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Side panel
// ---------------------------------------------------------------------------

/** Documents with versions, the last matrix update's changes, your notes and contacts. */
export function SidePanel({ lender, documents, update, onAllDocuments, onNotes, onContacts }: { lender: Lender; documents: LenderDocument[]; update: MatrixUpdate | null; onAllDocuments: () => void; onNotes: () => void; onContacts: () => void }) {
  const contacts = useLenderContacts(lender.id)
  const docs = [...documents.filter((d) => d.current), ...documents.filter((d) => !d.current)].slice(0, 4)
  return (
    <div className="space-y-4">
      <Card title="Documents" action={<LinkButton onClick={onAllDocuments}>All {documents.length} ›</LinkButton>}>
        {docs.length === 0 ? (
          <p className="text-sm text-muted-foreground">None yet.</p>
        ) : (
          <ul className="space-y-2.5">
            {docs.map((d) => (
              <li key={d.id} className={cn('flex gap-2.5 text-sm', !d.current && 'text-muted-foreground')}>
                <span className={cn('mt-0.5 rounded border px-1 py-0.5 text-[9px] font-bold', d.current ? 'border-destructive/30 text-destructive' : 'text-muted-foreground')}>PDF</span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{d.title}</span>
                  <span className="block text-xs text-muted-foreground">
                    {d.current ? 'Current' : 'Superseded'}
                    {d.pageCount != null && ` · ${d.pageCount} page${d.pageCount === 1 ? '' : 's'}`} · {d.passageCount} section{d.passageCount === 1 ? '' : 's'} searchable
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Last matrix update">
        {!update ? (
          <p className="text-sm text-muted-foreground">No matrix approved yet.</p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground">Approved {update.approvedAt ? new Date(update.approvedAt).toLocaleDateString('en-US') : ''}</p>
            {update.changes.length === 0 && update.newPrograms.length === 0 && <p className="mt-2 text-sm text-muted-foreground">No limits changed.</p>}
            <ul className="mt-2 space-y-1.5 text-sm">
              {update.changes.slice(0, 6).map((c, i) => (
                <li key={i} className="flex gap-2">
                  <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full', c.direction === 'down' || c.direction === 'dropped' ? 'bg-destructive/10 text-destructive' : 'bg-emerald-50 text-emerald-700')}>
                    {c.direction === 'down' || c.direction === 'dropped' ? <ArrowDownIcon className="size-3" /> : <ArrowUpIcon className="size-3" />}
                  </span>
                  <span>
                    {c.programName} · {c.label}: {c.from == null ? 'not offered' : formatPercent(c.from, 3)} → {c.to == null ? 'not offered' : formatPercent(c.to, 3)}
                  </span>
                </li>
              ))}
              {update.changes.length > 6 && <li className="text-xs text-muted-foreground">and {update.changes.length - 6} more</li>}
              {update.newPrograms.map((n) => (
                <li key={n} className="flex gap-2">
                  <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                    <PlusIcon className="size-3" />
                  </span>
                  New program: {n}
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card title="Your notes" action={<LinkButton onClick={onNotes}>Edit ›</LinkButton>}>
        <p className={cn('text-sm whitespace-pre-line', !lender.notes && 'text-muted-foreground')}>{lender.notes || 'No notes yet.'}</p>
      </Card>

      <Card title="Contacts" action={<LinkButton onClick={onContacts}>All ›</LinkButton>}>
        <ul className="space-y-2 text-sm">
          <li>
            <span className="font-medium">{lender.aeName ?? 'No AE yet'}</span> <span className="text-muted-foreground">· Account executive</span>
            {(lender.aePhone || lender.aeEmail) && <span className="block text-xs text-muted-foreground">{[lender.aePhone, lender.aeEmail].filter(Boolean).join(' · ')}</span>}
          </li>
          {(contacts.data ?? []).slice(0, 3).map((c) => (
            <li key={c.id}>
              <span className="font-medium">{c.name}</span> <span className="text-muted-foreground">· {c.role}</span>
              {(c.phone || c.email) && <span className="block text-xs text-muted-foreground">{[c.phone, c.email].filter(Boolean).join(' · ')}</span>}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  )
}

function LinkButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-sm font-medium text-primary hover:underline">
      {children}
    </button>
  )
}
