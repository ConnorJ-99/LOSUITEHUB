// Pieces shared by the pipeline overview and the boards (Pipeline redesign):
// the lead-type chips (a color legend with counts that also filters) and the
// search box.
import { SearchIcon } from 'lucide-react'
import { cardType, type CardFile } from '@/lib/pipeline/card'
import { LEAD_TYPES, type LeadTypeId } from '@/lib/pipeline/leadType'

/** Click a type to show only it; click it again to show everything. */
export function TypeChips({ files, value, onChange }: { files: CardFile[]; value: LeadTypeId | null; onChange: (v: LeadTypeId | null) => void }) {
  const counts = new Map<LeadTypeId, number>()
  for (const f of files) counts.set(cardType(f), (counts.get(cardType(f)) ?? 0) + 1)
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter by loan type">
      {LEAD_TYPES.map((t) => {
        const on = value === t.id
        const n = counts.get(t.id) ?? 0
        return (
          <button
            key={t.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? null : t.id)}
            className="rounded-full px-[11px] py-[5px] text-xs font-bold"
            style={{ border: `1.5px solid ${t.color}`, background: on ? t.color : '#fff', color: on ? '#fff' : t.color, opacity: n || on ? 1 : 0.45 }}
          >
            {t.label} <span className="font-semibold">{n}</span>
          </button>
        )
      })}
    </div>
  )
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex h-10 min-w-0 flex-[0_1_280px] items-center gap-2 rounded-lg border border-[#d8dde5] bg-white px-3">
      <SearchIcon className="size-4 shrink-0 text-[#5b6472]" />
      <input aria-label={placeholder} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="w-full min-w-0 bg-transparent text-[13px] outline-none" />
    </label>
  )
}
