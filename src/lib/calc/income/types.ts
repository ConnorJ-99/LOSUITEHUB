/** One step of an income calculation, shown on the worksheet so the math can be explained. */
export interface IncomeLine {
  label: string
  amount: number
  /** "add", "subtract" or "total"-style lines are formatted differently on screen. */
  kind?: 'add' | 'subtract' | 'subtotal' | 'result'
}

export interface IncomeResult {
  /** Qualifying monthly income (can be negative for a self-employment loss). */
  monthly: number
  lines: IncomeLine[]
  warnings: string[]
}
