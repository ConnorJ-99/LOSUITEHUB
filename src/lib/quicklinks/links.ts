// Quick Links (Connor, 2026-11-17): the rules behind the page, pure and tested.
// Lender portals, county CAD / tax office links, the Arive login, pins and the
// logo fallback (uploaded or pasted logo, then the site's icon, then initials).

export type QuickLinkCategory = 'system' | 'county_tax' | 'other'

export interface QuickLink {
  id: string
  category: QuickLinkCategory
  name: string
  url: string
  /** County tax office (CAD is `url`); blank hides the Tax office button. */
  secondaryUrl: string | null
  subtitle: string | null
  /** A file in the logos bucket ("<organization>/<file>") or a pasted https:// address. */
  logoPath: string | null
  sortOrder: number
}

/** The lender fields Quick Links uses. */
export interface PortalLender {
  id: string
  name: string
  shortName: string | null
  status: string
  portalUrl: string | null
  logoPath: string | null
  /** Undefined until the quick links script has run (treated as shown). */
  showInQuickLinks?: boolean
}

export type PinType = 'lender' | 'quick_link'

export interface Pin {
  id: string
  linkType: PinType
  linkId: string
  sortOrder: number
}

export const CATEGORY_LABELS: Record<QuickLinkCategory, string> = {
  system: 'Systems',
  county_tax: 'County tax and appraisal',
  other: 'Other links',
}

/** Adds https:// when someone pastes "www.example.com". Blank stays blank. */
export function normalizeUrl(value: string | null | undefined): string | null {
  const v = value?.trim() ?? ''
  if (!v) return null
  return /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`
}

/** Why a link can't be saved, or null when it's fine (blank is fine unless required). */
export function urlProblem(value: string | null | undefined, required = false): string | null {
  const v = normalizeUrl(value)
  if (!v) return required ? 'Enter the web address.' : null
  if (!/^https?:\/\//i.test(v)) return 'The address must start with https://'
  if (/\s/.test(v)) return "A web address can't have spaces."
  try {
    const u = new URL(v)
    if (!u.hostname.includes('.')) return "That isn't a web address."
  } catch {
    return "That isn't a web address."
  }
  return null
}

/** The company's Arive login: https://<company>.myarive.com (blank = not set). */
export function ariveLoginProblem(value: string | null | undefined): string | null {
  const v = normalizeUrl(value)
  if (!v) return null
  let host: string
  try {
    const u = new URL(v)
    if (u.protocol !== 'https:') return 'The Arive login must start with https://'
    host = u.hostname.toLowerCase()
  } catch {
    return "That isn't a web address."
  }
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.myarive\.com$/.test(host)) return 'Your Arive login ends in .myarive.com (e.g. https://mpsmortgage.myarive.com).'
  return null
}

/** The site's own icon, from Google's favicon service, or null without a usable address. */
export function faviconUrl(url: string | null | undefined): string | null {
  const v = normalizeUrl(url)
  if (!v) return null
  try {
    const host = new URL(v).hostname
    return host.includes('.') ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=128` : null
  } catch {
    return null
  }
}

/** Up to two letters for the badge: "United Wholesale Mortgage" → "UW", "Newfi" → "NE". */
export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  if (words.length === 0) return '?'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** Badge colors (Tailwind classes), picked from the name so a lender always gets the same one. */
export const BADGE_COLORS = [
  'bg-sky-100 text-sky-800',
  'bg-emerald-100 text-emerald-800',
  'bg-amber-100 text-amber-800',
  'bg-rose-100 text-rose-800',
  'bg-violet-100 text-violet-800',
  'bg-teal-100 text-teal-800',
  'bg-orange-100 text-orange-800',
  'bg-indigo-100 text-indigo-800',
]

export function badgeColor(name: string): string {
  let h = 0
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return BADGE_COLORS[h % BADGE_COLORS.length]
}

/** Is the logo a pasted web address (shown as is) rather than an uploaded file? */
export const isLogoUrl = (logoPath: string | null | undefined): boolean => /^https:\/\//i.test(logoPath ?? '')

/** The images to try for a tile, in order: the logo, then the site's icon. Initials come after both. */
export function logoCandidates(logo: string | null | undefined, siteUrl: string | null | undefined): string[] {
  return [logo ?? null, faviconUrl(siteUrl)].filter((x): x is string => !!x)
}

/** Every typed word appears somewhere in the given texts (case doesn't matter). Blank matches everything. */
export function matchesSearch(query: string, ...texts: (string | null | undefined)[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const hay = texts.filter(Boolean).join(' ').toLowerCase()
  return words.every((w) => hay.includes(w))
}

const shown = (l: PortalLender) => l.showInQuickLinks !== false

/** Lender portals: lenders with a portal link that are shown on Quick Links, A–Z. */
export function portalLenders<T extends PortalLender>(lenders: T[]): T[] {
  return lenders.filter((l) => shown(l) && !!l.portalUrl?.trim()).sort((a, b) => a.name.localeCompare(b.name))
}

/** Lenders with no portal link yet (shown ones, not inactive), A–Z: the admin's "missing" list. */
export function lendersMissingPortal<T extends PortalLender>(lenders: T[]): T[] {
  return lenders.filter((l) => shown(l) && l.status !== 'inactive' && !l.portalUrl?.trim()).sort((a, b) => a.name.localeCompare(b.name))
}

/** Links in one category, by sort order then name. */
export function linksIn(links: QuickLink[], category: QuickLinkCategory): QuickLink[] {
  return links.filter((l) => l.category === category).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
}

export type PinnedItem<L extends PortalLender> = { pin: Pin; kind: 'lender'; lender: L } | { pin: Pin; kind: 'quick_link'; link: QuickLink }

/**
 * The Pinned row, in pin order. A pin whose lender lost its portal link or was
 * hidden, or whose link is gone, is left out (the pin itself stays).
 */
export function pinnedItems<L extends PortalLender>(pins: Pin[], lenders: L[], links: QuickLink[]): PinnedItem<L>[] {
  const lenderById = new Map(portalLenders(lenders).map((l) => [l.id, l]))
  const linkById = new Map(links.map((l) => [l.id, l]))
  const out: PinnedItem<L>[] = []
  for (const pin of [...pins].sort((a, b) => a.sortOrder - b.sortOrder)) {
    if (pin.linkType === 'lender') {
      const lender = lenderById.get(pin.linkId)
      if (lender) out.push({ pin, kind: 'lender', lender })
    } else {
      const link = linkById.get(pin.linkId)
      if (link) out.push({ pin, kind: 'quick_link', link })
    }
  }
  return out
}

/** The pin for a tile, if this person pinned it. */
export const pinFor = (pins: Pin[], linkType: PinType, linkId: string): Pin | undefined => pins.find((p) => p.linkType === linkType && p.linkId === linkId)
