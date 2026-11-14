// Lead types and their colors (Pipeline redesign, Connor 2026-11-13). Change a
// color or a label here and every card, chip and legend follows. A file's type
// is loans.lead_type when Connor set it; otherwise it's worked out from what
// the file knows (the program's family, the mortgage type, the income
// documentation, a HELOC purpose), and CONV when nothing says otherwise. Pure.

export const LEAD_TYPES = [
  { id: 'conv', label: 'CONV', color: '#1d5fc4' },
  { id: 'fha', label: 'FHA', color: '#0f766e' },
  { id: 'va', label: 'VA', color: '#6d28d9' },
  { id: 'usda', label: 'USDA', color: '#4d7c0f' },
  { id: 'jumbo', label: 'JUMBO', color: '#334155' },
  { id: 'dscr', label: 'DSCR', color: '#c2410c' },
  { id: 'bank_stmt', label: 'BANK STMT', color: '#be185d' },
  { id: 'nonqm_other', label: 'NON-QM OTHER', color: '#a16207' },
  { id: 'heloc', label: 'HELOC', color: '#15803d' },
] as const

export type LeadTypeId = (typeof LEAD_TYPES)[number]['id']
export const leadTypeInfo = (id: LeadTypeId) => LEAD_TYPES.find((t) => t.id === id)!
export const isLeadType = (v: unknown): v is LeadTypeId => LEAD_TYPES.some((t) => t.id === v)

export interface LeadTypeFacts {
  /** loans.lead_type: Connor's pick, else null. */
  leadType: string | null
  purpose: string
  /** The selected program's family: conventional, fha, va, usda, jumbo, non_qm. */
  programFamily: string | null
  /** loans.mortgage_type: conventional, fha, va, usda_rural, other. */
  mortgageType: string | null
  /** loans.income_doc_type: full_doc, bank_statement, form_1099, asset_based, dscr. */
  incomeDocType: string | null
}

export function leadTypeFor(f: LeadTypeFacts): LeadTypeId {
  if (isLeadType(f.leadType)) return f.leadType
  if (f.purpose === 'heloc' || f.purpose === 'heloan') return 'heloc'
  if (f.incomeDocType === 'dscr') return 'dscr'
  if (f.incomeDocType === 'bank_statement') return 'bank_stmt'
  if (f.programFamily === 'non_qm' || f.incomeDocType === 'form_1099' || f.incomeDocType === 'asset_based') return 'nonqm_other'
  if (f.programFamily === 'jumbo') return 'jumbo'
  const t = f.programFamily ?? f.mortgageType
  if (t === 'fha') return 'fha'
  if (t === 'va') return 'va'
  if (t === 'usda' || t === 'usda_rural') return 'usda'
  return 'conv'
}
