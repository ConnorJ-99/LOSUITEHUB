import { DEFAULT_MAX_DTI } from '@/lib/calc'

export const LOAN_TYPES = [
  { value: 'conventional', label: 'Conventional' },
  { value: 'fha', label: 'FHA' },
  { value: 'va', label: 'VA' },
  { value: 'usda_rural', label: 'USDA' },
] as const

export const TERMS = [
  { months: 360, label: '30 years' },
  { months: 240, label: '20 years' },
  { months: 180, label: '15 years' },
] as const

export const DEFAULT_DTI_LABELS = `Defaults: Conv ${DEFAULT_MAX_DTI.conventional}%, FHA ${DEFAULT_MAX_DTI.fha}%, VA ${DEFAULT_MAX_DTI.va}%, USDA ${DEFAULT_MAX_DTI.usda_rural}%`

/** A key for a row added on the call (not saved yet). */
export const newKey = () => `new-${crypto.randomUUID()}`
