import { createContext, useContext } from 'react'

/**
 * The small "AI" tag on a field AI Fill filled (Connor, 2026-11-19). The 1003
 * provides which keys are still AI-filled; anywhere else nothing shows. A
 * click confirms the value and the tag goes away; editing the value does too.
 */
export interface AiBadges {
  keys: ReadonlySet<string>
  confirm: (keys: string[]) => void
}

const AiBadgeContext = createContext<AiBadges | null>(null)
export const AiBadgeProvider = AiBadgeContext.Provider

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

/** The tag for a row (a job, an account, a debt): any of its keys, confirmed together. */
export function AiRowBadge({ prefixes }: { prefixes?: string[] }) {
  const ctx = useContext(AiBadgeContext)
  if (!ctx || !prefixes?.length) return null
  const keys = [...ctx.keys].filter((k) => prefixes.some((p) => (p.endsWith(':') ? k.startsWith(p) : k === p)))
  return <Tag keys={keys} what="this row" />
}
