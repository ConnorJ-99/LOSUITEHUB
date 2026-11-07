// The open house builder (Pages Phase 2; mockup "Open house builder"): the
// home, the financing table, the live link and the sign-ins. Everything saves
// into pages.property with the page; the financing figures are worked out with
// the Fees tab's engine and saved alongside, so the page shows the same numbers.
import { useRef, useState } from 'react'
import { Link } from 'react-router'
import { ChevronLeftIcon, CopyIcon, ExternalLinkIcon, ImagePlusIcon, Loader2Icon, StarIcon, Trash2Icon, UserPlusIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, CurrencyInput, DateInput, Input, NumberInput, PercentInput, Select } from '@/components/shared'
import { usePartners } from '@/lib/api/partners'
import { uploadPageImage, useDraftOpenHouseThanks, usePageSubmissions } from '@/lib/api/pages'
import { useOrganization, useProfile } from '@/lib/api/settings'
import { estimatedHousing, type FinancingOption, type OpenHouseProperty } from '@/lib/pages/openHouse'
import { todayIso } from '@/lib/dates'

const money = (n: number) => `$${Math.round(n).toLocaleString('en-US')}`

function PhotoStrip({ photos, onChange, organizationId, pageId }: { photos: string[]; onChange: (p: string[]) => void; organizationId: string; pageId: string }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">Photos</p>
      <div className="flex gap-2 overflow-x-auto pb-1">
        {photos.map((src, i) => (
          <div key={src} className="group relative size-24 shrink-0 overflow-hidden rounded-lg border">
            <img src={src} alt="" className="size-full object-cover" />
            {i === 0 && <span className="absolute bottom-1 left-1 rounded bg-navy/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">Hero</span>}
            <div className="absolute inset-x-0 top-0 flex justify-end gap-0.5 bg-gradient-to-b from-black/50 p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              {i > 0 && (
                <button type="button" title="Make this the hero photo" className="rounded bg-white/90 p-1" onClick={() => onChange([src, ...photos.filter((x) => x !== src)])}>
                  <StarIcon className="size-3.5" />
                </button>
              )}
              {i > 0 && (
                <button type="button" title="Move left" className="rounded bg-white/90 p-1" onClick={() => onChange(photos.map((x, j) => (j === i - 1 ? src : j === i ? photos[i - 1] : x)))}>
                  <ChevronLeftIcon className="size-3.5" />
                </button>
              )}
              <button type="button" title="Remove" className="rounded bg-white/90 p-1 text-destructive" onClick={() => onChange(photos.filter((x) => x !== src))}>
                <Trash2Icon className="size-3.5" />
              </button>
            </div>
          </div>
        ))}
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className="flex size-24 shrink-0 flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-sm font-medium text-primary hover:bg-primary/5">
          {busy ? <Loader2Icon className="size-5 animate-spin" /> : <ImagePlusIcon className="size-5" />}
          {busy ? 'Uploading' : 'Add'}
        </button>
        <input
          ref={input}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={async (e) => {
            const files = Array.from(e.target.files ?? [])
            e.target.value = ''
            if (!files.length) return
            setBusy(true)
            const added: string[] = []
            try {
              for (const f of files) added.push(await uploadPageImage(organizationId, pageId, f))
            } catch (err) {
              toast.error((err as Error).message)
            } finally {
              setBusy(false)
              if (added.length) onChange([...photos, ...added])
            }
          }}
        />
      </div>
      <p className="text-xs text-muted-foreground">The first photo is the hero. Photos are public: anyone with the link can see them.</p>
    </div>
  )
}

/** The home: address, price, details, monthly costs, the open house time and the listing agent. */
export function PropertyPanel({ property: p, onChange, organizationId, pageId }: { property: OpenHouseProperty; onChange: (patch: Partial<OpenHouseProperty>) => void; organizationId: string; pageId: string }) {
  const partners = usePartners()
  const agentInput = useRef<HTMLInputElement>(null)
  const [agentBusy, setAgentBusy] = useState(false)
  const realtors = (partners.data ?? []).filter((x) => x.kind === 'realtor')
  return (
    <Card title="Property">
      <div className="space-y-4">
        <PhotoStrip photos={p.photos} onChange={(photos) => onChange({ photos })} organizationId={organizationId} pageId={pageId} />
        <Input label="Street address" required value={p.address} onChange={(v) => onChange({ address: v })} placeholder="4218 Fairway Bend Dr" />
        <Input label="City, state ZIP" value={p.cityLine} onChange={(v) => onChange({ cityLine: v })} placeholder="Frisco, TX 75034" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="col-span-2 sm:col-span-1">
            <CurrencyInput label="List price" required value={p.listPrice} onChange={(v) => onChange({ listPrice: v })} />
          </div>
          <NumberInput label="Beds" value={p.beds} onChange={(v) => onChange({ beds: v })} maxDecimals={0} />
          <NumberInput label="Baths" value={p.baths} onChange={(v) => onChange({ baths: v })} maxDecimals={1} />
          <NumberInput label="Sq ft" value={p.sqft} onChange={(v) => onChange({ sqft: v })} maxDecimals={0} />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <CurrencyInput label="Taxes / mo" value={p.taxesMonthly} onChange={(v) => onChange({ taxesMonthly: v })} />
          <CurrencyInput label="Insurance / mo" value={p.insuranceMonthly} onChange={(v) => onChange({ insuranceMonthly: v })} />
          <CurrencyInput label="HOA / mo" value={p.hoaMonthly} onChange={(v) => onChange({ hoaMonthly: v })} />
        </div>
        {p.listPrice ? (
          <button type="button" className="-mt-2 text-xs font-medium text-primary hover:underline" onClick={() => onChange(estimatedHousing(p.listPrice!))}>
            Estimate taxes (2.2% a year) and insurance ($3,600 a year) from the price
          </button>
        ) : null}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <DateInput label="Open house date" value={p.openDate} onChange={(v) => onChange({ openDate: v })} />
          <Input label="Starts" type="time" value={p.startTime ?? ''} onChange={(v) => onChange({ startTime: v || null })} />
          <Input label="Ends" type="time" value={p.endTime ?? ''} onChange={(v) => onChange({ endTime: v || null })} />
        </div>
        <div className="space-y-2 border-t pt-4">
          <Select
            label="Listing agent (from Partners)"
            value={p.agentPartnerId ?? ''}
            onChange={(v) => onChange({ agentPartnerId: v || null })}
            onClear={p.agentPartnerId ? () => onChange({ agentPartnerId: null }) : undefined}
            placeholder={realtors.length ? 'Pick an agent' : 'No realtors in Partners yet'}
            options={realtors.map((r) => ({ value: r.id, label: [r.name, r.company].filter(Boolean).join(' · ') }))}
            hint="Sign-ins that become new files get this agent on their team."
          />
          <div className="flex flex-wrap items-center gap-2">
            {p.agentPhotoUrl && <img src={p.agentPhotoUrl} alt="" className="size-10 rounded-full object-cover" />}
            <Button size="sm" variant="outline" disabled={agentBusy} onClick={() => agentInput.current?.click()}>
              {agentBusy ? <Loader2Icon className="animate-spin" /> : <ImagePlusIcon />}
              {p.agentPhotoUrl ? 'Replace agent photo' : 'Agent photo'}
            </Button>
            {p.agentPhotoUrl && (
              <Button size="sm" variant="ghost" onClick={() => onChange({ agentPhotoUrl: null })}>
                Remove
              </Button>
            )}
            <Button size="sm" variant="ghost" asChild>
              <Link to="/partners" target="_blank">
                <UserPlusIcon />
                Add a partner
              </Link>
            </Button>
          </div>
          <input
            ref={agentInput}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0]
              e.target.value = ''
              if (!f) return
              setAgentBusy(true)
              try {
                onChange({ agentPhotoUrl: await uploadPageImage(organizationId, pageId, f) })
              } catch (err) {
                toast.error((err as Error).message)
              } finally {
                setAgentBusy(false)
              }
            }}
          />
        </div>
      </div>
    </Card>
  )
}

/** Conventional 5%, FHA 3.5%, VA 0% and one custom option; rates typed per program. */
export function FinancingTable({ property: p, onChange }: { property: OpenHouseProperty; onChange: (patch: Partial<OpenHouseProperty>) => void }) {
  const setOption = (key: FinancingOption['key'], patch: Partial<FinancingOption>) =>
    onChange({ financing: p.financing.map((o) => (o.key === key ? { ...o, ...patch } : o)), ...(patch.ratePct !== undefined ? { ratesAsOf: todayIso() } : {}) })
  return (
    <Card title="Financing options" description="Figured with your Fees settings · type a rate for each program · shows on the page">
      <div className="-mx-2 overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-left text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              <th className="px-2 py-2">Program</th>
              <th className="px-2 py-2 text-right">Down</th>
              <th className="px-2 py-2 text-right">Rate</th>
              <th className="px-2 py-2 text-right">Est. payment</th>
              <th className="px-2 py-2 text-right">Est. cash to close</th>
              <th className="px-2 py-2 text-center">Show</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {p.financing.map((o) => {
              const custom = o.key === 'custom'
              return (
                <tr key={o.key} className={cn(!o.show && 'text-muted-foreground')}>
                  <td className="px-2 py-2 align-middle">
                    {custom ? (
                      <div className="flex gap-1.5">
                        <div className="w-28">
                          <Input label="Custom name" hideLabel value={o.label} onChange={(v) => setOption('custom', { label: v || 'Custom' })} />
                        </div>
                        <div className="w-36">
                          <select
                            aria-label="Loan type"
                            value={o.mortgageType}
                            onChange={(e) => setOption('custom', { mortgageType: e.target.value as FinancingOption['mortgageType'] })}
                            className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                          >
                            <option value="conventional">Conventional</option>
                            <option value="fha">FHA</option>
                            <option value="va">VA</option>
                            <option value="usda_rural">USDA</option>
                          </select>
                        </div>
                      </div>
                    ) : (
                      <span className="font-semibold text-foreground">{o.label}</span>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    {custom ? (
                      <div className="ml-auto w-24">
                        <PercentInput label="Down %" hideLabel value={o.downPct} onChange={(v) => setOption('custom', { downPct: v ?? 0 })} maxDecimals={2} />
                      </div>
                    ) : (
                      <>
                        {o.downPct}% · {o.figures ? money(o.figures.downPayment) : '—'}
                      </>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <div className="ml-auto w-28">
                      <PercentInput label={`${o.label} rate`} hideLabel value={o.ratePct} onChange={(v) => setOption(o.key, { ratePct: v })} />
                    </div>
                  </td>
                  <td className="px-2 py-2 text-right font-semibold whitespace-nowrap text-foreground tabular-nums">{o.figures ? money(o.figures.monthlyPayment) : '—'}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap tabular-nums">{o.figures ? money(o.figures.cashToClose) : '—'}</td>
                  <td className="px-2 py-2 text-center">
                    <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={o.show} onChange={(e) => setOption(o.key, { show: e.target.checked })} aria-label={`Show ${o.label}`} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Payments include principal and interest, taxes, insurance, HOA and mortgage insurance (FHA, VA and low down payment conventional). Cash to close is the down payment plus closing costs from your fee list in Settings, 15 days of prepaid interest and escrows. The page prints the
        disclaimer and the date the rates were entered. A program needs a price and a rate to show.
      </p>
    </Card>
  )
}

export function LivePageCard({ slug, published }: { slug: string; published: boolean }) {
  const url = `${window.location.origin}/p/${slug}`
  return (
    <Card title="Live page">
      <div className="space-y-2 text-sm">
        <p className="break-all text-muted-foreground">{url.replace(/^https?:\/\//, '')}</p>
        {!published && <p className="text-xs text-money">Publish to turn the link on.</p>}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              navigator.clipboard
                ?.writeText(url)
                .then(() => toast.success('Link copied'))
                .catch(() => toast.error('Copy did not work; select the link instead.'))
            }
          >
            <CopyIcon />
            Copy link
          </Button>
          {published && (
            <Button size="sm" variant="outline" onClick={() => window.open(url, '_blank')}>
              <ExternalLinkIcon />
              Open
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}

/** How many visitors signed in, the two answers that matter most, and the after-event thank-you drafts. */
export function SignInsCard({ pageId, address, ownerId }: { pageId: string; address: string; ownerId: string | null }) {
  const subs = usePageSubmissions(pageId)
  const draft = useDraftOpenHouseThanks(pageId)
  const owner = useProfile(ownerId)
  const org = useOrganization()
  const rows = subs.data ?? []
  const said = (re: RegExp, value: boolean) => rows.filter((s) => s.data.some((d) => re.test(d.label) && d.value === value)).length
  const run = () =>
    draft.mutate(
      {
        subs: rows,
        address: address.trim() || 'the open house',
        signer: { loName: owner.data?.fullName ?? null, loNmls: owner.data?.nmls ?? null, loPhone: owner.data?.personalCell || owner.data?.phone || null, companyName: org.data?.name ?? 'MPS Mortgage LLC', companyNmls: org.data?.nmls ?? '2501110' },
      },
      {
        onSuccess: (r) =>
          r.drafted
            ? toast.success(`${r.drafted} thank-you ${r.drafted === 1 ? 'draft is' : 'drafts are'} waiting in your approval queue on Today.`, { description: r.skipped ? `${r.skipped} skipped: already drafted, opted out, or no file.` : undefined })
            : toast.info('No new drafts: everyone already has one, opted out, or has no file.'),
        onError: (e) => toast.error(e.message),
      },
    )
  return (
    <Card title="Visitor sign-ins" action={<span className="text-3xl font-bold tabular-nums">{rows.length}</span>}>
      <div className="space-y-3 text-sm">
        <p className="text-muted-foreground">
          {said(/pre-?approved/i, false)} not pre-approved · {said(/working with an agent/i, true)} working with an agent
        </p>
        <Button className="w-full" disabled={!rows.length || draft.isPending} onClick={run}>
          {draft.isPending && <Loader2Icon className="animate-spin" />}
          Draft follow-ups for review
        </Button>
        <Button size="sm" variant="outline" asChild>
          <Link to={`/pages/${pageId}/submissions`}>See sign-ins</Link>
        </Button>
        <p className="text-xs text-muted-foreground">After the event: one thank-you per visitor (a text, or an email with no phone), fitted to their answers. They wait in your approval queue; nothing sends on its own.</p>
      </div>
    </Card>
  )
}
