// A personal link's known values put into the form's mapped questions
// (Pages Phase 3). Values come from get_page_link() by "maps to" key; a
// choice or dropdown is filled only when the value is one of its options.
// Pure.
import { isField, type Block } from '../../../supabase/functions/page-submit/blocks'

const money = (v: string) => (Number.isFinite(Number(v)) ? Number(v).toLocaleString('en-US') : v)
const phone = (d: string) => (/^\d{10}$/.test(d) ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : d)

export function prefillAnswers(blocks: Block[], values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const b of blocks) {
    if (!isField(b.type) || !b.mapsTo) continue
    let v: string | null = null
    switch (b.mapsTo) {
      case 'full_name':
        v = [values.first_name, values.last_name].filter(Boolean).join(' ') || null
        break
      case 'phone':
        v = values.phone ? phone(values.phone) : null
        break
      case 'purchase_price':
      case 'cash_out':
        v = values[b.mapsTo] ? (b.type === 'currency' ? money(values[b.mapsTo]) : values[b.mapsTo]) : null
        break
      case 'down_payment':
        v = values.purchase_price && values.loan_amount && Number(values.purchase_price) > Number(values.loan_amount) ? String(Number(values.purchase_price) - Number(values.loan_amount)) : null
        if (v && b.type === 'currency') v = money(v)
        break
      default:
        v = values[b.mapsTo] ?? null
    }
    if (!v) continue
    if ((b.type === 'dropdown' || b.type === 'choice') && !(b.options ?? []).includes(v)) continue
    out[b.id] = v
  }
  return out
}
