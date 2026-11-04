import { Link } from 'react-router'
import { ArrowRightIcon, CheckIcon, ChevronRightIcon, ReceiptIcon, Undo2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { useActionStatuses, useUndoAction } from '@/lib/assistant/chat'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import type { AssistantCard } from '@/lib/assistant/cards'
import { MessageDraftCard } from './MessageDraftCard'

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

  if (card.type === 'message') return <MessageDraftCard card={card} />

  if (card.type === 'change') {
    return (
      <div className="space-y-2">
        <div className="rounded-lg border bg-card p-3 shadow-soft">
          <p className="flex items-center gap-1.5 text-sm font-semibold">
            <CheckIcon className="size-4 text-emerald-600" />
            {card.title}
          </p>
          <dl className="mt-2 space-y-1 text-sm">
            {card.lines.map((l) => (
              <div key={l.label} className="flex flex-wrap gap-x-2">
                <dt className="text-muted-foreground">{l.label}:</dt>
                <dd className="min-w-0 break-words">
                  {l.before && <span className="text-muted-foreground line-through">{l.before}</span>}
                  {l.before && <ArrowRightIcon className="mx-1 inline size-3.5 text-muted-foreground" />}
                  <span className="font-medium">{l.after}</span>
                </dd>
              </div>
            ))}
          </dl>
          {card.footnote && <p className="mt-2 text-xs text-muted-foreground">{card.footnote}</p>}
          <div className="mt-2 flex flex-wrap gap-2">
            {card.actionId && <UndoButton actionId={card.actionId} />}
            <Button size="sm" variant="ghost" asChild>
              <Link to={`/loans/${card.loanId}`} onClick={onNavigate}>
                Open file
              </Link>
            </Button>
          </div>
        </div>
        {card.suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {card.suggestions.map((s) => (
              <Button key={s} size="sm" variant="outline" className="h-auto rounded-full py-1.5 whitespace-normal" onClick={() => onChoose(s)}>
                {s}
              </Button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {card.note && <p className="text-sm text-muted-foreground">{card.note}</p>}
      {card.items.map((e) => (
        <div key={e.id} className={cn('flex items-start gap-3 rounded-lg border bg-card p-3 shadow-soft', e.selected && 'border-primary/40')}>
          <ReceiptIcon className="mt-0.5 size-4 shrink-0 text-primary" />
          <div className="min-w-0 flex-1">
            <p className="font-semibold tabular-nums">
              {pct(e.rate)}
              {e.selected && <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">Selected</span>}
            </p>
            <p className="truncate text-xs text-muted-foreground">{[e.name, e.lender, e.program].filter((p, i) => p && (i === 0 || !e.name.includes(p))).join(' · ')}</p>
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
      {card.created && card.actionId && (
        <div className="flex flex-wrap items-center gap-2">
          {card.forName && card.items.length <= 3 && (
            <Button size="sm" className="rounded-full" onClick={() => onChoose(`Email ${card.items.length === 1 ? 'this Fee Estimate' : 'these Fee Estimates'} to ${card.forName} with a short heads-up text.`)}>
              Send {card.items.length === 1 ? 'it' : card.items.length === 2 ? 'both' : 'all three'} to {card.forName}…
            </Button>
          )}
          <UndoButton actionId={card.actionId} label={card.items.length > 1 ? `Undo (delete these ${card.items.length})` : 'Undo (delete it)'} />
        </div>
      )}
    </div>
  )
}

/** Puts a change back. Shows "Undone" once it has been. */
function UndoButton({ actionId, label = 'Undo' }: { actionId: string; label?: string }) {
  const statuses = useActionStatuses([actionId])
  const undo = useUndoAction()
  const status = statuses.data?.get(actionId)
  if (status === 'undone') return <span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">Undone</span>
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={undo.isPending || !status}
      onClick={() => undo.mutate(actionId, { onSuccess: () => toast.success('Undone: put back as it was'), onError: (e) => toast.error(e.message) })}
    >
      <Undo2Icon />
      {undo.isPending ? 'Undoing…' : label}
    </Button>
  )
}
