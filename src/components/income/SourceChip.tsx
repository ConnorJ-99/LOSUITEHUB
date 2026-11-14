// The small "p.1" chip under a worksheet figure that came from a document
// (Stage 4d-2). Hover or tap shows the words it was read from; when the
// figure was changed it says what the AI read. Clicking it shows the figure
// on the document. The worksheet card provides the sources through context.
import { useContext } from 'react'
import { FileTextIcon } from 'lucide-react'
import { cn } from 'cn'
import { formatCurrency } from '@/lib/format'
import { SourceContext } from './sourceContext'
import { inputAt } from '@/lib/income/edits'

const shownValue = (v: unknown) => (typeof v === 'number' ? (Math.abs(v) >= 100 ? formatCurrency(v) : String(v)) : String(v ?? '—'))

export function SourceChip({ path, className }: { path: string; className?: string }) {
  const ctx = useContext(SourceContext)
  const s = ctx?.sources[path]
  if (!ctx || !s) return null
  const now = inputAt(ctx.inputs, path)
  const changed = typeof now === 'number' && typeof s.value === 'number' ? Math.abs(now - s.value) >= 0.005 : now !== s.value
  const title = `${s.derived ? `${s.derived}. ` : ''}Read from: "${s.quote}"${s.page ? ` (page ${s.page})` : ''}`
  return (
    <button
      type="button"
      onClick={() => ctx.onOpen?.(s)}
      title={title}
      className={cn('mt-1 inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] hover:bg-muted', changed ? 'border-amber-300 bg-amber-50 text-amber-900' : 'text-muted-foreground', className)}
    >
      <FileTextIcon className="size-3 shrink-0" />
      <span className="truncate">{changed ? `AI read ${shownValue(s.value)}, you changed it` : s.page ? `p.${s.page}` : 'source'}</span>
    </button>
  )
}
