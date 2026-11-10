import { Link } from 'react-router'
import { CopyIcon, ExternalLinkIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { useOrganization } from '@/lib/api/settings'
import { ariveUrl } from '@/lib/arive'

/**
 * The file's Arive loan number with "Open in Arive" (the company's Arive link
 * from Settings, number filled in, new tab). No link set: the number with a
 * copy button and a pointer to Settings. No number: "Add Arive #" (opens the
 * edit dialog when the page gives one).
 */
export function AriveLink({ number, onAdd, className }: { number: string | null; onAdd?: () => void; className?: string }) {
  const org = useOrganization()
  const n = number?.trim() || null
  const url = ariveUrl(org.data?.ariveLoanUrl, n)
  const box = cn('inline-flex flex-wrap items-center gap-1.5 text-xs', className)

  if (!n)
    return onAdd ? (
      <button type="button" onClick={onAdd} className={cn(box, 'text-primary hover:underline')}>
        Add Arive #
      </button>
    ) : (
      <span className={cn(box, 'text-muted-foreground')}>No Arive # yet</span>
    )

  const chip = <span className="rounded border px-1.5 py-0.5 font-mono text-[0.7rem] text-muted-foreground">{n}</span>
  if (url)
    return (
      <span className={box}>
        {chip}
        <Button size="xs" variant="outline" asChild>
          <a href={url} target="_blank" rel="noopener noreferrer" title="Opens this loan in Arive in a new tab">
            Open in Arive
            <ExternalLinkIcon />
          </a>
        </Button>
      </span>
    )
  return (
    <span className={box}>
      {chip}
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Copy the Arive loan number"
        onClick={() => navigator.clipboard.writeText(n).then(() => toast.success('Arive # copied'), () => toast.error("Couldn't copy"))}
      >
        <CopyIcon />
      </Button>
      {org.isSuccess && (
        <Link to="/settings" className="text-muted-foreground hover:text-foreground hover:underline">
          Set the Arive link in Settings.
        </Link>
      )}
    </span>
  )
}
