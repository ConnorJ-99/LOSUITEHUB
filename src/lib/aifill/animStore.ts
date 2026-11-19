import { useSyncExternalStore } from 'react'

// AI Fill's animation (step 3, Connor 2026-11-19): while cards fly into the
// 1003 section nav, the nav shows these counts (ticking down one landing at a
// time) and pulses the group a card just landed on. Null counts = the nav
// shows the real validation, as always.

export interface AiFillAnim {
  /** Missing count per nav group id ("section-1"…) while animating; null otherwise. */
  counts: Record<string, number> | null
  /** The nav group that just got a card, and a tick so the same group can pulse twice. */
  pulse: { id: string; tick: number } | null
}

let state: AiFillAnim = { counts: null, pulse: null }
const listeners = new Set<() => void>()

export function setAiFillAnim(next: Partial<AiFillAnim>) {
  state = { ...state, ...next }
  for (const l of listeners) l()
}

export const resetAiFillAnim = () => setAiFillAnim({ counts: null, pulse: null })

export function useAiFillAnim(): AiFillAnim {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
}

/**
 * The counts shown after `landed` of `total` cards have reached a group: they
 * move evenly from the count before the fill to the count after, so the last
 * landing shows the real number (which can also go up, e.g. a new job adds its
 * own required fields).
 */
export function tickCount(before: number, after: number, landed: number, total: number): number {
  if (total <= 0 || landed >= total) return after
  return Math.round(before + ((after - before) * landed) / total)
}
