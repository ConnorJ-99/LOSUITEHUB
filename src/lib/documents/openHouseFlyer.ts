// The open house flyer (Pages Phase 2b, mockup "Open house flyer · Letter
// PDF"): one 8.5×11 page with a locked layout, made from the same saved data
// as the live page: hero photo, the open house time, price and details, the
// financing table, a QR code to the live page, the loan officer and the
// listing agent. This works out every word and number; the PDF only lays
// them out. Pure.
import { FINANCING_DISCLAIMER, type OpenHouseProperty } from '@/lib/pages/openHouse'

export const FLYER_TEMPLATE = 'open-house-flyer v1'

export interface FlyerPerson {
  name: string
  line: string | null
  phone: string | null
  email: string | null
  /** A JPEG/PNG data URL (the PDF can't read WebP or follow links itself). */
  photo: string | null
}

export interface FlyerRow {
  program: string
  down: string
  rate: string
  cashToClose: string
  payment: string
}

export interface FlyerView {
  hero: string | null
  /** "Saturday 1–4 PM", or "Open house" with no date. */
  headline: string
  /** "November 14 · 4218 Fairway Bend Dr, Frisco". */
  dateLine: string
  details: string | null
  price: string | null
  rows: FlyerRow[]
  /** "Payments include principal & interest, taxes ($849), insurance ($180), HOA ($75)…". */
  costsNote: string
  url: string
  lo: FlyerPerson
  agent: FlyerPerson | null
  company: { name: string; nmls: string }
  disclaimer: string
}

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const rate = (n: number) => `${n.toFixed(3)}%`
const pct = (n: number) => `${Number(n.toFixed(2))}%`
const phone = (d: string | null) => {
  const x = (d ?? '').replace(/\D/g, '').slice(-10)
  return x.length === 10 ? `(${x.slice(0, 3)}) ${x.slice(3, 6)}-${x.slice(6)}` : d
}

function clock(hhmm: string | null): { h: number; m: number } | null {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(hhmm)) return null
  const [h, m] = hhmm.split(':').map(Number)
  return { h, m }
}
const short = (t: { h: number; m: number }) => `${((t.h + 11) % 12) + 1}${t.m ? `:${String(t.m).padStart(2, '0')}` : ''}`

/** "Saturday 1–4 PM" / "Sunday 11 AM–2 PM". */
export function flyerHeadline(p: Pick<OpenHouseProperty, 'openDate' | 'startTime' | 'endTime'>): string {
  if (!p.openDate) return 'Open house'
  const d = new Date(`${p.openDate}T12:00:00`)
  if (Number.isNaN(d.getTime())) return 'Open house'
  const day = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(d)
  const a = clock(p.startTime)
  const b = clock(p.endTime)
  if (!a) return day
  const ap = (t: { h: number }) => (t.h >= 12 ? 'PM' : 'AM')
  if (!b) return `${day} ${short(a)} ${ap(a)}`
  return `${day} ${short(a)}${ap(a) === ap(b) ? '' : ` ${ap(a)}`}–${short(b)} ${ap(b)}`
}

export interface FlyerInput {
  property: OpenHouseProperty
  url: string
  hero: string | null
  lo: { name: string | null; nmls: string | null; phone: string | null; email: string | null; photo: string | null }
  agent: { name: string; company: string | null; phone: string | null; email: string | null; photo: string | null } | null
  company: { name: string; nmls: string } | null
}

export function flyerView(i: FlyerInput): FlyerView {
  const p = i.property
  const city = p.cityLine.split(',')[0]?.trim()
  const date = p.openDate ? new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric' }).format(new Date(`${p.openDate}T12:00:00`)) : null
  const details = [p.beds != null && `${p.beds} beds`, p.baths != null && `${p.baths} baths`, p.sqft != null && `${p.sqft.toLocaleString('en-US')} sq ft`].filter(Boolean).join(' · ') || null
  const rows = p.financing
    .filter((o) => o.show && o.figures && o.ratePct != null)
    .map((o) => ({ program: o.label, down: `${pct(o.downPct)} · ${money(o.figures!.downPayment)}`, rate: rate(o.ratePct!), cashToClose: money(o.figures!.cashToClose), payment: money(o.figures!.monthlyPayment) }))
  const costs = [p.taxesMonthly ? `taxes (${money(p.taxesMonthly)})` : null, p.insuranceMonthly ? `insurance (${money(p.insuranceMonthly)})` : null, p.hoaMonthly ? `HOA (${money(p.hoaMonthly)})` : null].filter(Boolean)
  const company = i.company ?? { name: 'MPS Mortgage LLC', nmls: '2501110' }
  const asOf = p.ratesAsOf ? new Date(`${p.ratesAsOf}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : null
  return {
    hero: i.hero,
    headline: flyerHeadline(p),
    dateLine: [date, [p.address.trim(), city].filter(Boolean).join(', ')].filter(Boolean).join(' · '),
    details,
    price: p.listPrice ? money(p.listPrice) : null,
    rows,
    costsNote: `Payments include principal & interest${costs.length ? `, ${costs.join(', ')}` : ''} and mortgage insurance where required. 30-year fixed.`,
    url: i.url,
    lo: { name: i.lo.name ?? 'Your loan officer', line: i.lo.nmls ? `Loan Officer · NMLS #${i.lo.nmls}` : 'Loan Officer', phone: phone(i.lo.phone), email: i.lo.email, photo: i.lo.photo },
    agent: i.agent ? { name: i.agent.name, line: i.agent.company, phone: phone(i.agent.phone), email: i.agent.email, photo: i.agent.photo } : null,
    company,
    disclaimer: `${company.name} · NMLS #${company.nmls} · Equal Housing Opportunity. ${asOf ? `Sample rates as of ${asOf}. ` : ''}${FINANCING_DISCLAIMER} Listing information deemed reliable but not guaranteed.`,
  }
}

/** What stops a flyer: it needs a live link for the QR code, a price, a program to show and the NMLS numbers. */
export function flyerProblems(i: { published: boolean; property: OpenHouseProperty; loNmls: string | null }): string[] {
  const out: string[] = []
  if (!i.published) out.push('Publish the page first, so the QR code opens a live page.')
  if (!i.property.address.trim()) out.push('Add the address.')
  if (!i.property.listPrice) out.push('Add the list price.')
  if (!i.property.financing.some((o) => o.show && o.figures)) out.push('Type a rate for at least one program you show.')
  if (!i.loNmls) out.push("Add your NMLS # in Settings → My profile (it's required on the flyer).")
  return out
}

/** "open-house-4218-fairway-bend-dr.pdf". */
export const flyerFileName = (address: string) => `open-house-${address.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'flyer'}.pdf`
