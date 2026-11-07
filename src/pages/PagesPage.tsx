// Pages (Connor, 2026-11-06; mockup docs/design-reference/pages/Pages list.png):
// quick forms, landing pages and open house sites. Every submission becomes a
// lead (or a note on an open file) in MPS-HQ.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router'
import { FileTextIcon, HomeIcon, PlusIcon, TriangleAlertIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Card, DataTable, EmptyState, Input, PageHeader, SearchInput, ToggleChip, ToggleChipGroup, type Column } from '@/components/shared'
import { freeSlug, useCreatePage, usePages, type PageRecord } from '@/lib/api/pages'
import { useCopyPage } from '@/lib/api/pagesPhase3'
import { formatIsoDate, todayIso } from '@/lib/dates'
import { ALL_TEMPLATES, blankPage, fromTemplate, PAGE_TYPE_LABEL, type PageTemplate, type PageType } from '@/lib/pages/templates'
import { slugify } from '../../supabase/functions/page-submit/blocks'

type Filter = 'all' | PageType | 'templates' | 'archived'

export const pageAddress = (slug: string) => `${window.location.host}/p/${slug}`

export function StatusBadge({ status }: { status: PageRecord['status'] }) {
  return status === 'published' ? (
    <span className="inline-flex rounded-full bg-nurture/10 px-2.5 py-0.5 text-xs font-semibold text-nurture">Published</span>
  ) : (
    <span className="inline-flex rounded-full bg-money/10 px-2.5 py-0.5 text-xs font-semibold text-money">{status === 'archived' ? 'Archived' : status === 'template' ? 'My template' : 'Draft'}</span>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card contentClassName="py-1">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums">{value.toLocaleString('en-US')}</p>
    </Card>
  )
}

function NewPageDialog({ onClose }: { onClose: () => void }) {
  const [type, setType] = useState<PageType>('form')
  const [title, setTitle] = useState('')
  const create = useCreatePage()
  const navigate = useNavigate()
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New page</DialogTitle>
          <DialogDescription>Start blank. You can also start from a template on the Pages screen.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <ToggleChipGroup>
            {(['form', 'landing'] as const).map((t) => (
              <ToggleChip key={t} label={PAGE_TYPE_LABEL[t]} pressed={type === t} onChange={() => setType(t)} />
            ))}
          </ToggleChipGroup>
          <Input label="Title" required value={title} onChange={setTitle} placeholder="e.g. First-time buyer checklist" autoFocus />
          {title.trim() && <p className="text-xs text-muted-foreground">Web address: {pageAddress(slugify(title) || 'page')}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || create.isPending}
            onClick={async () => {
              try {
                const blank = blankPage(type)
                const id = await create.mutateAsync({ type, title: title.trim(), slug: await freeSlug(slugify(title)), ...blank })
                navigate(`/pages/${id}`)
              } catch (e) {
                toast.error((e as Error).message)
              }
            }}
          >
            Create draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function PagesPage() {
  const pages = usePages()
  const create = useCreatePage()
  const copy = useCopyPage()
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [creating, setCreating] = useState(false)

  const everything = useMemo(() => pages.data ?? [], [pages.data])
  // The table and stats are your pages; archived ones have their own filter, your templates show under Templates.
  const all = useMemo(() => everything.filter((p) => p.status !== 'template' && p.status !== 'archived'), [everything])
  const archived = useMemo(() => everything.filter((p) => p.status === 'archived'), [everything])
  const myTemplates = useMemo(() => everything.filter((p) => p.status === 'template'), [everything])
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const list = filter === 'archived' ? archived : all
    return list.filter((p) => (filter === 'all' || filter === 'templates' || filter === 'archived' || p.type === filter) && (!q || p.title.toLowerCase().includes(q) || p.slug.includes(q)))
  }, [all, archived, search, filter])

  const fromTemplateClick = async (t: PageTemplate) => {
    if (t.type === 'open_house') {
      navigate('/pages/open-house/new')
      return
    }
    try {
      const id = await create.mutateAsync({ type: t.type, title: t.title, slug: await freeSlug(t.slug), blocks: fromTemplate(t), settings: structuredClone(t.settings) })
      toast.success(`${t.title} copied as a draft`)
      navigate(`/pages/${id}`)
    } catch (e) {
      toast.error((e as Error).message)
    }
  }

  const today = todayIso()
  const columns: Column<PageRecord>[] = [
    {
      key: 'page',
      header: 'Page',
      cell: (p) => (
        <div className="min-w-0">
          <p className="font-semibold">{p.title}</p>
          <p className="truncate text-xs text-muted-foreground">{pageAddress(p.slug)}</p>
        </div>
      ),
    },
    { key: 'type', header: 'Type', cell: (p) => PAGE_TYPE_LABEL[p.type], hideOnMobile: true },
    { key: 'status', header: 'Status', cell: (p) => <StatusBadge status={p.status} /> },
    { key: 'views', header: 'Views', align: 'right', hideOnMobile: true, cell: (p) => <span className="tabular-nums">{p.status === 'draft' && !p.viewCount ? '—' : p.viewCount.toLocaleString('en-US')}</span> },
    { key: 'subs', header: 'Submissions', align: 'right', cell: (p) => <span className="tabular-nums">{p.status === 'draft' && !p.submissionCount ? '—' : p.submissionCount}</span> },
    { key: 'owner', header: 'Owner', hideOnMobile: true, cell: (p) => p.ownerName ?? 'Unassigned' },
    { key: 'updated', header: 'Updated', hideOnMobile: true, cell: (p) => (p.updatedAt.slice(0, 10) === today ? 'Today' : formatIsoDate(p.updatedAt.slice(0, 10))) },
  ]

  const templates = filter === 'templates' ? ALL_TEMPLATES : ALL_TEMPLATES.slice(0, 3)

  return (
    <>
      <PageHeader
        eyebrow="Workspace"
        title="Pages"
        description="Quick forms, landing pages and open house sites. Every submission becomes a lead in MPS-HQ."
        action={
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => navigate('/pages/open-house/new')}>
              <HomeIcon />
              New open house
            </Button>
            <Button onClick={() => setCreating(true)}>
              <PlusIcon />
              New page
            </Button>
          </div>
        }
      />

      {pages.isError && (
        <Card>
          <EmptyState icon={TriangleAlertIcon} title="Couldn't load pages" description={pages.error.message} />
        </Card>
      )}

      {!pages.isError && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Live pages" value={all.filter((p) => p.status === 'published').length} />
            <Stat label="Views · 30 days" value={all.reduce((a, p) => a + p.views30, 0)} />
            <Stat label="Submissions · 30 days" value={all.reduce((a, p) => a + p.submissions30, 0)} />
            <Stat label="New leads created" value={all.reduce((a, p) => a + p.newLeads30, 0)} />
          </div>

          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <SearchInput value={search} onChange={setSearch} placeholder="Search pages" className="w-full sm:w-80" />
            <ToggleChipGroup>
              <ToggleChip label="All" pressed={filter === 'all'} onChange={() => setFilter('all')} />
              <ToggleChip label="Forms" pressed={filter === 'form'} onChange={(on) => setFilter(on ? 'form' : 'all')} />
              <ToggleChip label="Landing pages" pressed={filter === 'landing'} onChange={(on) => setFilter(on ? 'landing' : 'all')} />
              <ToggleChip label="Open houses" pressed={filter === 'open_house'} onChange={(on) => setFilter(on ? 'open_house' : 'all')} />
              <ToggleChip label="Templates" pressed={filter === 'templates'} onChange={(on) => setFilter(on ? 'templates' : 'all')} />
              {archived.length > 0 && <ToggleChip label={`Archived · ${archived.length}`} pressed={filter === 'archived'} onChange={(on) => setFilter(on ? 'archived' : 'all')} />}
            </ToggleChipGroup>
          </div>

          {filter !== 'templates' && (
            <Card contentClassName="p-0">
              {pages.isLoading ? (
                <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
              ) : (
                <DataTable
                  columns={columns}
                  rows={rows}
                  rowKey={(p) => p.id}
                  onRowClick={(p) => navigate(`/pages/${p.id}`)}
                  empty={{ icon: FileTextIcon, title: all.length ? 'No pages match' : 'No pages yet', description: all.length ? 'Try a different search.' : 'Start from a template below, or make a new page.' }}
                />
              )}
            </Card>
          )}

          {filter === 'templates' && myTemplates.length > 0 && (
            <>
              <h2 className="mb-3 text-lg font-bold">My templates</h2>
              <div className="mb-8 grid grid-cols-1 gap-3 md:grid-cols-3">
                {myTemplates.map((t) => (
                  <div key={t.id} className="flex flex-col rounded-xl border bg-card p-4 shadow-soft">
                    <p className="font-semibold">{t.title}</p>
                    <p className="mt-0.5 text-sm text-muted-foreground">{PAGE_TYPE_LABEL[t.type]} · {t.blocks.length} blocks</p>
                    <div className="mt-3 flex gap-2">
                      <Button size="sm" disabled={copy.isPending} onClick={() => copy.mutate({ page: t, as: 'draft' }, { onSuccess: (id) => navigate(`/pages/${id}`), onError: (e) => toast.error(e.message) })}>
                        Use
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => navigate(`/pages/${t.id}`)}>
                        Edit
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          <h2 className="mt-8 mb-3 text-lg font-bold">Start from a template</h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {templates.map((t) => (
              <button key={t.key} type="button" disabled={create.isPending} onClick={() => fromTemplateClick(t)} className="rounded-xl border bg-card p-4 text-left shadow-soft transition-colors hover:border-primary/50 disabled:opacity-60">
                <p className="font-semibold">{t.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{t.description}</p>
              </button>
            ))}
          </div>
          {filter !== 'templates' && (
            <button type="button" className="mt-2 text-sm font-medium text-primary hover:underline" onClick={() => setFilter('templates')}>
              See all {ALL_TEMPLATES.length} templates
            </button>
          )}
        </>
      )}

      {creating && <NewPageDialog onClose={() => setCreating(false)} />}
    </>
  )
}
