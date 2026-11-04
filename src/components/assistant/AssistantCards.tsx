import { Link } from 'react-router'
import { ChevronRightIcon, ReceiptIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import type { AssistantCard } from '@/lib/assistant/cards'

const usd = (n: number | null) => (n == null ? '—' : `$${n.toLocaleString('en-US')}`)
const pct = (n: number | null, digits = 3) => (n == null ? '—' : `${n.toFixed(digits)}%`)

/** A card under an assistant reply, built from the app's own card look. */
export function AssistantCardView({ card, onChoose, onNavigate }: { card: AssistantCard; onChoose: (text: string) => void; onNavigate?: () => void }) {
  if (card.type === 'choices') {
    return (
      <div className="space-y-2">
        <p className="text-sm font-medium">{card.question}</p>
        <div className="flex flex-wrap gap-2">
          {card.options.map((o) => (
            <Button key={o.loanId} size="sm" variant="outline" className="h-auto rounded-full py-1.5 text-left whitespace-normal" onClick={() => onChoose(`I mean ${o.label} (loan id ${o.loanId}).`)}>
              {o.label}
            </Button>
          ))}
        </div>
      </div>
    )
  }

  if (card.type === 'borrowers') {
    return (
      <div className="rounded-lg border bg-card shadow-soft">
        <p className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">{card.title}</p>
        {card.items.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">Nobody matches.</p>
        ) : (
          <ul className="max-h-80 divide-y overflow-y-auto">
            {card.items.map((i) => (
              <li key={i.loanId}>
                <Link to={`/loans/${i.loanId}`} onClick={onNavigate} className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{i.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{i.detail}</span>
                  </span>
                  <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  if (card.type === 'summary') {
    return (
      <div className="rounded-lg border bg-card p-3 shadow-soft">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="font-semibold">{card.name}</p>
            <p className="text-xs text-muted-foreground">{card.status}</p>
          </div>
          <Button size="sm" variant="outline" asChild>
            <Link to={`/loans/${card.loanId}`} onClick={onNavigate}>
              Open
            </Link>
          </Button>
        </div>
        <dl className="mt-2 space-y-1 text-sm">
          {card.lines.map((l) => (
            <div key={l.label} className="flex gap-2">
              <dt className="w-32 shrink-0 text-muted-foreground">{l.label}</dt>
              <dd className="min-w-0 break-words">{l.value}</dd>
            </div>
          ))}
        </dl>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {card.items.map((e) => (
        <div key={e.id} className={cn('flex items-start gap-3 rounded-lg border bg-card p-3 shadow-soft', e.selected && 'border-primary/40')}>
          <ReceiptIcon className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold tabular-nums">
              {pct(e.rate)}
              {e.selected && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Selected</span>}
            </p>
            <p className="truncate text-xs text-muted-foreground">{[e.name, e.lender, e.program].filter(Boolean).join(' · ')}</p>
            <p className="mt-1 text-sm text-muted-foreground tabular-nums">
              P&amp;I {usd(e.pi)} · Taxes {usd(e.taxes)} · Payment {usd(e.payment)}
              <br />
              Points {e.points == null ? '—' : pct(e.points, 3)} · Cash to close {usd(e.cashToClose)}
            </p>
          </div>
          <Button size="sm" variant="outline" asChild>
            <Link to={`/loans/${card.loanId}?tab=estimates`} onClick={onNavigate}>
              Open
            </Link>
          </Button>
        </div>
      ))}
    </div>
  )
}
