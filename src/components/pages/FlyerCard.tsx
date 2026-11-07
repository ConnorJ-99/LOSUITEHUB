// The flyer in the open house builder (Pages Phase 2b): a small preview,
// Download, Share and Print. The PDF is made from the published page (so the
// QR code opens a live link) and the PDF library loads only when it's made.
import { useState } from 'react'
import { DownloadIcon, Loader2Icon, PrinterIcon, Share2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/shared'
import { usePartners } from '@/lib/api/partners'
import { fetchPublicPage, publicAssetUrl } from '@/lib/api/pages'
import { useProfile } from '@/lib/api/settings'
import { flyerFileName, flyerProblems, flyerView, type FlyerView } from '@/lib/documents/openHouseFlyer'
import type { OpenHouseProperty } from '@/lib/pages/openHouse'

/** Any image as a JPEG data URL (the PDF library can't read WebP or follow links itself). Null when it can't be read. */
async function asJpeg(url: string | null | undefined): Promise<string | null> {
  if (!url) return null
  try {
    const blob = await (await fetch(url)).blob()
    const bitmap = await createImageBitmap(blob)
    const max = 1600
    const k = Math.min(1, max / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * k)
    canvas.height = Math.round(bitmap.height * k)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.85)
  } catch {
    return null
  }
}

export function FlyerCard({ slug, published, property, ownerId }: { slug: string; published: boolean; property: OpenHouseProperty; ownerId: string | null }) {
  const owner = useProfile(ownerId)
  const partners = usePartners()
  const [busy, setBusy] = useState<'download' | 'share' | 'print' | null>(null)
  const url = `${window.location.origin}/p/${slug}`
  const agent = partners.data?.find((p) => p.id === property.agentPartnerId) ?? null
  const problems = flyerProblems({ published, property, loNmls: owner.data?.nmls ?? null })
  const preview = flyerView({
    property,
    url,
    hero: property.photos[0] ?? null,
    lo: { name: owner.data?.fullName ?? null, nmls: owner.data?.nmls ?? null, phone: owner.data?.personalCell || owner.data?.phone || null, email: owner.data?.email ?? null, photo: null },
    agent: agent ? { name: agent.name, company: agent.company, phone: agent.phone, email: agent.email, photo: null } : null,
    company: null,
  })

  /** The PDF, from what's live: the published page's owner card (with the headshot) and agent. */
  const make = async (): Promise<{ blob: Blob; name: string } | null> => {
    if (problems.length) {
      toast.error(problems.join(' '))
      return null
    }
    const live = await fetchPublicPage(slug, false)
    if (!live) {
      toast.error('The page is not live. Publish it first.')
      return null
    }
    const [hero, loPhoto, agentPhoto] = await Promise.all([asJpeg(property.photos[0]), asJpeg(live.owner?.photoPath ? publicAssetUrl(live.owner.photoPath) : null), asJpeg(property.agentPhotoUrl)])
    const flyer: FlyerView = flyerView({
      property,
      url,
      hero,
      lo: { name: live.owner?.name ?? null, nmls: live.owner?.nmls ?? null, phone: live.owner?.phone ?? null, email: live.owner?.email ?? null, photo: loPhoto },
      agent: live.agent ? { ...live.agent, photo: agentPhoto } : null,
      company: live.company,
    })
    const { openHouseFlyerPdf } = await import('@/components/pdf/render')
    const fit = await openHouseFlyerPdf(flyer)
    if (!fit.ok) {
      toast.error(`The flyer runs to ${fit.pages} pages. Show fewer programs or shorten the address.`)
      return null
    }
    return { blob: fit.file, name: flyerFileName(property.address) }
  }

  const run = async (kind: 'download' | 'share' | 'print') => {
    setBusy(kind)
    try {
      const made = await make()
      if (!made) return
      const file = new File([made.blob], made.name, { type: 'application/pdf' })
      if (kind === 'share' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: preview.dateLine, text: `Open house: ${url}` }).catch(() => null)
        return
      }
      const href = URL.createObjectURL(made.blob)
      if (kind === 'print') {
        const frame = document.createElement('iframe')
        frame.style.position = 'fixed'
        frame.style.width = '0'
        frame.style.height = '0'
        frame.style.border = '0'
        frame.src = href
        frame.onload = () => frame.contentWindow?.print()
        document.body.appendChild(frame)
        window.setTimeout(() => {
          frame.remove()
          URL.revokeObjectURL(href)
        }, 60_000)
        return
      }
      const a = document.createElement('a')
      a.href = href
      a.download = made.name
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(href), 10_000)
      if (kind === 'share') toast.info('Sharing files is not available in this browser, so the flyer was downloaded instead.')
    } catch (e) {
      toast.error(`The flyer could not be made: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Card title="Flyer" description="One page, 8.5 × 11, with a QR code to the live page">
      <div className="space-y-3">
        {/* A small likeness of the flyer, from the same words the PDF uses. */}
        <div className="overflow-hidden rounded-lg border bg-white text-[10px] leading-tight shadow-soft">
          <div className="relative h-24 bg-muted">
            {preview.hero && <img src={preview.hero} alt="" className="size-full object-cover" />}
            <span className="absolute -bottom-2 left-3 rounded bg-navy px-2 py-1 text-[9px] font-bold tracking-wider text-white">OPEN HOUSE</span>
          </div>
          <div className="space-y-1 p-3 pt-4">
            <div className="flex items-end justify-between gap-2">
              <p className="text-sm font-bold">{preview.headline}</p>
              {preview.price && <p className="text-sm font-bold text-primary">{preview.price}</p>}
            </div>
            <p className="truncate text-muted-foreground">{preview.dateLine}</p>
            {preview.rows.map((r) => (
              <div key={r.program} className="flex justify-between border-t py-0.5">
                <span className="font-semibold">{r.program}</span>
                <span>
                  {r.rate} · <span className="font-bold">{r.payment}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
        {problems.length > 0 && (
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-money">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <Button className="w-full" disabled={!!busy || problems.length > 0} onClick={() => run('download')}>
          {busy === 'download' ? <Loader2Icon className="animate-spin" /> : <DownloadIcon />}
          Download flyer (PDF)
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" disabled={!!busy || problems.length > 0} onClick={() => run('share')}>
            {busy === 'share' ? <Loader2Icon className="animate-spin" /> : <Share2Icon />}
            Share
          </Button>
          <Button variant="outline" disabled={!!busy || problems.length > 0} onClick={() => run('print')}>
            {busy === 'print' ? <Loader2Icon className="animate-spin" /> : <PrinterIcon />}
            Print
          </Button>
        </div>
      </div>
    </Card>
  )
}
