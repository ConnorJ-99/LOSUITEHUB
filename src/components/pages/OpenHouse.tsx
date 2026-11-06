// The open house site (Pages Phase 2; mockup "Open house site · phone"): photos,
// price and details, the open house time with directions, and the financing
// table, above the visitor sign-in form. Numbers come saved with the page
// (src/lib/pages/openHouse.ts), so nothing is recalculated here.
import { useState } from 'react'
import { HomeIcon, MapPinIcon } from 'lucide-react'
import { cn } from 'cn'
import { formatPhone } from '@/lib/pipeline/helpers'
import { FINANCING_DISCLAIMER, openHouseWhen, type OpenHouseProperty } from '@/lib/pages/openHouse'
import type { PublicPage } from '@/lib/api/pages'

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`
const pct = (n: number) => `${Number(n.toFixed(3))}%`

/** "SAT 1–4 PM" for the photo badge. */
function shortWhen(p: OpenHouseProperty): string | null {
  const full = openHouseWhen(p)
  if (!full) return null
  const [day, time] = full.split(' · ')
  return `${day.split(',')[0].toUpperCase()}${time ? ` ${time.replace(/:00/g, '')}` : ''}`
}

export function OpenHouseHeader({ property: p }: { property: OpenHouseProperty }) {
  const [index, setIndex] = useState(0)
  const when = openHouseWhen(p)
  const badge = shortWhen(p)
  const directions = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([p.address, p.cityLine].filter(Boolean).join(', '))}`
  return (
    <div>
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-navy">
        {p.photos.length ? (
          <div
            className="flex h-full snap-x snap-mandatory overflow-x-auto [scrollbar-width:none]"
            onScroll={(e) => setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
          >
            {p.photos.map((src, i) => (
              <img key={src} src={src} alt={i === 0 ? p.address : ''} className="h-full w-full shrink-0 snap-center object-cover" loading={i === 0 ? 'eager' : 'lazy'} />
            ))}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-white/50">
            <HomeIcon className="size-16" />
          </div>
        )}
        {badge && <span className="absolute top-3 left-3 rounded-full bg-white px-3 py-1.5 text-xs font-bold tracking-wide text-navy shadow-soft">OPEN HOUSE · {badge}</span>}
        {p.photos.length > 1 && (
          <span className="absolute right-3 bottom-3 rounded-full bg-navy/80 px-2.5 py-1 text-xs font-semibold text-white">
            {Math.min(index + 1, p.photos.length)} / {p.photos.length}
          </span>
        )}
      </div>
      <div className="space-y-3 px-4 pt-4">
        {p.listPrice ? <p className="text-[34px] leading-none font-bold tracking-tight tabular-nums">{money(p.listPrice)}</p> : null}
        <p className="text-lg">{[p.address, p.cityLine].filter(Boolean).join(', ') || 'Address'}</p>
        <div className="flex flex-wrap gap-2">
          {p.beds != null && <Chip strong={String(p.beds)} label="beds" />}
          {p.baths != null && <Chip strong={String(p.baths)} label="baths" />}
          {p.sqft != null && <Chip strong={p.sqft.toLocaleString('en-US')} label="sq ft" />}
        </div>
        {when && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-navy px-4 py-3 text-white">
            <div>
              <p className="text-xs font-semibold tracking-wide text-white/70 uppercase">Open house</p>
              <p className="text-lg font-bold">{when}</p>
            </div>
            <a href={directions} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold underline underline-offset-2">
              <MapPinIcon className="size-4" />
              Directions
            </a>
          </div>
        )}
      </div>
    </div>
  )
}

function Chip({ strong, label }: { strong: string; label: string }) {
  return (
    <span className="rounded-lg border bg-white px-3 py-1.5 text-sm">
      <span className="font-bold">{strong}</span> {label}
    </span>
  )
}

/** "What it could cost you": the programs Connor ticked, with their saved figures. */
export function FinancingCard({ property: p }: { property: OpenHouseProperty }) {
  const shown = p.financing.filter((o) => o.show && o.figures)
  if (!shown.length) return null
  return (
    <div className="space-y-3 rounded-2xl border bg-white p-5 shadow-soft">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">What it could cost you</h2>
        <p className="text-sm text-muted-foreground">Estimated monthly payment including taxes, insurance, HOA and mortgage insurance.</p>
      </div>
      {shown.map((o, i) => (
        <div key={o.key} className={cn('flex items-center justify-between gap-3 rounded-xl border p-3.5', i === 0 && 'border-primary bg-primary/5 ring-1 ring-primary')}>
          <div className="min-w-0">
            <p className="font-bold">{o.label}</p>
            <p className="text-sm text-muted-foreground">
              {pct(o.downPct)} down · {money(o.figures!.downPayment)} · {pct(o.ratePct!)}
            </p>
            <p className="text-xs text-muted-foreground">Est. cash to close {money(o.figures!.cashToClose)}</p>
          </div>
          <div className="shrink-0 text-right">
            <p className="text-2xl font-bold tabular-nums">{money(o.figures!.monthlyPayment)}</p>
            <p className="text-xs text-muted-foreground">/mo est.</p>
          </div>
        </div>
      ))}
      <p className="text-xs leading-relaxed text-muted-foreground">
        {p.ratesAsOf ? `Sample rates as of ${new Date(`${p.ratesAsOf}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}. ` : ''}
        {FINANCING_DISCLAIMER}
      </p>
    </div>
  )
}

function Avatar({ src, name }: { src: string | null | undefined; name: string | null | undefined }) {
  return src ? (
    <img src={src} alt={name ?? ''} className="mx-auto size-16 rounded-full object-cover" />
  ) : (
    <div className="mx-auto flex size-16 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary">{(name ?? '?').split(/\s+/).map((w) => w[0]).slice(0, 2).join('')}</div>
  )
}

/** LO and listing agent side by side (the open house's LO card). */
export function LoAndAgentCards({ owner, agent, agentPhotoUrl, company }: { owner: PublicPage['owner']; agent: PublicPage['agent']; agentPhotoUrl: string | null; company: PublicPage['company'] }) {
  const first = owner?.name?.split(/\s+/)[0]
  return (
    <div className={cn('grid gap-3', agent ? 'grid-cols-2' : 'grid-cols-1')}>
      <div className="space-y-1 rounded-2xl border bg-white p-4 text-center shadow-soft">
        <Avatar src={owner?.photoPath} name={owner?.name} />
        <p className="pt-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Financing</p>
        <p className="font-bold">{owner?.name ?? 'Your loan officer'}</p>
        <p className="text-xs text-muted-foreground">
          {company?.name ?? 'MPS Mortgage'}
          {owner?.nmls ? ` · NMLS #${owner.nmls}` : ''}
        </p>
        {owner?.phone && (
          <a href={`sms:${owner.phone}`} className="inline-block pt-1 text-sm font-semibold text-primary underline underline-offset-2">
            Text {first ?? 'me'}
          </a>
        )}
      </div>
      {agent && (
        <div className="space-y-1 rounded-2xl border bg-white p-4 text-center shadow-soft">
          <Avatar src={agentPhotoUrl} name={agent.name} />
          <p className="pt-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Listing agent</p>
          <p className="font-bold">{agent.name}</p>
          {agent.company && <p className="text-xs text-muted-foreground">{agent.company}</p>}
          {agent.phone && (
            <a href={`tel:${agent.phone}`} className="inline-block pt-1 text-sm font-semibold text-primary underline underline-offset-2">
              Call {formatPhone(agent.phone)}
            </a>
          )}
        </div>
      )}
    </div>
  )
}
