import type { NoteKind, Occupancy, PropertyStatus, PropertyType } from '@/lib/api/types'

export const OCCUPANCY_OPTIONS: readonly { value: Occupancy; label: string }[] = [
  { value: 'primary', label: 'Primary residence' },
  { value: 'second_home', label: 'Second home' },
  { value: 'investment', label: 'Investment' },
]

export const TERM_OPTIONS = [
  { value: '360', label: '30 years' },
  { value: '300', label: '25 years' },
  { value: '240', label: '20 years' },
  { value: '180', label: '15 years' },
  { value: '120', label: '10 years' },
] as const

export const PROPERTY_STATUS_OPTIONS: readonly { value: PropertyStatus; label: string }[] = [
  { value: 'interested', label: 'Interested' },
  { value: 'offer_made', label: 'Offer made' },
  { value: 'under_contract', label: 'Under contract' },
  { value: 'passed', label: 'Passed' },
  { value: 'current_home', label: 'Current home' },
]

export const PROPERTY_TYPE_OPTIONS: readonly { value: PropertyType; label: string }[] = [
  { value: 'single_family', label: 'Single family' },
  { value: 'condo', label: 'Condo' },
  { value: 'townhouse', label: 'Townhouse' },
  { value: 'two_to_four_unit', label: '2–4 unit' },
  { value: 'manufactured', label: 'Manufactured' },
  { value: 'other', label: 'Other' },
]

export const NOTE_KIND_OPTIONS: readonly { value: NoteKind; label: string }[] = [
  { value: 'note', label: 'Note' },
  { value: 'call', label: 'Call' },
  { value: 'text', label: 'Text' },
  { value: 'email', label: 'Email' },
  { value: 'meeting', label: 'Meeting' },
]

export const propertyStatusLabel = (s: PropertyStatus) => PROPERTY_STATUS_OPTIONS.find((o) => o.value === s)?.label ?? s
export const noteKindLabel = (k: NoteKind) => NOTE_KIND_OPTIONS.find((o) => o.value === k)?.label ?? k
