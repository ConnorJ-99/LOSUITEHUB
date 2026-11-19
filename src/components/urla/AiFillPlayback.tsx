import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { cn } from 'cn'
import { resetAiFillAnim, setAiFillAnim, tickCount } from '@/lib/aifill/animStore'
import { highlightPieces, SECTION_DOT, SECTION_HL, SECTION_NAME } from '@/lib/aifill/sections'
import type { FillSection } from '@/lib/aifill/plan'

export interface AnimItem {
  key: string
  section: FillSection
  /** The nav group it lands on ("section-1"…). */
  group: string
  /** The 1003 section card it fills (its anchor id), outlined while the card is on its way. */
  anchor: string
  /** The words from the notes, shown first on the card. */
  raw: string
  /** Where those words are in the notes, for the highlight. */
  range: [number, number] | null
  /** The formatted label the card changes to. */
  label: string
}

/** One card's moments, in ms from its start (the mockup's timing). */
const STEP = 1150
const FORMAT_AT = 320
const FLY_AT = 650
const LAND_AT = 1100

type Stage = 'waiting' | 'raw' | 'formatted' | 'flying' | 'landed'

/** The visible nav button for a group (the column on a computer, the row on a phone). */
function navTarget(group: string): DOMRect | null {
  for (const el of document.querySelectorAll<HTMLElement>(`[data-aifill-nav="${group}"]`)) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return r
  }
  return null
}

const CARD_W = 300

/**
 * AI Fill's playback (step 3, Connor 2026-11-19): for each fact, about a
 * second apart, its words light up in the notes in the section's color, a
 * card pops up and turns from the raw words into the formatted value, then
 * shrinks and flies to that section in the 1003 nav, which pulses as its
 * missing count ticks down. "Skip animation" jumps to the end. With reduced
 * motion the cards only fade and the counts update. The 1003 is already
 * saved; this only shows it.
 */
export function AiFillPlayback({
  notes,
  items,
  before,
  after,
  onDone,
}: {
  notes: string
  items: AnimItem[]
  /** Missing per nav group before and after the fill. */
  before: Record<string, number>
  after: Record<string, number>
  onDone: () => void
}) {
  const reduced = useReducedMotion()
  const [stages, setStages] = useState<Stage[]>(() => items.map(() => 'waiting'))
  const timers = useRef<number[]>([])
  const box = useRef<HTMLDivElement>(null)
  const [origin, setOrigin] = useState<{ x: number; y: number } | null>(null)
  const finished = useRef(false)

  const finish = () => {
    if (finished.current) return
    finished.current = true
    for (const t of timers.current) clearTimeout(t)
    resetAiFillAnim()
    onDone()
  }

  useEffect(() => {
    const r = box.current?.getBoundingClientRect()
    if (r) setOrigin({ x: r.left + r.width / 2 - CARD_W / 2, y: r.top + Math.min(r.height / 2, 140) })
    setAiFillAnim({ counts: { ...before }, pulse: null })
    const perGroup: Record<string, number> = {}
    for (const it of items) perGroup[it.group] = (perGroup[it.group] ?? 0) + 1
    const landed: Record<string, number> = {}
    const at = (ms: number, fn: () => void) => timers.current.push(window.setTimeout(fn, ms))
    const set = (i: number, s: Stage) => setStages((prev) => prev.map((x, k) => (k === i ? s : x)))
    items.forEach((it, i) => {
      const base = 250 + i * STEP
      at(base, () => {
        set(i, 'raw')
        setAiFillAnim({ incoming: it.anchor })
      })
      at(base + FORMAT_AT, () => set(i, 'formatted'))
      at(base + FLY_AT, () => set(i, 'flying'))
      at(base + LAND_AT, () => {
        set(i, 'landed')
        landed[it.group] = (landed[it.group] ?? 0) + 1
        const counts: Record<string, number> = {}
        for (const g of Object.keys(before)) counts[g] = landed[g] ? tickCount(before[g] ?? 0, after[g] ?? 0, landed[g], perGroup[g]) : (before[g] ?? 0)
        setAiFillAnim({ counts, pulse: { id: it.group, tick: i + 1 }, incoming: null })
      })
    })
    at(250 + items.length * STEP + 250, finish)
    return () => {
      for (const t of timers.current) clearTimeout(t)
      resetAiFillAnim()
    }
    // Runs once per playback.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // The highlights grow as each card is read.
  const marks = items.flatMap((it, i) => (it.range && stages[i] !== 'waiting' ? [{ range: it.range, section: it.section }] : []))
  const pieces = highlightPieces(notes, marks)
  const landedCount = stages.filter((s) => s === 'landed').length

  return (
    <div className="space-y-3">
      <div ref={box} className="relative max-h-[45svh] overflow-y-auto rounded-lg border bg-background md:max-h-[50svh]">
        <div className="px-3 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap" aria-label="Call notes">
          {pieces.map((p, k) =>
            p.section ? (
              <mark key={k} className={cn('rounded-sm bg-transparent text-foreground transition-colors duration-300', SECTION_HL[p.section])}>
                {p.text}
              </mark>
            ) : (
              <span key={k}>{p.text}</span>
            ),
          )}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-muted-foreground" aria-live="polite">
            Filling {landedCount} of {items.length}…
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
              const target = s === 'flying' && !reduced ? navTarget(it.group) : null
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
                    <span className={cn('size-2 rounded-full', SECTION_DOT[it.section])} />
                    {SECTION_NAME(it.section)}
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
