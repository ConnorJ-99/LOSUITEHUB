import { createContext, useContext } from 'react'

/**
 * The small "AI" tag on a field AI Fill filled (Connor, 2026-11-19). The 1003
 * provides which keys are still AI-filled; anywhere else nothing shows. A
 * click confirms the value and the tag goes away; editing the value does too.
 * After an AI fill, required fields still empty are marked "Still need to ask".
 */
export interface AiBadges {
  keys: ReadonlySet<string>
  /** Required 1003 fields still empty after an AI fill (shown light orange). */
  ask?: ReadonlySet<string>
  confirm: (keys: string[]) => void
}

const AiBadgeContext = createContext<AiBadges | null>(null)
export const AiBadgeProvider = AiBadgeContext.Provider

/** How a field should look: filled by AI (light blue), still to ask (light orange), or as usual. */
export type AiFieldState = 'filled' | 'ask' | null

export function useAiFieldState(k?: string): AiFieldState {
  const ctx = useContext(AiBadgeContext)
  if (!ctx || !k) return null
  if (ctx.keys.has(k)) return 'filled'
  return ctx.ask?.has(k) ? 'ask' : null
}

/** The field tint for each state (inputs, text areas and select boxes inside the field). */
export const AI_FIELD_TINT: Record<'filled' | 'ask', string> = {
  filled:
    '[&_input]:!border-blue-400/60 [&_input]:!bg-blue-500/10 [&_textarea]:!border-blue-400/60 [&_textarea]:!bg-blue-500/10 [&_[data-slot=select-trigger]]:!border-blue-400/60 [&_[data-slot=select-trigger]]:!bg-blue-500/10',
  ask:
    '[&_input]:!border-amber-500/70 [&_input]:!bg-amber-500/10 [&_input::placeholder]:!text-amber-700 [&_textarea]:!border-amber-500/70 [&_textarea]:!bg-amber-500/10 [&_[data-slot=select-trigger]]:!border-amber-500/70 [&_[data-slot=select-trigger]]:!bg-amber-500/10 [&_[data-slot=select-value]]:!text-amber-700',
}

export const STILL_NEED_TO_ASK = 'Still need to ask'

function Tag({ keys, what }: { keys: string[]; what: string }) {
  const ctx = useContext(AiBadgeContext)
  if (!ctx || !keys.length) return null
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        ctx.confirm(keys)
      }}
      title={`Filled by AI from call notes. Click to confirm ${what}.`}
      aria-label={`AI filled. Confirm ${what}`}
      className="inline-flex shrink-0 items-center rounded bg-red-600 px-1 py-px text-[0.6rem] leading-tight font-bold text-white hover:bg-red-700"
    >
      AI
    </button>
  )
}

/** The tag for one field, shown while its key is still AI-filled. */
export function AiBadge({ k }: { k?: string }) {
  const ctx = useContext(AiBadgeContext)
  if (!ctx || !k || !ctx.keys.has(k)) return null
  return <Tag keys={[k]} what="this value" />
}

/** The keys of a row (a job, an account, a debt) that are still AI-filled. */
export function useAiRowKeys(prefixes?: string[]): string[] {
  const ctx = useContext(AiBadgeContext)
  if (!ctx || !prefixes?.length) return []
  return [...ctx.keys].filter((k) => prefixes.some((p) => (p.endsWith(':') ? k.startsWith(p) : k === p)))
}

/** The tag for a row: any of its keys, confirmed together. */
export function AiRowBadge({ prefixes }: { prefixes?: string[] }) {
  const keys = useAiRowKeys(prefixes)
  return <Tag keys={keys} what="this row" />
}
