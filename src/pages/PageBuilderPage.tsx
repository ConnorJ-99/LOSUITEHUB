// The page builder (Pages, 2026-11-06; mockup docs/design-reference/pages/Form builder.png).
// Blocks on the left, the live preview in the middle (Phone / Desktop), the
// selected block on the right. Saves on its own. On a phone: one column with
// a Preview button.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ArrowDownIcon, ArrowLeftIcon, ArrowUpIcon, CopyIcon, EyeIcon, ExternalLinkIcon, GripVerticalIcon, ImageUpIcon, InboxIcon, Loader2Icon, SettingsIcon, Trash2Icon, TriangleAlertIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Card, confirmAction, EmptyState, Input, Select, TextArea, ToggleChip, ToggleChipGroup } from '@/components/shared'
import { PageRenderer } from '@/components/pages/PageRenderer'
import { FinancingTable, LivePageCard, PropertyPanel, SignInsCard } from '@/components/pages/OpenHouseEditor'
import { FlyerCard } from '@/components/pages/FlyerCard'
import { useOrgMembers } from '@/lib/api/loans'
import { usePartners } from '@/lib/api/partners'
import { useFeeTemplates } from '@/lib/api/pricing'
import { openHouseTag, readProperty, refigure, type OpenHouseProperty } from '@/lib/pages/openHouse'
import { publishHeadshot, uploadPageImage, useDeletePage, usePage, useSavePage, type PageRecord, type PagePatch } from '@/lib/api/pages'
import { useProfile } from '@/lib/api/settings'
import { useAuth } from '@/lib/auth/context'
import { newBlockId, PAGE_TYPE_LABEL } from '@/lib/pages/templates'
import { pageAddress, StatusBadge } from './PagesPage'
import {
  blockTypeLabel,
  CONTENT_TYPES,
  FIELD_TYPES,
  hasOptions,
  isField,
  isForbiddenLabel,
  isSafeHref,
  isValidSlug,
  MAPS_TO,
  publishProblems,
  type Block,
  type BlockType,
  type FieldType,
  type MapsTo,
  type PageSettings,
} from '../../supabase/functions/page-submit/blocks'

const SAVE_DELAY_MS = 800

function newBlock(type: BlockType): Block {
  const id = newBlockId()
  if (type === 'heading') return { id, type, text: 'Heading' }
  if (type === 'text') return { id, type, text: 'Write something here.' }
  if (type === 'button') return { id, type, text: 'Book a call', href: 'https://' }
  if (!isField(type)) return { id, type }
  return { id, type, label: blockTypeLabel(type), required: false, options: hasOptions(type) ? ['Option 1', 'Option 2'] : undefined, mapsTo: type === 'email' ? 'email' : type === 'phone' ? 'phone' : null }
}

const blockSummary = (b: Block) => `${blockTypeLabel(b.type)} · ${(isField(b.type) ? b.label : b.type === 'lo_card' ? 'Page owner' : b.type === 'footer' ? 'NMLS · Equal Housing' : b.text) || '—'}`

// ---------------------------------------------------------------------------
// Inspector: the selected block's settings
// ---------------------------------------------------------------------------

function Inspector({ block, onChange, onMove, onDuplicate, onDelete, organizationId, pageId, settings, ownerName }: {
  block: Block | null
  onChange: (b: Block) => void
  onMove: (dir: -1 | 1) => void
  onDuplicate: () => void
  onDelete: () => void
  organizationId: string
  pageId: string
  settings: PageSettings
  ownerName: string
}) {
  const [uploading, setUploading] = useState(false)
  const imageInput = useRef<HTMLInputElement>(null)
  if (!block) return <p className="text-sm text-muted-foreground">Click a block in the preview, or add one from the left.</p>
  const set = (patch: Partial<Block>) => onChange({ ...block, ...patch })
  const field = isField(block.type)
  const mapChoices = MAPS_TO.filter((m) => m.types.includes(block.type as FieldType))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-base font-bold">{blockTypeLabel(block.type)}{field ? ' field' : ''}</h3>
        <div className="flex gap-0.5">
          <Button size="icon-sm" variant="ghost" title="Move up" onClick={() => onMove(-1)}>
            <ArrowUpIcon />
          </Button>
          <Button size="icon-sm" variant="ghost" title="Move down" onClick={() => onMove(1)}>
            <ArrowDownIcon />
          </Button>
          <Button size="icon-sm" variant="ghost" title="Duplicate" onClick={onDuplicate}>
            <CopyIcon />
          </Button>
          <Button size="icon-sm" variant="ghost" title="Delete" className="text-destructive hover:text-destructive" onClick={onDelete}>
            <Trash2Icon />
          </Button>
        </div>
      </div>

      {(block.type === 'heading' || block.type === 'text' || block.type === 'button') &&
        (block.type === 'text' ? <TextArea label="Text" rows={4} value={block.text ?? ''} onChange={(v) => set({ text: v })} /> : <Input label={block.type === 'button' ? 'Button text' : 'Heading'} value={block.text ?? ''} onChange={(v) => set({ text: v })} />)}
      {block.type === 'heading' && <ToggleChip label="Show in the top band" pressed={!!block.hero} onChange={(v) => set({ hero: v })} />}
      {block.type === 'button' && <Input label="Link" value={block.href ?? ''} onChange={(v) => set({ href: v.trim() })} hint="https://…, tel:… or mailto:…" error={block.href && block.href !== 'https://' && !isSafeHref(block.href) ? 'Use an https://, tel: or mailto: link.' : undefined} />}
      {block.type === 'image' && (
        <div className="space-y-2">
          {block.url && <img src={block.url} alt="" className="w-full rounded-lg border" />}
          <Button variant="outline" size="sm" disabled={uploading} onClick={() => imageInput.current?.click()}>
            {uploading ? <Loader2Icon className="animate-spin" /> : <ImageUpIcon />}
            {block.url ? 'Replace image' : 'Upload image'}
          </Button>
          <input
            ref={imageInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              setUploading(true)
              try {
                set({ url: await uploadPageImage(organizationId, pageId, f) })
              } catch (err) {
                toast.error((err as Error).message)
              } finally {
                setUploading(false)
              }
            }}
          />
          <Input label="Description (for screen readers)" value={block.alt ?? ''} onChange={(v) => set({ alt: v })} />
          <p className="text-xs text-muted-foreground">Images are public: anyone with the page link can see them.</p>
        </div>
      )}
      {block.type === 'lo_card' && <p className="text-sm text-muted-foreground">Fills itself from the page owner's profile in Settings: name, NMLS, phone, email and photo ({ownerName}).</p>}
      {block.type === 'footer' && <p className="text-sm text-muted-foreground">MPS Mortgage LLC · NMLS #2501110 · Equal Housing Opportunity · This is not a commitment to lend.</p>}
      {block.type === 'divider' && <p className="text-sm text-muted-foreground">A thin line between sections.</p>}

      {field && (
        <>
          <Input label="Label" required value={block.label ?? ''} onChange={(v) => set({ label: v })} error={isForbiddenLabel(block.label) ? "Pages can't ask for an SSN or date of birth." : undefined} />
          {block.type !== 'choice' && block.type !== 'checkboxes' && block.type !== 'yes_no' && block.type !== 'file' && <Input label="Placeholder" value={block.placeholder ?? ''} onChange={(v) => set({ placeholder: v })} />}
          <Input label="Help text" value={block.help ?? ''} onChange={(v) => set({ help: v })} />
          {hasOptions(block.type) && <TextArea label="Choices (one per line)" rows={5} value={(block.options ?? []).join('\n')} onChange={(v) => set({ options: v.split('\n').map((o) => o.slice(0, 120)) })} />}
          <ToggleChip label="Required" pressed={!!block.required} onChange={(v) => set({ required: v })} />
          {mapChoices.length > 0 && (
            <div className="space-y-1.5 border-t pt-4">
              <Select<MapsTo | 'none'>
                label="Maps to borrower field"
                value={block.mapsTo ?? 'none'}
                onChange={(v) => set({ mapsTo: v === 'none' ? null : v })}
                options={[{ value: 'none', label: 'Nothing (answer only)' }, ...mapChoices.map((m) => ({ value: m.key, label: m.label }))]}
              />
              <p className="text-xs text-muted-foreground">A new lead gets this answer. On someone who already has a file it shows as a proposed update you accept or reject. Nothing is overwritten automatically.</p>
            </div>
          )}
        </>
      )}

      <div className="space-y-2 border-t pt-4 text-sm">
        <p className="font-semibold">When someone submits</p>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          {settings.leadKind === 'partner' ? (
            <li>Added to the Partner center (matched by email or phone)</li>
          ) : (
            <>
              <li>Match by email or phone, else a new lead</li>
              <li>Assigned to {ownerName} · GHL contact matched</li>
              <li>Tagged: {[...(settings.tags ?? [])].join(', ') || 'the page name'}</li>
              <li>Follow-up text and email drafted → your approval queue</li>
            </>
          )}
        </ul>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page settings
// ---------------------------------------------------------------------------

function SettingsDialog({ page, title, slug, settings, ownerId, onSave, onClose, isAdmin }: {
  page: PageRecord
  title: string
  slug: string
  settings: PageSettings
  ownerId: string | null
  onSave: (p: { title: string; slug: string; settings: PageSettings; ownerId: string | null }) => void
  onClose: () => void
  isAdmin: boolean
}) {
  const members = useOrgMembers()
  const [t, setT] = useState(title)
  const [s, setS] = useState(slug)
  const [st, setSt] = useState<PageSettings>(settings)
  const [owner, setOwner] = useState(ownerId)
  const [tags, setTags] = useState((settings.tags ?? []).join(', '))
  const [uploading, setUploading] = useState(false)
  const set = (patch: Partial<PageSettings>) => setSt((x) => ({ ...x, ...patch }))
  const slugError = s && !isValidSlug(s) ? 'Lowercase letters, numbers and dashes.' : undefined
  const redirectError = st.redirectUrl && !/^https:\/\/\S+\.\S+/.test(st.redirectUrl) ? 'Use an https:// address.' : undefined

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Page settings</DialogTitle>
          <DialogDescription>{PAGE_TYPE_LABEL[page.type]} · {pageAddress(s || page.slug)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Input label="Title" required value={t} onChange={setT} />
          <Input label="Web address" required value={s} onChange={(v) => setS(v.toLowerCase().replace(/\s+/g, '-'))} hint={page.status === 'published' ? 'Changing it breaks links you already shared.' : `/p/${s || '…'}`} error={slugError} />
          <Input label="Button text" value={st.submitLabel ?? ''} onChange={(v) => set({ submitLabel: v })} placeholder="Send" />
          <Input label="Thank-you title" value={st.successTitle ?? ''} onChange={(v) => set({ successTitle: v })} placeholder="Got it — thanks!" />
          <TextArea label="Thank-you message" rows={3} value={st.successMessage ?? ''} onChange={(v) => set({ successMessage: v })} />
          <Input label="Or send them to (optional)" value={st.redirectUrl ?? ''} onChange={(v) => set({ redirectUrl: v.trim() || undefined })} placeholder="https://mps.mortgage/thank-you" error={redirectError} />
          <Input label="Tags on submissions" value={tags} onChange={setTags} hint="Comma-separated. The page name is always added." />
          <ToggleChipGroup>
            <ToggleChip label="Notify me of submissions" pressed={st.notify !== false} onChange={(v) => set({ notify: v })} />
            <ToggleChip label="Call / text consent box" pressed={st.consent !== false} onChange={(v) => set({ consent: v })} />
            <ToggleChip label="Partner sign-up (Partner center, not a lead)" pressed={st.leadKind === 'partner'} onChange={(v) => set({ leadKind: v ? 'partner' : 'lead' })} />
          </ToggleChipGroup>
          {isAdmin && (
            <Select
              label="Owner"
              value={owner ?? ''}
              onChange={(v) => setOwner(v || null)}
              options={(members.data ?? []).map((m) => ({ value: m.id, label: m.name }))}
              hint="Leads from this page are assigned to the owner."
            />
          )}
          <div className="space-y-3 border-t pt-4">
            <p className="text-sm font-semibold">Search and sharing</p>
            <Input label="Search title" value={st.seoTitle ?? ''} onChange={(v) => set({ seoTitle: v || undefined })} placeholder={`${t} · MPS Mortgage`} />
            <TextArea label="Search description" rows={2} value={st.seoDescription ?? ''} onChange={(v) => set({ seoDescription: v || undefined })} />
            <div className="flex items-center gap-3">
              {st.ogImage && <img src={st.ogImage} alt="" className="h-16 w-28 rounded border object-cover" />}
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-accent">
                {uploading ? <Loader2Icon className="size-4 animate-spin" /> : <ImageUpIcon className="size-4" />}
                {st.ogImage ? 'Replace share image' : 'Share image'}
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="hidden"
                  onChange={async (e) => {
                    const f = e.target.files?.[0]
                    e.target.value = ''
                    if (!f) return
                    setUploading(true)
                    try {
                      set({ ogImage: await uploadPageImage(page.organizationId, page.id, f) })
                    } catch (err) {
                      toast.error((err as Error).message)
                    } finally {
                      setUploading(false)
                    }
                  }}
                />
              </label>
              {st.ogImage && (
                <Button size="sm" variant="ghost" onClick={() => set({ ogImage: undefined })}>
                  Remove
                </Button>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Shown when the link is shared in a text or on Facebook. 1200 × 630 works best.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!t.trim() || !!slugError || !s || !!redirectError}
            onClick={() => onSave({ title: t.trim(), slug: s, settings: { ...st, tags: tags.split(',').map((x) => x.trim()).filter(Boolean) }, ownerId: owner })}
          >
            Save settings
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// The builder
// ---------------------------------------------------------------------------

export function PageBuilderPage() {
  const { pageId = '' } = useParams()
  const page = usePage(pageId)
  if (page.isLoading) return <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
  if (page.isError || !page.data) {
    return (
      <Card>
        <EmptyState icon={TriangleAlertIcon} title="Page not found" description={page.error?.message ?? "It may have been deleted, or it isn't yours."} action={<Link to="/pages" className="text-sm font-medium text-primary">Back to Pages</Link>} />
      </Card>
    )
  }
  return <Builder key={page.data.id} page={page.data} />
}

function Builder({ page }: { page: PageRecord }) {
  const navigate = useNavigate()
  const { state } = useAuth()
  const isAdmin = state.status === 'signedIn' && state.user.role === 'admin'
  const save = useSavePage()
  const remove = useDeletePage()
  const owner = useProfile(page.ownerId)
  const [title, setTitle] = useState(page.title)
  const [slug, setSlug] = useState(page.slug)
  const [blocks, setBlocks] = useState<Block[]>(page.blocks)
  const [settings, setSettings] = useState<PageSettings>(page.settings)
  const [ownerId, setOwnerId] = useState(page.ownerId)
  const [status, setStatus] = useState(page.status)
  const [selected, setSelected] = useState<string | null>(page.blocks.find((b) => isField(b.type))?.id ?? page.blocks[0]?.id ?? null)
  const [device, setDevice] = useState<'phone' | 'desktop'>('phone')
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'unsaved' | 'error'>('saved')
  const [showSettings, setShowSettings] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [dragId, setDragId] = useState<string | null>(null)
  const isOpenHouse = page.type === 'open_house'
  const [view, setView] = useState<'property' | 'form'>(isOpenHouse ? 'property' : 'form')
  const [property, setProperty] = useState<OpenHouseProperty>(() => readProperty(page.property))
  const fees = useFeeTemplates()
  const partners = usePartners()
  const dirty = useRef<PagePatch>({})
  const timer = useRef<number | undefined>(undefined)

  const flush = async () => {
    window.clearTimeout(timer.current)
    const patch = dirty.current
    if (!Object.keys(patch).length) return true
    dirty.current = {}
    setSaveState('saving')
    try {
      await save.mutateAsync({ id: page.id, patch })
      setSaveState(Object.keys(dirty.current).length ? 'unsaved' : 'saved')
      return true
    } catch (e) {
      dirty.current = { ...patch, ...dirty.current }
      setSaveState('error')
      toast.error((e as Error).message)
      return false
    }
  }
  const queue = (patch: PagePatch) => {
    dirty.current = { ...dirty.current, ...patch }
    setSaveState('unsaved')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(flush, SAVE_DELAY_MS)
  }
  // Save what's waiting when leaving the builder.
  useEffect(() => () => void flush(), []) // eslint-disable-line react-hooks/exhaustive-deps

  const updateBlocks = (next: Block[]) => {
    setBlocks(next)
    queue({ blocks: next })
  }
  const selectedBlock = blocks.find((b) => b.id === selected) ?? null

  // Open houses: every change figures the financing table again with the Settings fee list,
  // and the sign-in tag follows the address.
  const changeProperty = (patch: Partial<OpenHouseProperty>) => {
    const next = refigure({ ...property, ...patch }, fees.data ?? [])
    setProperty(next)
    const extra: PagePatch = {}
    if (patch.address !== undefined) {
      const tags = [openHouseTag(next.address), ...(settings.tags ?? []).filter((t) => !t.startsWith('Open House – '))]
      const nextSettings = { ...settings, tags }
      setSettings(nextSettings)
      extra.settings = nextSettings
    }
    queue({ property: next as unknown as Record<string, unknown>, ...extra })
  }
  // Once the fee list loads, make sure the saved figures match it.
  useEffect(() => {
    if (!isOpenHouse || !fees.data) return
    const next = refigure(property, fees.data)
    if (JSON.stringify(next.financing) !== JSON.stringify(property.financing)) {
      setProperty(next)
      queue({ property: next as unknown as Record<string, unknown> })
    }
  }, [fees.data]) // eslint-disable-line react-hooks/exhaustive-deps
  const indexOf = (id: string) => blocks.findIndex((b) => b.id === id)

  const add = (type: BlockType) => {
    const b = newBlock(type)
    const at = selected ? indexOf(selected) + 1 : blocks.length
    // Content added after the LO card / footer would sit below the form; put it before them.
    const tail = blocks.findIndex((x) => x.type === 'lo_card' || x.type === 'footer')
    const pos = type === 'lo_card' || type === 'footer' ? blocks.length : tail >= 0 && at > tail ? tail : at
    updateBlocks([...blocks.slice(0, pos), b, ...blocks.slice(pos)])
    setSelected(b.id)
  }
  const move = (id: string, dir: -1 | 1) => {
    const i = indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= blocks.length) return
    const next = [...blocks]
    ;[next[i], next[j]] = [next[j], next[i]]
    updateBlocks(next)
  }
  const moveTo = (id: string, targetId: string) => {
    if (id === targetId) return
    const from = indexOf(id)
    const next = blocks.filter((b) => b.id !== id)
    const to = next.findIndex((b) => b.id === targetId)
    next.splice(from < indexOf(targetId) ? to + 1 : to, 0, blocks[from])
    updateBlocks(next)
  }
  const duplicate = (id: string) => {
    const i = indexOf(id)
    const copy = { ...blocks[i], id: newBlockId(), options: blocks[i].options ? [...blocks[i].options!] : undefined, label: blocks[i].label ? `${blocks[i].label} (copy)` : undefined, mapsTo: null }
    updateBlocks([...blocks.slice(0, i + 1), copy, ...blocks.slice(i + 1)])
    setSelected(copy.id)
  }
  const del = (id: string) => {
    const i = indexOf(id)
    updateBlocks(blocks.filter((b) => b.id !== id))
    setSelected(blocks[i + 1]?.id ?? blocks[i - 1]?.id ?? null)
  }

  const ownerName = owner.data?.fullName ?? page.ownerName ?? 'you'
  const preview = useMemo(
    () => ({
      title,
      blocks,
      settings,
      owner: { name: owner.data?.fullName ?? page.ownerName, nmls: owner.data?.nmls ?? null, phone: owner.data?.personalCell || owner.data?.phone || null, email: owner.data?.email ?? null, bookingUrl: null, photoPath: null },
      company: { name: 'MPS Mortgage LLC', nmls: '2501110' },
      type: page.type,
      property: isOpenHouse ? (property as unknown as Record<string, unknown>) : null,
      agent: (() => {
        const a = partners.data?.find((x) => x.id === property.agentPartnerId)
        return a ? { name: a.name, company: a.company, phone: a.phone, email: a.email } : null
      })(),
    }),
    [title, blocks, settings, owner.data, page.ownerName, page.type, isOpenHouse, property, partners.data],
  )

  const publish = async () => {
    const problems = publishProblems(title, slug, blocks)
    if (isOpenHouse && !property.address.trim()) problems.push("Add the home's address.")
    if (isOpenHouse && !property.listPrice) problems.push('Add the list price.')
    if (problems.length) {
      toast.error(problems.join(' '))
      return
    }
    if (!(await flush())) return
    try {
      if (ownerId && blocks.some((b) => b.type === 'lo_card')) await publishHeadshot(page.organizationId, ownerId)
      await save.mutateAsync({ id: page.id, patch: { status: 'published' } })
      setStatus('published')
      const url = `${window.location.origin}/p/${slug}`
      await navigator.clipboard?.writeText(url).catch(() => null)
      toast.success('Published. The link is copied.', { description: url })
    } catch (e) {
      toast.error((e as Error).message)
    }
  }
  const unpublish = async () => {
    if (!(await confirmAction('Unpublish this page? Its link will show "Page not found" until you publish again.', { confirmLabel: 'Unpublish' }))) return
    await flush()
    save.mutate({ id: page.id, patch: { status: 'draft' } }, { onSuccess: () => setStatus('draft'), onError: (e) => toast.error(e.message) })
  }

  const saveLabel = { saved: 'saved', saving: 'saving…', unsaved: 'editing…', error: 'not saved' }[saveState]

  const palette = (
    <div className="space-y-5">
      {[
        { label: 'Content', items: CONTENT_TYPES },
        { label: 'Fields', items: FIELD_TYPES },
      ].map((group) => (
        <div key={group.label}>
          <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">{group.label}</p>
          <div className="grid grid-cols-2 gap-2">
            {group.items.map((t) => (
              <button key={t.type} type="button" onClick={() => add(t.type)} className="rounded-lg border bg-card px-2 py-2.5 text-sm font-medium shadow-soft transition-colors hover:border-primary/50 hover:text-primary">
                {t.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <div>
        <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">On this page</p>
        <ul className="space-y-0.5">
          {blocks.map((b) => (
            <li
              key={b.id}
              draggable
              onDragStart={() => setDragId(b.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => dragId && moveTo(dragId, b.id)}
              onDragEnd={() => setDragId(null)}
              className={cn('group flex items-center gap-1 rounded-md', selected === b.id ? 'bg-primary/10 text-primary' : 'hover:bg-accent', dragId === b.id && 'opacity-50')}
            >
              <GripVerticalIcon className="size-3.5 shrink-0 cursor-grab text-muted-foreground/60" />
              <button type="button" onClick={() => setSelected(b.id)} className={cn('min-w-0 flex-1 truncate py-1.5 pr-1 text-left text-sm', selected === b.id && 'font-semibold')}>
                {blockSummary(b)}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )

  const inspector = (
    <Inspector
      block={selectedBlock}
      onChange={(nb) => updateBlocks(blocks.map((b) => (b.id === nb.id ? nb : b)))}
      onMove={(dir) => selected && move(selected, dir)}
      onDuplicate={() => selected && duplicate(selected)}
      onDelete={() => selected && del(selected)}
      organizationId={page.organizationId}
      pageId={page.id}
      settings={settings}
      ownerName={ownerName}
    />
  )

  return (
    <div className="-mx-4 -my-6 md:-mx-6">
      {/* Top bar */}
      <div className="sticky top-14 z-20 flex flex-wrap items-center gap-2 border-b bg-card px-4 py-2.5 md:top-0 md:px-6">
        <Link to="/pages" className="inline-flex items-center gap-1 text-sm font-medium text-primary">
          <ArrowLeftIcon className="size-4" />
          Pages
        </Link>
        <span className="hidden h-5 w-px bg-border sm:block" />
        <input
          value={title}
          onChange={(e) => {
            setTitle(e.target.value)
            if (e.target.value.trim()) queue({ title: e.target.value.trim() })
          }}
          className="min-w-0 flex-1 truncate rounded-md bg-transparent px-1 text-lg font-bold outline-none focus:ring-2 focus:ring-primary/30 sm:max-w-sm"
          aria-label="Page title"
        />
        <StatusBadge status={status} />
        <span className={cn('text-xs', saveState === 'error' ? 'text-destructive' : 'text-muted-foreground')}>{status === 'published' && saveState === 'saved' ? 'changes are live' : saveLabel}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="hidden rounded-lg bg-muted p-0.5 lg:flex">
            {(['phone', 'desktop'] as const).map((d) => (
              <button key={d} type="button" onClick={() => setDevice(d)} className={cn('rounded-md px-3 py-1 text-sm font-medium capitalize', device === d ? 'bg-card shadow-soft' : 'text-muted-foreground')}>
                {d}
              </button>
            ))}
          </div>
          <Button variant="outline" size="sm" className="lg:hidden" onClick={() => setShowPreview(true)}>
            <EyeIcon />
            Preview
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate(`/pages/${page.id}/submissions`)}>
            <InboxIcon />
            Submissions
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowSettings(true)}>
            <SettingsIcon />
            Settings
          </Button>
          {status === 'published' ? (
            <>
              <Button variant="outline" size="sm" onClick={() => window.open(`/p/${slug}`, '_blank')}>
                <ExternalLinkIcon />
                Open
              </Button>
              <Button variant="outline" size="sm" onClick={unpublish}>
                Unpublish
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={publish} disabled={save.isPending}>
              Publish
            </Button>
          )}
        </div>
      </div>

      {isOpenHouse && (
        <div className="flex gap-1 border-b bg-card px-4 md:px-6">
          {(
            [
              ['property', 'Property & financing'],
              ['form', 'Sign-in form'],
            ] as const
          ).map(([v, label]) => (
            <button key={v} type="button" onClick={() => setView(v)} className={cn('-mb-px border-b-2 px-3 py-2.5 text-sm font-semibold', view === v ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
              {label}
            </button>
          ))}
        </div>
      )}

      {isOpenHouse && view === 'property' && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-4 p-4 md:p-6 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,400px)_minmax(0,1fr)_380px]">
          <PropertyPanel property={property} onChange={changeProperty} organizationId={page.organizationId} pageId={page.id} />
          <div className="space-y-4">
            <FinancingTable property={property} onChange={changeProperty} />
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-4">
                <LivePageCard slug={slug} published={status === 'published'} />
                <SignInsCard pageId={page.id} address={property.address} ownerId={ownerId} />
              </div>
              <FlyerCard slug={slug} published={status === 'published'} property={property} ownerId={ownerId} />
            </div>
          </div>
          <div className="hidden 2xl:block">
            <p className="mb-2 text-sm font-semibold">Live page preview</p>
            <div className="sticky top-20 max-h-[calc(100svh-120px)] overflow-y-auto rounded-[28px] border bg-background shadow-soft">
              <PageRenderer page={preview} mode="preview" />
            </div>
          </div>
        </div>
      )}

      <div className={cn('grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)_320px]', isOpenHouse && view === 'property' && 'hidden')}>
        <aside className="border-b p-4 lg:sticky lg:top-[57px] lg:h-[calc(100svh-57px)] lg:overflow-y-auto lg:border-r lg:border-b-0">{palette}</aside>
        <section className="hidden bg-muted/40 p-6 lg:block">
          <div className={cn('mx-auto overflow-hidden rounded-[28px] border bg-background shadow-soft', device === 'phone' ? 'max-w-[400px]' : 'max-w-3xl rounded-xl')}>
            <PageRenderer page={preview} mode="preview" selectedId={selected} onSelect={setSelected} wide={device === 'desktop'} />
          </div>
        </section>
        <aside className="p-4 lg:sticky lg:top-[57px] lg:h-[calc(100svh-57px)] lg:overflow-y-auto lg:border-l">{inspector}</aside>
      </div>

      <div className="flex justify-end px-4 pb-6 md:px-6">
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={async () => {
            if (!(await confirmAction(`Delete "${title}"? This can't be undone. A page with submissions is kept (unpublish it instead).`, { confirmLabel: 'Delete page', destructive: true }))) return
            window.clearTimeout(timer.current)
            dirty.current = {}
            remove.mutate(page.id, { onSuccess: () => navigate('/pages'), onError: (e) => toast.error(e.message) })
          }}
        >
          <Trash2Icon />
          Delete page
        </Button>
      </div>

      {showSettings && (
        <SettingsDialog
          page={page}
          title={title}
          slug={slug}
          settings={settings}
          ownerId={ownerId}
          isAdmin={isAdmin}
          onClose={() => setShowSettings(false)}
          onSave={async (p) => {
            setTitle(p.title)
            setSlug(p.slug)
            setSettings(p.settings)
            setOwnerId(p.ownerId)
            dirty.current = { ...dirty.current, title: p.title, slug: p.slug, settings: p.settings, ...(p.ownerId !== page.ownerId ? { ownerId: p.ownerId } : {}) }
            if (await flush()) setShowSettings(false)
          }}
        />
      )}

      {showPreview && (
        <Dialog open onOpenChange={(o) => !o && setShowPreview(false)}>
          <DialogContent className="h-[90svh] max-w-[420px] overflow-y-auto p-0">
            <DialogHeader className="sr-only">
              <DialogTitle>Preview</DialogTitle>
            </DialogHeader>
            <PageRenderer page={preview} mode="preview" />
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

