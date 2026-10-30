import type { Tone } from '@/lib/messaging/thread'

/** Chip colours for consent and match states. */
export const TONE_CLASS: Record<Tone, string> = {
  ok: 'rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700',
  warn: 'rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800',
  bad: 'rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700',
}
