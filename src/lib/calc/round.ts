/** Round to a fixed number of decimal places (default 2, i.e. cents). */
export function round(value: number, decimals = 2): number {
  const factor = 10 ** decimals
  return Math.round((value + Number.EPSILON) * factor) / factor
}

/**
 * Percentage of `part` over `whole`, e.g. pct(400_000, 500_000) === 80.
 * Returns null when `whole` is zero or missing, so screens can show "—"
 * instead of Infinity or NaN.
 */
export function pct(part: number, whole: number, decimals = 3): number | null {
  if (!whole || !Number.isFinite(whole) || !Number.isFinite(part)) return null
  return round((part / whole) * 100, decimals)
}
