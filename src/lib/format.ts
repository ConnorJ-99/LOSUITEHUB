// Display formatting only. Mortgage math belongs in '@/lib/calc'.

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const plain = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

const usdCents = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** Whole dollars show as "$1,250"; amounts with cents always show both digits ("$1,905.30"). */
export function formatCurrency(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return Math.round(value * 100) % 100 === 0 ? usd.format(value) : usdCents.format(value)
}

export function formatNumber(value: number | null | undefined, maxDecimals = 2): string {
  if (value == null || !Number.isFinite(value)) return ''
  return maxDecimals === 2
    ? plain.format(value)
    : new Intl.NumberFormat('en-US', { maximumFractionDigits: maxDecimals }).format(value)
}

export function formatPercent(value: number | null | undefined, maxDecimals = 3): string {
  return value == null || !Number.isFinite(value) ? '—' : `${formatNumber(value, maxDecimals)}%`
}

/** Parse what a user typed ("$1,250.50", "6.5%") into a number, or null if empty. */
export function parseNumber(text: string): number | null {
  const cleaned = text.replace(/[^0-9.-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  const value = Number(cleaned)
  return Number.isFinite(value) ? value : null
}

const usdCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })

/** Short money for small tiles: "$388K", "$1.5M". */
export function formatCompactCurrency(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : usdCompact.format(value)
}
