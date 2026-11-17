import { useState } from 'react'
import type * as React from 'react'
import { ChevronDownIcon, ChevronRightIcon, ExternalLinkIcon, PencilIcon, PlusIcon, StarIcon, TriangleAlertIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { PageHeader, SearchInput } from '@/components/shared'
import { AriveLoginDialog, LenderLinkDialog, QuickLinkDialog } from '@/components/quicklinks/EditDialogs'
import { LogoImage } from '@/components/quicklinks/LogoImage'
import { useLenders, type Lender } from '@/lib/api/lenders'
import { useLogoImages, usePins, useQuickLinks, useSaveLenderLink, useTogglePin, type QuickLinkDraft } from '@/lib/api/quickLinks'
import { useOrganization } from '@/lib/api/settings'
import { useAuth } from '@/lib/auth/context'
import {
  CATEGORY_LABELS,
  isLogoUrl,
  lendersMissingPortal,
  linksIn,
  matchesSearch,
  pinFor,
  pinnedItems,
  portalLenders,
  urlProblem,
  type PinType,
  type QuickLink,
} from '@/lib/quicklinks/links'

// Quick Links (Connor, 2026-11-17): Arive, lender portals and county sites in
// one place. Everyone reads and stars; only owners and admins see pencils,
// "+ Add link", the missing-portal list and logo upload (the database refuses
// anyone else either way).

const external = { target: '_blank', rel: 'noopener noreferrer' } as const

const blankLink = (category: QuickLinkDraft['category'] = 'other'): QuickLinkDraft => ({ id: null, category, name: '', url: '', secondaryUrl: null, subtitle: null, logoPath: null, sortOrder: 100 })
const toDraft = (l: QuickLink): QuickLinkDraft => ({ ...l })

export function QuickLinksPage() {
  const { state } = useAuth()
  const isAdmin = state.status === 'signedIn' && (state.user.role === 'owner' || state.user.role === 'admin')
  const orgId = (state.status === 'signedIn' ? state.user.organizationId : null) ?? ''
  const lenders = useLenders()
  const links = useQuickLinks()
  const pins = usePins()
  const org = useOrganization()
  const toggle = useTogglePin()
  const [search, setSearch] = useState('')
  const [editingLink, setEditingLink] = useState<QuickLinkDraft | null>(null)
  const [editingLender, setEditingLender] = useState<Lender | null>(null)
  const [editingArive, setEditingArive] = useState(false)

  const allLenders = lenders.data ?? []
  const allLinks = links.data?.links ?? []
  const myPins = pins.data ?? []
  const ready = links.data?.ready !== false
  const logos = useLogoImages([...allLenders.map((l) => l.logoPath), ...allLinks.map((l) => l.logoPath)])
  const logoSrc = (path: string | null) => (!path ? null : isLogoUrl(path) ? path : (logos.data?.get(path) ?? null))

  const ariveUrl = org.data?.ariveLoginUrl ?? null
  const lenderMatch = (l: Lender) => matchesSearch(search, l.name, l.shortName, 'lender portal')
  const linkMatch = (l: QuickLink) => matchesSearch(search, l.name, l.subtitle, CATEGORY_LABELS[l.category], l.category === 'county_tax' ? 'county cad tax office appraisal' : null)
  const ariveMatch = matchesSearch(search, 'Arive', 'los systems login')

  const pinned = pinnedItems(myPins, allLenders, allLinks).filter((p) => (p.kind === 'lender' ? lenderMatch(p.lender) : linkMatch(p.link)))
  const portals = portalLenders(allLenders).filter(lenderMatch)
  const missing = lendersMissingPortal(allLenders)
  const systems = linksIn(allLinks, 'system').filter(linkMatch)
  const counties = linksIn(allLinks, 'county_tax').filter(linkMatch)
  const others = linksIn(allLinks, 'other').filter(linkMatch)
  const searching = search.trim() !== ''

  const star = (linkType: PinType, linkId: string, name: string) => {
    const pin = pinFor(myPins, linkType, linkId)
    return (
      <StarButton
        pinned={!!pin}
        name={name}
        onClick={() => toggle.mutate({ linkType, linkId, pin }, { onError: (e) => toast.error(e.message) })}
      />
    )
  }
  const pencil = (name: string, onClick: () => void) => (isAdmin ? <EditButton name={name} onClick={onClick} /> : null)

  const lenderTile = (l: Lender) => (
    <Tile
      key={l.id}
      name={l.name}
      logo={<LogoImage name={l.name} logo={logoSrc(l.logoPath)} siteUrl={l.portalUrl} />}
      href={l.portalUrl!}
      openLabel="Open portal"
      star={star('lender', l.id, l.name)}
      pencil={pencil(l.name, () => setEditingLender(l))}
    />
  )
  const linkTile = (l: QuickLink) =>
    l.category === 'county_tax' ? (
      <CountyCard key={l.id} link={l} star={star('quick_link', l.id, l.name)} pencil={pencil(l.name, () => setEditingLink(toDraft(l)))} />
    ) : (
      <Tile
        key={l.id}
        name={l.name}
        subtitle={l.subtitle}
        logo={<LogoImage name={l.name} logo={logoSrc(l.logoPath)} siteUrl={l.url} />}
        href={l.url}
        openLabel="Open"
        star={star('quick_link', l.id, l.name)}
        pencil={pencil(l.name, () => setEditingLink(toDraft(l)))}
      />
    )
  const ariveTile = (
    <Tile
      key="arive"
      name="Arive"
      subtitle="Loan origination system"
      logo={<LogoImage name="Arive" logo={null} siteUrl={ariveUrl} />}
      href={ariveUrl}
      openLabel="Open Arive"
      disabledNote={isAdmin ? null : "Admin hasn't set this yet."}
      adminSetLabel={isAdmin && !ariveUrl ? 'Set Arive URL' : null}
      onAdminSet={() => setEditingArive(true)}
      pencil={ariveUrl ? pencil('Arive', () => setEditingArive(true)) : null}
    />
  )

  const nothing = searching && !pinned.length && !portals.length && !counties.length && !systems.length && !others.length && !ariveMatch

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Quick links"
        description="Arive, lender portals and county sites. Star a link to pin it to the top."
        action={
          isAdmin && ready ? (
            <Button onClick={() => setEditingLink(blankLink())}>
              <PlusIcon /> Add link
            </Button>
          ) : undefined
        }
      />
      <SearchInput label="Search links" value={search} onChange={setSearch} placeholder="Lender, county or link name" className="mb-6 max-w-md" />
      {!ready && (
        <p className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Quick links aren't set up yet. {isAdmin ? 'Run the quick links script (20270213000000_quick_links.sql) in Supabase.' : 'Ask an admin to finish setting them up.'}
        </p>
      )}

      {(!searching || pinned.length > 0) && (
        <Section title="Pinned">
          {pinned.length ? (
            <Grid>{pinned.map((p) => (p.kind === 'lender' ? lenderTile(p.lender) : linkTile(p.link)))}</Grid>
          ) : (
            <p className="rounded-md border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Star any link to pin it here.</p>
          )}
        </Section>
      )}

      {(ariveMatch || systems.length > 0) && (
        <Section title="Systems">
          <Grid>
            {ariveMatch && ariveTile}
            {systems.map(linkTile)}
          </Grid>
        </Section>
      )}

      {(!searching || portals.length > 0) && (
        <Section title="Lender portals">
          {isAdmin && !searching && missing.length > 0 && <MissingPortals lenders={missing} />}
          {portals.length ? (
            <Grid>{portals.map(lenderTile)}</Grid>
          ) : (
            <p className="text-sm text-muted-foreground">{lenders.isLoading ? 'Loading…' : 'No lender portal links yet.'}</p>
          )}
        </Section>
      )}

      {counties.length > 0 && (
        <Section title="County tax and appraisal">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">{counties.map(linkTile)}</div>
        </Section>
      )}

      {others.length > 0 && (
        <Section title="Other links">
          <Grid>{others.map(linkTile)}</Grid>
        </Section>
      )}

      {nothing && <p className="py-8 text-center text-sm text-muted-foreground">Nothing matches “{search.trim()}”.</p>}

      {editingLink && <QuickLinkDialog initial={editingLink} organizationId={orgId} onClose={() => setEditingLink(null)} />}
      {editingLender && <LenderLinkDialog lender={editingLender} organizationId={orgId} onClose={() => setEditingLender(null)} />}
      {editingArive && <AriveLoginDialog current={ariveUrl} onClose={() => setEditingArive(false)} />}
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="eyebrow mb-3">{title}</h2>
      {children}
    </section>
  )
}

/** Two tiles a row on a phone, more on wider screens. */
function Grid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">{children}</div>
}

function StarButton({ pinned, name, onClick }: { pinned: boolean; name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={pinned}
      aria-label={pinned ? `Unpin ${name}` : `Pin ${name}`}
      title={pinned ? 'Unpin' : 'Pin to the top'}
      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
    >
      <StarIcon className={cn('size-4', pinned && 'fill-amber-400 text-amber-500')} />
    </button>
  )
}

function EditButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} aria-label={`Edit ${name}`} title="Edit" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground">
      <PencilIcon className="size-3.5" />
    </button>
  )
}

/** A link tile: logo, name, an open button, star and (admins) pencil. */
function Tile({
  name,
  subtitle,
  logo,
  href,
  openLabel,
  star,
  pencil,
  disabledNote,
  adminSetLabel,
  onAdminSet,
}: {
  name: string
  subtitle?: string | null
  logo: React.ReactNode
  href: string | null
  openLabel: string
  star?: React.ReactNode
  pencil?: React.ReactNode
  disabledNote?: string | null
  adminSetLabel?: string | null
  onAdminSet?: () => void
}) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-3 rounded-lg border bg-card p-3 shadow-soft', !href && 'opacity-80')}>
      <div className="flex items-start justify-between gap-2">
        {logo}
        <div className="-mt-1 -mr-1 flex shrink-0 items-center">
          {pencil}
          {star}
        </div>
      </div>
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 text-sm font-medium break-words" title={name}>
          {name}
        </p>
        {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
      </div>
      {href ? (
        <Button asChild variant="outline" size="sm" className="w-full">
          <a href={href} {...external}>
            {openLabel} <ExternalLinkIcon />
          </a>
        </Button>
      ) : adminSetLabel ? (
        <Button variant="outline" size="sm" className="w-full" onClick={onAdminSet}>
          {adminSetLabel}
        </Button>
      ) : (
        <>
          <Button variant="outline" size="sm" className="w-full" disabled>
            {openLabel}
          </Button>
          {disabledNote && <p className="-mt-1 text-xs text-muted-foreground">{disabledNote}</p>}
        </>
      )}
    </div>
  )
}

/** A county: CAD and (when set) tax office buttons, star and (admins) pencil. */
function CountyCard({ link, star, pencil }: { link: QuickLink; star: React.ReactNode; pencil: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-lg border bg-card p-3 shadow-soft">
      <div className="flex items-center gap-1">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{link.name}</p>
        <div className="-mr-1 flex shrink-0 items-center">
          {pencil}
          {star}
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Button asChild variant="outline" size="xs">
          <a href={link.url} {...external}>
            CAD <ExternalLinkIcon />
          </a>
        </Button>
        {link.secondaryUrl && (
          <Button asChild variant="outline" size="xs">
            <a href={link.secondaryUrl} {...external}>
              Tax office <ExternalLinkIcon />
            </a>
          </Button>
        )}
      </div>
    </div>
  )
}

/** Admins: the yellow "X lenders missing a portal link" bar, opening to a field per lender. */
function MissingPortals({ lenders }: { lenders: Lender[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 text-amber-950">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium">
        <TriangleAlertIcon className="size-4 shrink-0 text-amber-600" />
        <span className="flex-1">
          {lenders.length} {lenders.length === 1 ? 'lender' : 'lenders'} missing a portal link
        </span>
        {open ? <ChevronDownIcon className="size-4" /> : <ChevronRightIcon className="size-4" />}
      </button>
      {open && (
        <ul className="divide-y divide-amber-200 border-t border-amber-200">
          {lenders.map((l) => (
            <MissingRow key={l.id} lender={l} />
          ))}
        </ul>
      )}
    </div>
  )
}

function MissingRow({ lender }: { lender: Lender }) {
  const [url, setUrl] = useState('')
  const save = useSaveLenderLink()
  const problem = url.trim() ? urlProblem(url) : null
  const submit = () => {
    if (!url.trim()) return
    if (problem) return toast.error(problem)
    save.mutate({ id: lender.id, portalUrl: url }, { onSuccess: () => toast.success(`${lender.name} portal saved`), onError: (e) => toast.error(e.message) })
  }
  return (
    <li className="flex flex-wrap items-center gap-2 px-3 py-2">
      <span className="w-full truncate text-sm sm:w-48">{lender.name}</span>
      <form
        className="flex min-w-0 flex-1 gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <input
          aria-label={`${lender.name} portal link`}
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://"
          aria-invalid={problem ? true : undefined}
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-white px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50 aria-invalid:border-destructive"
        />
        <Button type="submit" size="sm" disabled={!url.trim() || save.isPending}>
          Save
        </Button>
      </form>
    </li>
  )
}

