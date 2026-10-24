// Display formatting only. Mortgage math belongs in '@/lib/calc'.

const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
})

const plain = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })

export function formatCurrency(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : usd.format(value)
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
