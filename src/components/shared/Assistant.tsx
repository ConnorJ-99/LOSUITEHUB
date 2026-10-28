import { useState } from 'react'
import type * as React from 'react'
import { CheckIcon, ChevronDownIcon, PencilIcon, QuoteIcon, SparklesIcon, XIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'

// Shared pieces for anything the assistant prepares. Every AI suggestion
// carries the "Assistant" label, its sources, and Approve / Edit / Dismiss.

export type ConfidenceLevel = 'high' | 'medium' | 'low'

export interface SourceRef {
  label: string
  quote: string
  page?: number | null
}

const CONFIDENCE_STYLE: Record<ConfidenceLevel, string> = {
  high: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  medium: 'border-sky-200 bg-sky-50 text-sky-800',
  low: 'border-amber-300 bg-amber-50 text-amber-900',
}

/**
 * Shown in place of an AI action while the assistant isn't set up (the
 * Anthropic key is added later): what turns on, and how to do it without AI.
 */
export function AiOffNote({ what, instead, reason = 'no_key', className }: { what: string; instead?: React.ReactNode; reason?: 'no_key' | 'unreachable'; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-dashed bg-muted/40 px-3 py-2 text-sm', className)}>
      <p className="flex items-center gap-1.5 font-medium">
        <SparklesIcon className="size-3.5 text-muted-foreground" />
        {what} turns on once the AI assistant is set up.
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">
        {reason === 'unreachable' ? "The assistant can't be reached right now." : 'It needs the Anthropic key added in Supabase (Edge Functions → Secrets).'}
        {instead && <> {instead}</>}
      </p>
    </div>
  )
}

/** The "Assistant" label, with confidence when there is one. */
export function AssistantLabel({ confidence }: { confidence?: ConfidenceLevel | null }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[0.7rem] font-semibold text-primary">
        <SparklesIcon className="size-3" />
        Assistant
      </span>
      {confidence && (
        <span className={cn('rounded-full border px-2 py-0.5 text-[0.7rem] font-medium', CONFIDENCE_STYLE[confidence])}>
          {confidence === 'low' ? 'Low confidence: check this' : `${confidence[0].toUpperCase()}${confidence.slice(1)} confidence`}
        </span>
      )}
    </span>
  )
}

/** Where a suggestion came from: quoted text from the call notes or a document, shown on expand. */
export function SourceQuote({ sources, defaultOpen = false }: { sources: SourceRef[]; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  if (sources.length === 0) return null
  return (
    <div className="text-xs">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
        <QuoteIcon className="size-3" />
        {sources.length === 1 ? 'Source' : `${sources.length} sources`}
        <ChevronDownIcon className={cn('size-3 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul className="mt-2 space-y-2">
          {sources.map((s, i) => (
            <li key={i} className="border-l-2 border-primary/30 pl-2">
              <p className="font-medium text-muted-foreground">
                {s.label}
                {s.page != null && `, page ${s.page}`}
              </p>
              <blockquote className="whitespace-pre-wrap text-foreground">“{s.quote}”</blockquote>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export interface QueueItemProps {
  title: string
  /** e.g. "Jane Smith" on Today, so you know which file it's from. */
  context?: React.ReactNode
  confidence?: ConfidenceLevel | null
  sources?: SourceRef[]
  children?: React.ReactNode
  approveLabel?: string
  onApprove?: () => void
  onEdit?: () => void
  onDismiss?: () => void
  /** Why Approve isn't available yet, shown instead of the button. */
  approveDisabledReason?: string
  busy?: boolean
}

/** One Action Queue item: what the assistant prepared, where it came from, and the decision buttons. */
export function QueueItem({ title, context, confidence, sources = [], children, approveLabel = 'Approve', onApprove, onEdit, onDismiss, approveDisabledReason, busy }: QueueItemProps) {
  return (
    <div className={cn('space-y-2 rounded-lg border bg-card p-3', confidence === 'low' && 'border-amber-300')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <AssistantLabel confidence={confidence} />
        {context && <span className="text-xs text-muted-foreground">{context}</span>}
      </div>
      <p className="text-sm font-medium">{title}</p>
      {children}
      <SourceQuote sources={sources} />
      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
        {onDismiss && (
          <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={onDismiss} disabled={busy}>
            <XIcon />
            Dismiss
          </Button>
        )}
        {onEdit && (
          <Button size="sm" variant="outline" onClick={onEdit} disabled={busy}>
            <PencilIcon />
            Edit
          </Button>
        )}
        {approveDisabledReason ? (
          <span className="text-xs text-muted-foreground">{approveDisabledReason}</span>
        ) : (
          onApprove && (
            <Button size="sm" onClick={onApprove} disabled={busy}>
              <CheckIcon />
              {approveLabel}
            </Button>
          )
        )}
      </div>
    </div>
  )
}

export interface ReviewFieldProps {
  label: string
  /** What the file has now (formatted for display). */
  current: string | null
  /** What the assistant suggests (formatted for display). */
  suggested: string
  confidence?: ConfidenceLevel | null
  sources?: SourceRef[]
  /** Null until decided. */
  decision?: 'accepted' | 'ignored' | null
  onAccept: () => void
  onIgnore: () => void
}

/** One suggested field change, accepted or ignored on its own. Low-confidence suggestions are highlighted. */
export function ReviewField({ label, current, suggested, confidence, sources = [], decision = null, onAccept, onIgnore }: ReviewFieldProps) {
  return (
    <div className={cn('grid gap-2 rounded-md border p-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center', confidence === 'low' && 'border-amber-300 bg-amber-50/50', decision && 'opacity-60')}>
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
          {confidence && confidence !== 'high' && <AssistantLabel confidence={confidence} />}
        </div>
        <p className="text-sm">
          <span className="text-muted-foreground line-through decoration-muted-foreground/50">{current ?? 'empty'}</span>
          <span className="mx-1.5 text-muted-foreground">→</span>
          <span className="font-medium">{suggested}</span>
        </p>
        <SourceQuote sources={sources} />
      </div>
      <div className="flex gap-1.5">
        {decision ? (
          <span className="text-xs text-muted-foreground">{decision === 'accepted' ? 'Accepted' : 'Ignored'}</span>
        ) : (
          <>
            <Button size="xs" variant="ghost" onClick={onIgnore}>
              Ignore
            </Button>
            <Button size="xs" onClick={onAccept}>
              Accept
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
