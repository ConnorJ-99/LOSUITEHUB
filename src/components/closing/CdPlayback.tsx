import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { cn } from 'cn'
import { cdDot, cdHighlight } from '@/lib/closing/cdColors'
import { CD_GROUPS, type CdGroup } from '@/lib/closing/cdReview'

export interface CdAnimItem {
  key: string
  group: CdGroup
  /** The CD's words, shown first on the card and highlighted in the list. */
  raw: string
  /** What the file now says, e.g. "Loan amount · $320,000". */
  label: string
}

/** AI Fill's timing (AiFillPlayback). */
const STEP = 1150
const FORMAT_AT = 320
const FLY_AT = 650
const LAND_AT = 1100
const CARD_W = 300

type Stage = 'waiting' | 'raw' | 'formatted' | 'flying' | 'landed'

function chipTarget(group: CdGroup): DOMRect | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-cd-nav="${group}"]`)) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return r
  }
  return null
}

/**
 * The final CD's playback (Connor, 2026-11-19: "like the AI reader for the
 * prequal"): the figures are already saved; for each one, about a second
 * apart, its words on the CD light up in its group's color, a card pops up
 * and turns from the CD's words into what the file now says, then flies to
 * its group chip, which pulses as its count ticks up. Skip animation jumps to
 * the end; with reduced motion the cards only fade.
 */
export function CdPlayback({ items, onDone }: { items: CdAnimItem[]; onDone: () => void }) {
  const reduced = useReducedMotion()
  const [stages, setStages] = useState<Stage[]>(() => items.map(() => 'waiting'))
  const [pulse, setPulse] = useState<{ group: CdGroup; tick: number } | null>(null)
  const timers = useRef<number[]>([])
  const box = useRef<HTMLDivElement>(null)
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null)
  const finished = useRef(false)

  const finish = () => {
    if (finished.current) return
    finished.current = true
    for (const t of timers.current) clearTimeout(t)
    onDone()
  }

  useEffect(() => {
    const r = box.current?.getBoundingClientRect()
    if (r) setOrigin({ x: r.left + r.width / 2 - CARD_W / 2, y: r.top + Math.min(r.height / 2, 140) })
    const pending = timers.current
    const at = (ms: number, fn: () => void) => pending.push(window.setTimeout(fn, ms))
    const set = (i: number, s: Stage) => setStages((prev) => prev.map((x, k) => (k === i ? s : x)))
    items.forEach((it, i) => {
      const base = 250 + i * STEP
      at(base, () => set(i, 'raw'))
      at(base + FORMAT_AT, () => set(i, 'formatted'))
      at(base + FLY_AT, () => set(i, 'flying'))
      at(base + LAND_AT, () => {
        set(i, 'landed')
        setPulse({ group: it.group, tick: i + 1 })
      })
    })
    at(250 + items.length * STEP + 250, finish)
    return () => {
      for (const t of pending) clearTimeout(t)
    }
    // Runs once per playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const landedCount = stages.filter((s) => s === 'landed').length
  const groups = CD_GROUPS.filter((g) => items.some((it) => it.group === g.id))

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => {
          const count = items.filter((it, i) => it.group === g.id && stages[i] === 'landed').length
          const total = items.filter((it) => it.group === g.id).length
          return (
            <motion.span
              key={`${g.id}-${pulse?.group === g.id ? pulse.tick : 0}`}
              data-cd-nav={g.id}
              className="inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-semibold"
              initial={pulse?.group === g.id && !reduced ? { scale: 1.12 } : false}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 380, damping: 18 }}
            >
              <span className={cn('size-2 rounded-full', cdDot(g.id))} />
              {g.label}
              <span className="text-muted-foreground tabular-nums">
                {count}/{total}
              </span>
            </motion.span>
          )
        })}
      </div>
      <div ref={box} className="max-h-[45svh] overflow-y-auto rounded-lg border bg-background px-3 py-2 md:max-h-[50svh]">
        <ul className="space-y-1.5 text-sm leading-relaxed" aria-label="From the Closing Disclosure">
          {items.map((it, i) => (
            <li key={it.key}>
              <mark className={cn('rounded-sm bg-transparent text-foreground transition-colors duration-300', stages[i] !== 'waiting' && cdHighlight(it.group))}>{it.raw}</mark>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-muted-foreground" aria-live="polite">
            Updating {landedCount} of {items.length}…
          </p>
          <div className="mt-1.5 h-1.5 rounded-full bg-muted">
            <div className="h-1.5 rounded-full bg-red-600 transition-[width] duration-500" style={{ width: `${Math.round((landedCount / Math.max(1, items.length)) * 100)}%` }} />
          </div>
        </div>
        <button type="button" className="shrink-0 text-sm font-medium text-primary hover:underline" onClick={finish}>
          Skip animation
        </button>
      </div>

      {origin &&
        createPortal(
          <div className="pointer-events-none fixed inset-0 z-[60]" aria-hidden="true">
            {items.map((it, i) => {
              const s = stages[i]
              if (s === 'waiting' || s === 'landed') return null
              const target = s === 'flying' && !reduced ? chipTarget(it.group) : null
              const flyTo = target ? { x: target.left + target.width / 2 - CARD_W / 2, y: target.top + target.height / 2 - 30 } : null
              return (
                <motion.div
                  key={it.key}
                  className="absolute top-0 left-0 rounded-2xl border bg-card px-4 py-3 shadow-2xl"
                  style={{ width: CARD_W }}
                  initial={{ opacity: 0, scale: 0.85, x: origin.x, y: origin.y + 16 }}
                  animate={
                    s === 'flying'
                      ? flyTo
                        ? { opacity: 0.2, scale: 0.18, x: flyTo.x, y: flyTo.y }
                        : { opacity: 0, scale: 0.95, x: origin.x, y: origin.y }
                      : { opacity: 1, scale: 1, x: origin.x, y: origin.y }
                  }
                  transition={s === 'flying' ? { duration: reduced ? 0.25 : 0.45, ease: [0.65, 0, 0.35, 1] } : { type: 'spring', stiffness: 420, damping: 24 }}
                >
                  <p className="flex items-center gap-1.5 text-[0.65rem] font-bold tracking-widest text-muted-foreground uppercase">
                    <span className={cn('size-2 rounded-full', cdDot(it.group))} />
                    {CD_GROUPS.find((g) => g.id === it.group)?.label}
                  </p>
                  <p className={cn('mt-1 text-[0.95rem] leading-snug', s === 'raw' ? 'text-muted-foreground italic' : 'font-semibold')}>{s === 'raw' ? `"${it.raw}"` : it.label}</p>
                </motion.div>
              )
            })}
          </div>,
          document.body,
        )}
    </div>
  )
}
