// New open house, the phone quick action (Pages Phase 2b; mockup "New open
// house · phone quick action"): a photo, the address, price, date and time and
// the listing agent, then one tap makes the live page with sign-in and the
// payment table (rates carried over from your last open house), publishes it,
// and offers the flyer. Also on Pages → New open house and the app icon's
// shortcut (manifest).
import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router'
import { CameraIcon, CheckIcon, CopyIcon, DownloadIcon, Loader2Icon, PencilIcon, Share2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { CurrencyInput, DateInput, Input, Select } from '@/components/shared'
import { flyerAction, type FlyerAction } from '@/components/pages/FlyerCard'
import { usePartners } from '@/lib/api/partners'
import { freeSlug, publishHeadshot, uploadPageImage, useCreatePage, usePages, useSavePage } from '@/lib/api/pages'
import { useFeeTemplates } from '@/lib/api/pricing'
import { useAuth } from '@/lib/auth/context'
import { blankProperty, estimatedHousing, openHouseSlugBase, openHouseTag, openHouseWhen, readProperty, refigure, type OpenHouseProperty } from '@/lib/pages/openHouse'
import { fromTemplate, OPEN_HOUSE_TEMPLATE } from '@/lib/pages/templates'

export function NewOpenHousePage() {
  const navigate = useNavigate()
  const { state } = useAuth()
  const me = state.status === 'signedIn' ? state.user : null
  const pages = usePages()
  const partners = usePartners()
  const fees = useFeeTemplates()
  const create = useCreatePage()
  const save = useSavePage()
  const photoInput = useRef<HTMLInputElement>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  const [address, setAddress] = useState('')
  const [cityLine, setCityLine] = useState('')
  const [price, setPrice] = useState<number | null>(null)
  const [openDate, setOpenDate] = useState<string | null>(null)
  const [startTime, setStartTime] = useState('13:00')
  const [endTime, setEndTime] = useState('16:00')
  const [agentId, setAgentId] = useState<string | null>(null)
  const [step, setStep] = useState<'details' | 'working' | 'done'>('details')
  const [made, setMade] = useState<{ id: string; slug: string; property: OpenHouseProperty } | null>(null)
  const [flyerBusy, setFlyerBusy] = useState<FlyerAction | null>(null)

  // Rates from your most recent open house that had them, so the payment table is ready.
  const lastRates = useMemo(() => {
    const prior = (pages.data ?? []).filter((p) => p.type === 'open_house').map((p) => readProperty(p.property))
    return prior.find((p) => p.financing.some((o) => o.ratePct != null)) ?? null
  }, [pages.data])
  const preview = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo])
  const realtors = (partners.data ?? []).filter((p) => p.kind === 'realtor')

  const go = async () => {
    if (!me?.organizationId) return
    setStep('working')
    try {
      const street = address.trim()
      let property: OpenHouseProperty = {
        ...blankProperty(),
        address: street,
        cityLine: cityLine.trim(),
        listPrice: price,
        openDate,
        startTime,
        endTime,
        agentPartnerId: agentId,
        ...(price ? estimatedHousing(price) : {}),
        ...(lastRates ? { financing: lastRates.financing.map((o) => ({ ...o, figures: null })), ratesAsOf: lastRates.ratesAsOf } : {}),
      }
      property = refigure(property, fees.data ?? [])
      const slug = await freeSlug(openHouseSlugBase(street))
      const id = await create.mutateAsync({
        type: 'open_house',
        title: `Open House · ${street}`,
        slug,
        blocks: fromTemplate(OPEN_HOUSE_TEMPLATE),
        settings: { ...structuredClone(OPEN_HOUSE_TEMPLATE.settings), tags: [openHouseTag(street)] },
        property: property as unknown as Record<string, unknown>,
      })
      if (photo) {
        try {
          property = { ...property, photos: [await uploadPageImage(me.organizationId, id, photo)] }
        } catch (e) {
          toast.error(`The page was made, but the photo didn't upload: ${(e as Error).message}`)
        }
      }
      await publishHeadshot(me.organizationId, me.id)
      await save.mutateAsync({ id, patch: { property: property as unknown as Record<string, unknown>, status: 'published' } })
      setMade({ id, slug, property })
      setStep('done')
    } catch (e) {
      toast.error((e as Error).message)
      setStep('details')
    }
  }

  const flyer = async (kind: FlyerAction) => {
    if (!made) return
    if (!made.property.financing.some((o) => o.show && o.figures)) {
      toast.error('Add a rate for at least one program first (Edit details), so the flyer has a payment table.')
      return
    }
    setFlyerBusy(kind)
    try {
      await flyerAction(kind, made.slug, made.property, `Open house · ${made.property.address}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setFlyerBusy(null)
    }
  }

  const url = made ? `${window.location.origin}/p/${made.slug}` : ''
  const ready = !!address.trim() && !!price && step === 'details'

  return (
    <div className="mx-auto max-w-lg pb-28">
      <div className="mb-4 flex items-center justify-between">
        <Link to="/pages" className="text-sm font-semibold text-primary">
          {step === 'done' ? 'Pages' : 'Cancel'}
        </Link>
        <h1 className="text-lg font-bold">New open house</h1>
        <span className="w-12" />
      </div>
      <div className="mb-5 grid grid-cols-3 gap-1.5">
        {['details', 'working', 'done'].map((s, i) => (
          <span key={s} className={cn('h-1.5 rounded-full', i <= ['details', 'working', 'done'].indexOf(step) || (i === 1 && ready) ? 'bg-primary' : 'bg-muted')} />
        ))}
      </div>

      {step !== 'done' && (
        <div className="space-y-4">
          <button type="button" onClick={() => photoInput.current?.click()} className="flex aspect-[16/10] w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-2xl border-2 border-dashed border-primary/30 bg-primary/5 font-semibold text-primary">
            {preview ? (
              <img src={preview} alt="" className="size-full object-cover" />
            ) : (
              <>
                <CameraIcon className="size-7" />
                Take or choose a listing photo
              </>
            )}
          </button>
          <input ref={photoInput} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
          <Input label="Street address" required value={address} onChange={setAddress} placeholder="4218 Fairway Bend Dr" />
          <Input label="City, state ZIP" value={cityLine} onChange={setCityLine} placeholder="Frisco, TX 75034" hint="Taxes and insurance are estimated from the price (2.2% and $3,600 a year); adjust them later." />
          <div className="grid grid-cols-2 gap-3">
            <CurrencyInput label="List price" required value={price} onChange={setPrice} />
            <DateInput label="Date" value={openDate} onChange={setOpenDate} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Starts" type="time" value={startTime} onChange={setStartTime} />
            <Input label="Ends" type="time" value={endTime} onChange={setEndTime} />
          </div>
          <Select label="Listing agent" value={agentId ?? ''} onChange={(v) => setAgentId(v || null)} onClear={agentId ? () => setAgentId(null) : undefined} placeholder={realtors.length ? 'Pick from Partners' : 'No realtors in Partners yet'} options={realtors.map((r) => ({ value: r.id, label: [r.name, r.company].filter(Boolean).join(' · ') }))} />
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4 text-sm">
            <p className="mb-1.5 font-semibold text-primary">Ready in one tap</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Live page with visitor sign-in, published right away</li>
              <li>
                {lastRates
                  ? `Payment table with your last rates: ${lastRates.financing
                      .filter((o) => o.show && o.ratePct != null)
                      .map((o) => `${o.label} ${o.ratePct}%`)
                      .join(' · ')}`
                  : 'Payment table: Conventional · FHA · VA (type your rates after)'}
              </li>
              <li>Printable flyer with a QR code</li>
            </ul>
          </div>
        </div>
      )}

      {step === 'done' && made && (
        <div className="space-y-4">
          <div className="flex flex-col items-center gap-2 py-4 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-primary/10">
              <CheckIcon className="size-7 text-primary" strokeWidth={2.5} />
            </span>
            <p className="text-xl font-bold">Your open house is live</p>
            <p className="text-sm text-muted-foreground">
              {[made.property.address, openHouseWhen(made.property)].filter(Boolean).join(' · ')}
            </p>
            <p className="text-sm break-all text-primary">{url.replace(/^https?:\/\//, '')}</p>
          </div>
          <Button className="h-12 w-full text-base" disabled={!!flyerBusy} onClick={() => flyer('download')}>
            {flyerBusy === 'download' ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
            Download flyer
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-11" disabled={!!flyerBusy} onClick={() => flyer('share')}>
              {flyerBusy === 'share' ? <Loader2Icon className="animate-spin" /> : <Share2Icon />}
              Share flyer
            </Button>
            <Button
              variant="outline"
              className="h-11"
              onClick={() =>
                navigator.clipboard
                  ?.writeText(url)
                  .then(() => toast.success('Link copied'))
                  .catch(() => toast.error('Copy did not work.'))
              }
            >
              <CopyIcon />
              Copy link
            </Button>
          </div>
          <Button variant="ghost" className="w-full" onClick={() => navigate(`/pages/${made.id}`)}>
            <PencilIcon />
            Edit details, photos and rates
          </Button>
        </div>
      )}

      {step !== 'done' && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-card p-4 md:static md:mt-6 md:border-0 md:bg-transparent md:p-0">
          <div className="mx-auto max-w-lg">
            <Button className="h-12 w-full text-base" disabled={!ready} onClick={go}>
              {step === 'working' && <Loader2Icon className="animate-spin" />}
              {step === 'working' ? 'Making your page…' : 'Create & publish page and flyer'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
