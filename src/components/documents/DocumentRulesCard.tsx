import { useState } from 'react'
import { PlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Card, FormGrid, Input, Select, TextArea, ToggleChip, ToggleChipGroup, confirmAction } from '@/components/shared'
import { MORTGAGE_TYPE_OPTIONS, OCCUPANCY_OPTIONS, PROPERTY_TYPE_OPTIONS } from '@/components/profile/options'
import { CONDITION_LABEL, useDeleteDocumentRule, useDocumentRules, useSaveDocumentRule, type RuleDraft, type SavedRule } from '@/lib/api/documentRules'
import { DOCUMENT_KIND_GROUPS, DOCUMENT_KIND_LABEL, type DocumentKind } from '@/lib/api/documents'
import { useLenders } from '@/lib/api/lenders'
import type { IncomeDocType } from '@/lib/api/types'
import { NO_RULE_FILTERS, hasFilters, type RuleFilters } from '@/lib/conditions/ruleFilters'
import { CONDITION_PARTIES } from '@/lib/loanfile/conditions'
import { PURPOSES } from '@/lib/pipeline/stages'
import { DOC_TYPE_LABEL } from '@/lib/prequal/readiness'
import type { DocumentCondition } from '@/lib/prequal/nextStep'

const DOC_OPTIONS = (Object.keys(DOC_TYPE_LABEL) as IncomeDocType[]).map((v) => ({ value: v, label: DOC_TYPE_LABEL[v] }))
const STAGE_OPTIONS: { value: RuleFilters['stage']; label: string }[] = [
  { value: 'application', label: 'At application' },
  { value: 'processing', label: 'In processing' },
  { value: 'before_closing', label: 'Before closing' },
]
const ANY = 'any'
const flagValue = (v: boolean | null) => (v == null ? ANY : v ? 'yes' : 'no')
const flagFrom = (v: string) => (v === ANY ? null : v === 'yes')

/** A row of chips that picks any number of values; none picked = any. */
function MultiChips<T extends string>({ label, options, value, onChange }: { label: string; options: readonly { value: T; label: string }[]; value: T[] | null; onChange: (v: T[] | null) => void }) {
  const picked = value ?? []
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted-foreground">{label}{picked.length ? '' : ' · any'}</p>
      <ToggleChipGroup>
        {options.map((o) => (
          <ToggleChip key={o.value} label={o.label} pressed={picked.includes(o.value)} onChange={(on) => onChange(on ? [...picked, o.value] : picked.filter((x) => x !== o.value).length ? picked.filter((x) => x !== o.value) : null)} />
        ))}
      </ToggleChipGroup>
    </div>
  )
}

/** "Purchase · VA · Condo" for the list. */
function filterSummary(r: SavedRule): string {
  const names = <T extends string>(opts: readonly { value: T; label: string }[], v: T[] | null) => (v ?? []).map((x) => opts.find((o) => o.value === x)?.label ?? x)
  return [
    ...names(PURPOSES, r.purposes),
    ...names(MORTGAGE_TYPE_OPTIONS, r.mortgageTypes),
    ...names(OCCUPANCY_OPTIONS, r.occupancies),
    ...names(PROPERTY_TYPE_OPTIONS, r.propertyTypes),
    ...names(DOC_OPTIONS, r.incomeDocTypes),
    r.texasCashOut === true ? 'Texas cash-out' : r.texasCashOut === false ? 'Not Texas cash-out' : null,
    r.entityVesting ? 'Vests in an LLC' : null,
    r.vaExempt ? 'VA exempt' : null,
    r.lenderId ? 'One lender' : null,
    r.programId ? 'One program' : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

const CONDITIONS = Object.keys(CONDITION_LABEL) as DocumentCondition[]
const CONDITION_OPTIONS = CONDITIONS.map((c) => ({ value: c, label: CONDITION_LABEL[c] }))
const KIND_OPTIONS = DOCUMENT_KIND_GROUPS.flatMap((g) => g.kinds.map(([value, label]) => ({ value: value as DocumentKind, label })))

function RuleDialog({ initial, phase8, onClose }: { initial: RuleDraft; phase8: boolean; onClose: () => void }) {
  const [r, setR] = useState(initial)
  const save = useSaveDocumentRule()
  const lenders = useLenders()
  const set = <K extends keyof RuleDraft>(key: K) => (value: RuleDraft[K]) => setR((s) => ({ ...s, [key]: value }))
  const lenderOptions = [{ value: ANY, label: 'Any lender' }, ...(lenders.data ?? []).map((l) => ({ value: l.id, label: l.name }))]
  const programOptions = [{ value: ANY, label: 'Any program' }, ...((lenders.data ?? []).find((l) => l.id === r.lenderId)?.programs ?? []).filter((p) => p.active).map((p) => ({ value: p.id, label: p.name }))]

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{r.id ? 'Edit checklist item' : 'New checklist item'}</DialogTitle>
          <DialogDescription>Asked for on every file where it applies. {'{income}'} becomes the income type (e.g. Social Security) and {'{each_job}'} adds "for each job" when someone has more than one.</DialogDescription>
        </DialogHeader>
        <FormGrid className="lg:grid-cols-1">
          {r.id ? (
            <Input label="Asked for when" value={CONDITION_LABEL[r.condition]} readOnly />
          ) : (
            <Select label="Asked for when" value={r.condition} options={CONDITION_OPTIONS} onChange={set('condition')} />
          )}
          <Input label="Short wording" value={r.shortText} onChange={set('shortText')} required hint="Used inside sentences, e.g. in a text: “pay stubs (last 30 days)”" />
          <TextArea label="Full wording" value={r.fullText} onChange={set('fullText')} required rows={2} hint="Used in emails and on the Documents tab checklist." />
          <Select label="Document type" value={r.kind} options={KIND_OPTIONS} onChange={set('kind')} hint="Uploads of this type can be matched to the request." />
        </FormGrid>
        <ToggleChip label="Ask for this" pressed={r.active} onChange={set('active')} />
        {phase8 ? (
          <div className="space-y-3 border-t pt-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Select
                label="Use for"
                value={r.useFor}
                options={[
                  { value: 'both', label: 'Borrower checklist and conditions' },
                  { value: 'conditions', label: 'Conditions only' },
                ]}
                onChange={set('useFor')}
                hint="Conditions only stays out of the document request you send at prequal."
              />
              <Select label="Per" value={r.scope} options={[{ value: 'person', label: 'Each borrower' }, { value: 'file', label: 'Once for the whole file' }]} onChange={set('scope')} />
              <Select label="Who it's on" value={r.party} options={CONDITION_PARTIES} onChange={set('party')} />
              <Select label="When it's needed" value={r.stage} options={STAGE_OPTIONS} onChange={set('stage')} />
            </div>
            <p className="text-sm font-medium">Applies when <span className="font-normal text-muted-foreground">(nothing picked = every file)</span></p>
            <MultiChips label="Purpose" options={PURPOSES} value={r.purposes} onChange={set('purposes')} />
            <MultiChips label="Loan type" options={MORTGAGE_TYPE_OPTIONS} value={r.mortgageTypes} onChange={set('mortgageTypes')} />
            <MultiChips label="Occupancy" options={OCCUPANCY_OPTIONS} value={r.occupancies} onChange={set('occupancies')} />
            <MultiChips label="Property type" options={PROPERTY_TYPE_OPTIONS} value={r.propertyTypes} onChange={set('propertyTypes')} />
            <MultiChips label="Income documentation" options={DOC_OPTIONS} value={r.incomeDocTypes} onChange={set('incomeDocTypes')} />
            <div className="grid gap-3 sm:grid-cols-3">
              <Select label="Texas §50(a)(6) cash-out" value={flagValue(r.texasCashOut)} options={[{ value: ANY, label: 'Any' }, { value: 'yes', label: 'Only these' }, { value: 'no', label: 'Never these' }]} onChange={(v) => set('texasCashOut')(flagFrom(v))} />
              <Select label="Vests in an LLC" value={flagValue(r.entityVesting)} options={[{ value: ANY, label: 'Any' }, { value: 'yes', label: 'Only these' }]} onChange={(v) => set('entityVesting')(flagFrom(v))} />
              <Select label="VA funding fee exempt" value={flagValue(r.vaExempt)} options={[{ value: ANY, label: 'Any' }, { value: 'yes', label: 'Only these' }]} onChange={(v) => set('vaExempt')(flagFrom(v))} />
              <Select label="Lender" value={r.lenderId ?? ANY} options={lenderOptions} onChange={(v) => setR((s) => ({ ...s, lenderId: v === ANY ? null : v, programId: null }))} />
              {r.lenderId && <Select label="Program" value={r.programId ?? ANY} options={programOptions} onChange={(v) => set('programId')(v === ANY ? null : v)} />}
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">Run the suggested conditions script (20270112000000) in Supabase to add "Applies when", who it's on and when it's needed.</p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={save.isPending}
            onClick={() =>
              save.mutate({ ...r, withFilters: phase8 }, {
                onSuccess: () => {
                  toast.success('Checklist saved')
                  onClose()
                },
                onError: (e) => toast.error(e.message),
              })
            }
          >
            {save.isPending ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Settings: which documents to ask for, and when. Owners and admins edit; everyone else can read. */
export function DocumentRulesCard({ canEdit }: { canEdit: boolean }) {
  const rules = useDocumentRules()
  const remove = useDeleteDocumentRule()
  const [editing, setEditing] = useState<RuleDraft | null>(null)
  const list = rules.data ?? []
  // Before the rules script is run, the starter list is shown but can't be saved.
  const installed = list.some((r) => r.id !== r.key)
  // The Phase 8 script adds the starter condition rules (keys cond_…) with the filter columns.
  const phase8 = list.some((r) => r.key.startsWith('cond_'))
  const editable = canEdit && installed
  const groups = CONDITIONS.map((c) => ({ condition: c, rules: list.filter((r) => r.condition === c) })).filter((g) => g.rules.length)
  const nextOrder = Math.max(0, ...list.map((r) => r.sortOrder)) + 10
  const edit = (r: SavedRule) => setEditing({ ...r })

  return (
    <Card
      title="Document checklist"
      description={
        !installed
          ? 'Showing the starter list. Run the document rules script in Supabase to make it editable.'
          : canEdit
            ? 'What to ask for on each file, and the conditions suggested on the Conditions tab. Built-in items can be reworded or turned off; your own items can be deleted.'
            : 'What to ask for on each file. Only owners and admins can change it.'
      }
      action={
        editable && (
          <Button size="sm" variant="outline" onClick={() => setEditing({ ...NO_RULE_FILTERS, id: null, key: null, condition: 'everyone', shortText: '', fullText: '', kind: 'other', sortOrder: nextOrder, active: true })}>
            <PlusIcon />
            Add item
          </Button>
        )
      }
    >
      {rules.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <section key={g.condition}>
              <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{CONDITION_LABEL[g.condition]}</h3>
              <ul className="divide-y">
                {g.rules.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                    <div className={cn('min-w-0 flex-1', !r.active && 'text-muted-foreground')}>
                      <p className={cn('text-sm', !r.active && 'line-through')}>{r.fullText}</p>
                      <p className="text-xs text-muted-foreground">
                        {DOCUMENT_KIND_LABEL[r.kind]}
                        {phase8 && r.useFor === 'conditions' && ' · conditions only'}
                        {phase8 && ` · on ${CONDITION_PARTIES.find((p) => p.value === r.party)?.label ?? r.party}`}
                        {phase8 && r.scope === 'file' && ' · once per file'}
                        {hasFilters(r) && ` · when: ${filterSummary(r)}`}
                        {!r.builtIn && ' · your item'}
                        {!r.active && ' · turned off'}
                      </p>
                    </div>
                    {editable && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => edit(r)}>
                          Edit
                        </Button>
                        {!r.builtIn && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={remove.isPending}
                            onClick={async () => (await confirmAction(`Delete "${r.shortText}"? Files already tracking it keep their item.`, { confirmLabel: 'Delete', destructive: true })) && remove.mutate(r.id, { onSuccess: () => toast.success('Deleted'), onError: (e) => toast.error(e.message) })}
                          >
                            Delete
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      {editing && <RuleDialog initial={editing} phase8={phase8} onClose={() => setEditing(null)} />}
    </Card>
  )
}
