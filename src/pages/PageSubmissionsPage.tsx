// Submissions for one page (Pages, 2026-11-06): a table, one submission at a
// time, a link to the person's file, and a CSV export.
import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { ArrowLeftIcon, DownloadIcon, FileIcon, InboxIcon, PencilIcon, TriangleAlertIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Card, DataTable, EmptyState, PageHeader, type Column } from '@/components/shared'
import { proposedValue } from '@/components/pages/ProposedUpdatesCard'
import { OUTCOME_LABEL, uploadUrl, usePage, usePageSubmissions, type PageSubmission } from '@/lib/api/pages'
import { downloadText } from '@/lib/download'
import { formatPhone } from '@/lib/pipeline/helpers'
import { pageAddress, StatusBadge } from './PagesPage'
import type { DataRow } from '../../supabase/functions/page-submit/blocks'

const when = (iso: string) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso))

function showValue(d: DataRow): string {
  if (d.value === null || d.value === '') return '—'
  if (Array.isArray(d.value)) return d.value.join(', ')
  if (typeof d.value === 'boolean') return d.value ? 'Yes' : 'No'
  if (d.type === 'currency' && typeof d.value === 'number') return `$${d.value.toLocaleString('en-US')}`
  if (d.type === 'phone') return formatPhone(String(d.value))
  return String(d.value)
}

/** One row per submission, one column per question (by label), plus who, when and where it went. */
export function submissionsCsv(rows: PageSubmission[]): string {
  const labels = [...new Set(rows.flatMap((r) => r.data.map((d) => d.label)))]
  const head = ['Submitted', 'Person', 'Outcome', ...labels, 'Files', 'Tags', 'UTM source', 'UTM campaign', 'File link']
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const lines = rows.map((r) =>
    [
      when(r.createdAt),
      r.personName ?? '',
      OUTCOME_LABEL[r.outcome] ?? r.outcome,
      ...labels.map((l) => {
        const d = r.data.find((x) => x.label === l)
        return d ? showValue(d).replace(/^—$/, '') : ''
      }),
      r.files.map((f) => f.name).join('; '),
      r.tags.join('; '),
      r.source.utm_source ?? '',
      r.source.utm_campaign ?? '',
      r.loanId ? `${window.location.origin}/loans/${r.loanId}` : '',
    ]
      .map((v) => esc(String(v)))
      .join(','),
  )
  return [head.map(esc).join(','), ...lines].join('\n')
}

function SubmissionDialog({ sub, onClose }: { sub: PageSubmission; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{sub.personName ?? 'Submission'}</DialogTitle>
          <DialogDescription>
            {when(sub.createdAt)} · {OUTCOME_LABEL[sub.outcome] ?? sub.outcome}
          </DialogDescription>
        </DialogHeader>
        <dl className="divide-y text-sm">
          {sub.data.map((d) => (
            <div key={d.blockId} className="grid grid-cols-[40%_1fr] gap-3 py-2">
              <dt className="text-muted-foreground">{d.label}</dt>
              <dd className="font-medium break-words whitespace-pre-line">{d.type === 'file' ? `${sub.files.filter((f) => f.blockId === d.blockId).length || 'No'} file(s)` : showValue(d)}</dd>
            </div>
          ))}
        </dl>
        {sub.files.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Files</p>
            {sub.files.map((f) => (
              <button
                key={f.path}
                type="button"
                className="flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent"
                onClick={async () => {
                  try {
                    window.open(await uploadUrl(f.path), '_blank')
                  } catch (e) {
                    toast.error((e as Error).message)
                  }
                }}
              >
                <FileIcon className="size-4 text-muted-foreground" />
                <span className="truncate">{f.name}</span>
              </button>
            ))}
          </div>
        )}
        {sub.proposed.length > 0 && (
          <div className="space-y-1 text-sm">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Proposed updates</p>
            {sub.proposed.map((p) => (
              <p key={p.key}>
                {p.label}: <span className="font-medium">{proposedValue(p.key, p.value)}</span> <span className="text-muted-foreground">(file has {proposedValue(p.key, p.current)}; {p.status})</span>
              </p>
            ))}
          </div>
        )}
        <div className="space-y-1 text-xs text-muted-foreground">
          {sub.tags.length > 0 && <p>Tags: {sub.tags.join(', ')}</p>}
          {Object.keys(sub.source).length > 0 && <p>Source: {Object.entries(sub.source).map(([k, v]) => `${k.replace('utm_', '')} ${v}`).join(' · ')}</p>}
          {sub.ghlResult && <p>GHL: {sub.ghlResult}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {sub.loanId && (
            <Button asChild size="sm">
              <Link to={`/loans/${sub.loanId}`}>Open the file</Link>
            </Button>
          )}
          {sub.partnerId && (
            <Button asChild size="sm" variant="outline">
              <Link to="/partners">Partner center</Link>
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function PageSubmissionsPage() {
  const { pageId = '' } = useParams()
  const page = usePage(pageId)
  const subs = usePageSubmissions(pageId)
  const [open, setOpen] = useState<PageSubmission | null>(null)
  const rows = subs.data ?? []

  const firstAnswers = (s: PageSubmission) =>
    s.data
      .filter((d) => d.value !== null && d.type !== 'file' && !['email', 'phone'].includes(d.type) && !/name/i.test(d.label))
      .slice(0, 2)
      .map((d) => `${d.label}: ${showValue(d)}`)
      .join(' · ')

  const columns: Column<PageSubmission>[] = [
    { key: 'when', header: 'Submitted', cell: (s) => <span className="whitespace-nowrap">{when(s.createdAt)}</span> },
    { key: 'who', header: 'Person', cell: (s) => <span className="font-semibold">{s.personName ?? '—'}</span> },
    { key: 'outcome', header: 'Went to', cell: (s) => OUTCOME_LABEL[s.outcome] ?? s.outcome },
    { key: 'answers', header: 'Answers', hideOnMobile: true, cell: (s) => <span className="line-clamp-1 text-muted-foreground">{firstAnswers(s) || '—'}</span> },
    { key: 'files', header: 'Files', align: 'right', hideOnMobile: true, cell: (s) => (s.files.length ? s.files.length : '—') },
    { key: 'source', header: 'Source', hideOnMobile: true, cell: (s) => s.source.utm_source ?? (s.source.referrer ? 'Link' : 'Direct') },
  ]

  return (
    <>
      <Link to={page.data ? `/pages/${pageId}` : '/pages'} className="mb-3 inline-flex items-center gap-1 text-sm font-medium text-primary">
        <ArrowLeftIcon className="size-4" />
        {page.data ? 'Back to the builder' : 'Pages'}
      </Link>
      <PageHeader
        eyebrow="Pages"
        title={page.data ? `${page.data.title} · submissions` : 'Submissions'}
        description={page.data ? `${pageAddress(page.data.slug)} · ${rows.length} ${rows.length === 1 ? 'submission' : 'submissions'}` : undefined}
        action={
          <div className="flex items-center gap-2">
            {page.data && <StatusBadge status={page.data.status} />}
            {page.data && (
              <Button variant="outline" asChild>
                <Link to={`/pages/${pageId}`}>
                  <PencilIcon />
                  Edit page
                </Link>
              </Button>
            )}
            <Button variant="outline" disabled={!rows.length} onClick={() => downloadText(`${page.data?.slug ?? 'page'}-submissions.csv`, submissionsCsv(rows), 'text/csv')}>
              <DownloadIcon />
              Export CSV
            </Button>
          </div>
        }
      />
      {subs.isError ? (
        <Card>
          <EmptyState icon={TriangleAlertIcon} title="Couldn't load submissions" description={subs.error.message} />
        </Card>
      ) : (
        <Card contentClassName="p-0">
          {subs.isLoading ? (
            <p className="py-12 text-center text-sm text-muted-foreground">Loading…</p>
          ) : (
            <DataTable columns={columns} rows={rows} rowKey={(s) => s.id} onRowClick={setOpen} empty={{ icon: InboxIcon, title: 'No submissions yet', description: 'Share the page link. Each submission shows up here and on the person\'s file.' }} />
          )}
        </Card>
      )}
      {open && <SubmissionDialog sub={open} onClose={() => setOpen(null)} />}
    </>
  )
}
