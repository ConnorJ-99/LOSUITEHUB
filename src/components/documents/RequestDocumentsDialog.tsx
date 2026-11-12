import { useEffect, useMemo, useState } from 'react'
import { PlusIcon, SearchIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DateInput, Input, Select, TextArea, ToggleChip, confirmAction } from '@/components/shared'
import { useConditions } from '@/lib/api/conditions'
import { useShareRecipients } from '@/lib/api/estimateShares'
import { useDeletePreset, useDocumentCatalog, usePresets, useSavePreset, useSendDocumentRequest } from '@/lib/api/uploadRequests'
import type { LoanProfile } from '@/lib/api/types'
import { useAuth } from '@/lib/auth/context'
import { useApplication } from '@/lib/api/urla'
import { employmentDocs } from '@/lib/conditions/employment'
import { todayIso } from '@/lib/dates'
import { CATEGORY_LABEL, ruleKeyOf, type CatalogCategory, type CatalogItem, type PickedItem } from '@/lib/documents/uploadRequests'

const NONE = 'none'
const fromCatalog = (c: CatalogItem, conditionId: string | null): PickedItem => ({ key: c.key, label: c.label, instructions: c.instructions, kind: c.kind, conditionId })

/**
 * Request documents (UI pass Part 3): pick from the catalog or type your own,
 * edit each item's instructions, link items to a condition, set a due date,
 * pick the borrower, and use or save presets. Saving makes the upload link,
 * adds the items to the Documents checklist and puts a draft text and email
 * with the link in the Action Queue. Nothing is sent from here.
 */
export function RequestDocumentsDialog({ loan, conditionId = null, onClose }: { loan: LoanProfile; conditionId?: string | null; onClose: () => void }) {
  const catalog = useDocumentCatalog()
  const presets = usePresets()
  const people = useShareRecipients(loan.id)
  const conditions = useConditions(loan.id)
  const app = useApplication(loan.id)
  const send = useSendDocumentRequest(loan.id)
  const savePreset = useSavePreset(loan.organizationId)
  const deletePreset = useDeletePreset()
  const { state } = useAuth()
  const me = state.status === 'signedIn' ? state.user.id : null
  const [contactId, setContactId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<PickedItem[]>([])
  const [typed, setTyped] = useState('')
  const [dueOn, setDueOn] = useState<string | null>(null)
  const [text, setText] = useState(true)
  const [email, setEmail] = useState(true)
  const [presetName, setPresetName] = useState('')

  const borrowers = (people.data ?? []).filter((p) => p.email || p.phone)
  const person = borrowers.find((p) => p.contactId === contactId) ?? null
  useEffect(() => {
    if (!contactId && borrowers[0]) setContactId(borrowers[0].contactId)
  }, [borrowers, contactId])

  const items = (catalog.data ?? []).filter((c) => c.active)
  const q = search.trim().toLowerCase()
  const shown = q ? items.filter((c) => `${c.label} ${c.instructions}`.toLowerCase().includes(q)) : items
  const groups = (Object.keys(CATEGORY_LABEL) as CatalogCategory[]).map((cat) => ({ cat, items: shown.filter((c) => c.category === cat) })).filter((g) => g.items.length)
  const pickedKeys = useMemo(() => new Set(picked.map(ruleKeyOf)), [picked])
  // Suggested from employment (Stage 3a): the borrower's jobs and dates on the 1003. Nothing is added until Connor checks it.
  const jobs = (app.data?.borrowers.find((b) => b.contactId === contactId)?.employments ?? []).map((j) => ({ id: j.id, employerName: j.employerName, selfEmployed: j.isSelfEmployed, current: j.status === 'current', startDate: j.startDate, endDate: j.endDate }))
  const empDocs = employmentDocs(jobs, todayIso())
  const stubs = empDocs.filter((d) => d.type === 'paystubs')
  const fromJobs: (PickedItem & { why: string })[] = [
    ...(stubs.length ? [{ key: 'paystubs', label: `Pay stubs: ${stubs.map((d) => d.employer).join(', ')}`, instructions: stubs[0].instructions, kind: 'paystub' as const, conditionId, why: stubs.map((d) => d.why).join('; ') }] : []),
    ...empDocs.filter((d) => d.type !== 'paystubs').map((d) => ({ key: null, label: d.label, instructions: d.instructions, kind: d.type === 'w2' ? ('w2' as const) : ('paystub' as const), conditionId, why: d.why })),
  ]
  const togglePicked = (it: PickedItem, on: boolean) => setPicked((p) => (on ? [...p, it] : p.filter((x) => ruleKeyOf(x) !== ruleKeyOf(it))))
  const openConditions = (conditions.data ?? []).filter((c) => c.status !== 'cleared' && c.status !== 'waived')
  const conditionOptions = [{ value: NONE, label: 'No condition' }, ...openConditions.map((c) => ({ value: c.id, label: c.body.length > 60 ? `${c.body.slice(0, 57)}…` : c.body }))]

  const toggle = (c: CatalogItem, on: boolean) => setPicked((p) => (on ? [...p, fromCatalog(c, conditionId)] : p.filter((x) => x.key !== c.key)))
  const addTyped = () => {
    const label = typed.trim()
    if (!label) return
    if (pickedKeys.has(ruleKeyOf({ key: null, label }))) return toast.error('That item is already on the list.')
    setPicked((p) => [...p, { key: null, label, instructions: '', kind: 'other', conditionId }])
    setTyped('')
  }
  const edit = (i: number, patch: Partial<PickedItem>) => setPicked((p) => p.map((x, j) => (j === i ? { ...x, ...patch } : x)))
  const applyPreset = (id: string) => {
    const preset = (presets.data ?? []).find((p) => p.id === id)
    if (!preset) return
    const next = [...picked]
    for (const it of preset.items) {
      const c = it.key ? items.find((x) => x.key === it.key) : null
      const p: PickedItem | null = c ? fromCatalog(c, conditionId) : it.label ? { key: null, label: it.label, instructions: it.instructions ?? '', kind: 'other', conditionId } : null
      if (p && !next.some((x) => ruleKeyOf(x) === ruleKeyOf(p))) next.push(p)
    }
    setPicked(next)
    toast.success(`Added "${preset.name}"`)
  }

  const canText = !!person?.phone && !person.smsOptedOutAt
  const canEmail = !!person?.email && !person.emailOptedOutAt
  const ready = !!person && picked.length > 0 && picked.every((p) => p.label.trim()) && ((text && canText) || (email && canEmail))

  const submit = async () => {
    if (!person || !ready) return
    const how = [text && canText ? 'a text' : null, email && canEmail ? 'an email' : null].filter(Boolean).join(' and ')
    if (!(await confirmAction(`Make the upload link for ${person.name} (${picked.length} item${picked.length === 1 ? '' : 's'}) and save ${how} as drafts in the Action Queue? Nothing is sent until you send it there.`, { confirmLabel: 'Make drafts' }))) return
    send.mutate(
      { organizationId: loan.organizationId, loanId: loan.id, borrower: person, picked, dueOn, loName: loan.assignedLo?.name ?? 'MPS Mortgage', text: text && canText, email: email && canEmail },
      {
        onSuccess: (r) => {
          const skipped = r.plan.skip.length ? ` Not asked again: ${r.plan.skip.map((s) => `${s.label} (${s.why})`).join(', ')}.` : ''
          toast.success(`Link made and ${r.drafts} draft${r.drafts === 1 ? '' : 's'} saved to the Action Queue.${skipped}`, {
            duration: 12000,
            action: { label: 'Copy link', onClick: () => void navigator.clipboard.writeText(r.url).then(() => toast.success('Link copied')) },
          })
          onClose()
        },
        onError: (e) => toast.error(/document_upload_links|catalog_key|link_id/.test(e.message) ? 'Run the upload links script (20270113000000) in Supabase first.' : e.message),
      },
    )
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !send.isPending && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Request documents</DialogTitle>
          <DialogDescription>Pick what you need. The borrower gets a secure upload page with only these items; the text and email wait in the Action Queue for you to send.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <Select label="Borrower" value={contactId} onChange={setContactId} options={borrowers.map((b) => ({ value: b.contactId, label: `${b.name}${b.role === 'co_borrower' ? ' (co-borrower)' : ''}` }))} placeholder={people.isLoading ? 'Loading…' : 'No borrower with a phone or email'} />
          <DateInput label="Due date" value={dueOn} onChange={setDueOn} hint="Optional; reminders are drafted after it" />
          <Select label="Add a preset" value={null} onChange={applyPreset} options={(presets.data ?? []).map((p) => ({ value: p.id, label: `${p.name} (${p.items.length})` }))} placeholder={(presets.data ?? []).length ? 'Pick a preset…' : 'No presets yet'} />
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <section className="min-w-0">
            {fromJobs.length > 0 && (
              <div className="mb-3 rounded-md border border-primary/20 bg-primary/5 p-2">
                <p className="text-[0.65rem] font-semibold tracking-wide text-primary uppercase">Suggested from employment</p>
                <ul className="mt-1 space-y-1">
                  {fromJobs.map(({ why, ...it }) => (
                    <li key={ruleKeyOf(it)} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 text-sm" title={it.instructions}>
                        {it.label}
                        <span className="block text-xs text-muted-foreground">{why}</span>
                      </span>
                      <ToggleChip label={pickedKeys.has(ruleKeyOf(it)) ? 'Added' : 'Add'} pressed={pickedKeys.has(ruleKeyOf(it))} onChange={(on) => togglePicked(it, on)} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the catalog" aria-label="Search the catalog" className="h-9 w-full rounded-md border pr-3 pl-8 text-sm focus:border-ring focus:outline-none" />
            </div>
            <div className="mt-2 max-h-80 space-y-3 overflow-y-auto pr-1">
              {catalog.isLoading ? (
                <p className="text-sm text-muted-foreground">Loading…</p>
              ) : items.length === 0 ? (
                <p className="text-sm text-muted-foreground">The catalog is empty. Run the upload links script (20270113000000) in Supabase, or type your own items.</p>
              ) : (
                groups.map((g) => (
                  <div key={g.cat}>
                    <p className="text-[0.65rem] font-semibold tracking-wide text-muted-foreground uppercase">{CATEGORY_LABEL[g.cat]}</p>
                    <ul className="mt-1 space-y-1">
                      {g.items.map((c) => (
                        <li key={c.id} className="flex items-center justify-between gap-2">
                          <span className="min-w-0 text-sm" title={c.instructions}>
                            {c.label}
                            {c.period && <span className="text-xs text-muted-foreground"> · {c.period}</span>}
                          </span>
                          <ToggleChip label={pickedKeys.has(c.key) ? 'Added' : 'Add'} pressed={pickedKeys.has(c.key)} onChange={(on) => toggle(c, on)} />
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </div>
            <div className="mt-3 flex gap-2 border-t pt-3">
              <input value={typed} onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTyped()} placeholder="Type your own item" aria-label="Type your own item" className="h-9 min-w-0 flex-1 rounded-md border px-3 text-sm focus:border-ring focus:outline-none" />
              <Button size="sm" variant="outline" onClick={addTyped} disabled={!typed.trim()}>
                <PlusIcon />
                Add
              </Button>
            </div>
          </section>

          <section className="min-w-0">
            <p className="text-sm font-medium">
              Asking for {picked.length || 'nothing yet'}
              {picked.length > 0 && <span className="font-normal text-muted-foreground"> · edit what the borrower sees</span>}
            </p>
            <ul className="mt-2 max-h-96 space-y-2 overflow-y-auto pr-1">
              {picked.map((p, i) => (
                <li key={ruleKeyOf(p)} className="rounded-md border p-2">
                  <div className="flex items-center gap-2">
                    {p.key ? <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.label}</span> : <Input label="Item" hideLabel value={p.label} onChange={(label) => edit(i, { label })} className="flex-1" />}
                    <Button size="icon-sm" variant="ghost" aria-label={`Remove ${p.label}`} onClick={() => setPicked((x) => x.filter((_, j) => j !== i))}>
                      <XIcon />
                    </Button>
                  </div>
                  <TextArea label="Instructions for the borrower" value={p.instructions} onChange={(instructions) => edit(i, { instructions })} rows={2} placeholder="What the borrower should send" />
                  {openConditions.length > 0 && (
                    <div className="mt-1.5">
                      <Select label="For condition" value={p.conditionId ?? NONE} onChange={(v) => edit(i, { conditionId: v === NONE ? null : v })} options={conditionOptions} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {picked.length > 0 && (
              <div className="mt-2 flex gap-2">
                <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Save these as a preset…" aria-label="Preset name" className="h-8 min-w-0 flex-1 rounded-md border px-2 text-xs focus:border-ring focus:outline-none" />
                <Button
                  size="xs"
                  variant="outline"
                  disabled={!presetName.trim() || savePreset.isPending}
                  onClick={() => savePreset.mutate({ name: presetName, items: picked }, { onSuccess: () => (toast.success('Preset saved'), setPresetName('')), onError: (e) => toast.error(e.message) })}
                >
                  Save preset
                </Button>
              </div>
            )}
            {(presets.data ?? []).some((p) => p.createdBy === me) && (
              <p className="mt-2 text-xs text-muted-foreground">
                Your presets:{' '}
                {(presets.data ?? [])
                  .filter((p) => p.createdBy === me)
                  .map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="mr-2 hover:text-destructive"
                      title="Delete this preset"
                      onClick={async () => (await confirmAction(`Delete the preset "${p.name}"?`, { confirmLabel: 'Delete', destructive: true })) && deletePreset.mutate(p.id, { onError: (e) => toast.error(e.message) })}
                    >
                      {p.name} ×
                    </button>
                  ))}
              </p>
            )}
          </section>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <span className="text-sm text-muted-foreground">Drafts:</span>
          <ToggleChip label={canText ? 'Text with the link' : 'Text (no phone or opted out)'} pressed={text && canText} disabled={!canText} onChange={setText} />
          <ToggleChip label={canEmail ? 'Email with the list' : 'Email (no email or opted out)'} pressed={email && canEmail} disabled={!canEmail} onChange={setEmail} />
          <span className={cn('text-xs text-muted-foreground', !person && 'text-destructive')}>{person ? `The link works for 14 days and opens after ${person.firstName} confirms their email.` : 'Add a phone or email for the borrower first.'}</span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={send.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} disabled={!ready || send.isPending}>
            {send.isPending ? 'Making…' : 'Make link and drafts'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
