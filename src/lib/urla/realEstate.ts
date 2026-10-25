import type { Property } from '@/lib/api/types'

/** The properties that count as "real estate owned" on the 1003 (section 3). */
export function ownedProperties(properties: Property[] | undefined): Property[] {
  return (properties ?? []).filter((p) => p.status === 'current_home' || p.status === 'owned')
}
