// Changes to the figures an AI income draft filled in (Stage 4d-1): when an
// AI worksheet is saved, each input with a source whose value now differs
// both from the last saved value and from the AI's value is one row in
// income_worksheet_edits (add-only). Only numbers are logged (a pay
// frequency change isn't). Pure, tested.

import type { InputSources } from './fromDocuments'

export interface AiEdit {
  input: string
  aiValue: number | null
  aiQuote: string
  newValue: number | null
}

/** The value at a dotted path inside the inputs ("recent.netProfit"). */
export function inputAt(inputs: unknown, path: string): unknown {
  let v: unknown = inputs
  for (const k of path.split('.')) {
    if (v == null || typeof v !== 'object') return undefined
    v = (v as Record<string, unknown>)[k]
  }
  return v
}

const asNumber = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const same = (a: number | null, b: number | null) => (a == null && b == null) || (a != null && b != null && Math.abs(a - b) < 0.005)

export function aiEdits(sources: InputSources, oldInputs: unknown, newInputs: unknown): AiEdit[] {
  const out: AiEdit[] = []
  for (const [input, s] of Object.entries(sources)) {
    const ai = asNumber(s.value)
    if (ai == null && typeof s.value === 'string') continue // Text inputs (pay frequency) aren't logged.
    const before = asNumber(inputAt(oldInputs, input))
    const after = asNumber(inputAt(newInputs, input))
    if (same(after, before) || same(after, ai)) continue
    out.push({ input, aiValue: ai, aiQuote: s.quote, newValue: after })
  }
  return out
}
