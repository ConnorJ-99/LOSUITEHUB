import { useRef, useState } from 'react'
import { ImageIcon, Trash2Icon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/shared'
import { uploadLogo, useLogoImages } from '@/lib/api/quickLinks'
import { badgeColor, initials, isLogoUrl, logoCandidates, urlProblem } from '@/lib/quicklinks/links'

/**
 * A tile's logo: the uploaded or pasted logo, then the site's own icon, then
 * a colored badge with initials. `logo` is a viewable address (signed or pasted).
 */
export function LogoImage({ name, logo, siteUrl, className }: { name: string; logo: string | null | undefined; siteUrl: string | null | undefined; className?: string }) {
  const candidates = logoCandidates(logo, siteUrl)
  const key = candidates.join('|')
  const [failed, setFailed] = useState<{ key: string; count: number }>({ key, count: 0 })
  const count = failed.key === key ? failed.count : 0
  const src = candidates[count]
  return (
    <div className={cn('flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-white', !src && cn('border-transparent', badgeColor(name)), className)}>
      {src ? (
        <img
          src={src}
          alt=""
          className="size-full object-contain p-1"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed({ key, count: count + 1 })}
          // Google answers a site with no icon with a tiny grey globe; initials look better.
          onLoad={(e) => {
            if (src.startsWith('https://www.google.com/s2/favicons') && e.currentTarget.naturalWidth <= 16) setFailed({ key, count: count + 1 })
          }}
        />
      ) : (
        <span className="text-sm font-semibold">{initials(name)}</span>
      )}
    </div>
  )
}

/** The viewable address for a stored logo (signed for uploads, as is for pasted). */
export function useLogoSrc(path: string | null | undefined): string | null {
  const images = useLogoImages([path])
  if (!path) return null
  return isLogoUrl(path) ? path : (images.data?.get(path) ?? null)
}

/**
 * Logo picker for the edit windows (owners and admins): upload an image to the
 * logos bucket or paste an https:// address. `onUploaded` hears about each new
 * upload, so a cancelled window can remove it.
 */
export function LogoField({ name, value, onChange, onUploaded, organizationId, siteUrl }: { name: string; value: string | null; onChange: (v: string | null) => void; onUploaded?: (path: string) => void; organizationId: string; siteUrl: string | null }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const src = useLogoSrc(value)
  const pasted = isLogoUrl(value) ? value! : ''
  return (
    <div className="sm:col-span-2 lg:col-span-4">
      <p className="mb-1.5 text-sm font-medium">Logo</p>
      <div className="flex flex-wrap items-start gap-3">
        <LogoImage name={name || '?'} logo={src} siteUrl={siteUrl} className="size-14" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <input
              ref={input}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (!file) return
                setBusy(true)
                try {
                  const path = await uploadLogo(organizationId, file)
                  onUploaded?.(path)
                  onChange(path)
                } catch (err) {
                  toast.error((err as Error).message)
                } finally {
                  setBusy(false)
                }
              }}
            />
            <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => input.current?.click()}>
              <UploadIcon /> {busy ? 'Uploading…' : 'Upload logo'}
            </Button>
            {value && (
              <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
                <Trash2Icon /> Remove logo
              </Button>
            )}
          </div>
          <Input
            label="Or paste a logo address"
            value={pasted}
            onChange={(v) => onChange(v.trim() || null)}
            placeholder="https://…/logo.png"
            error={pasted ? (urlProblem(pasted) ?? (!/^https:\/\//i.test(pasted) ? 'The logo address must start with https://' : undefined)) : undefined}
            hint={value && !pasted ? 'Using an uploaded logo.' : 'Blank = the site’s own icon, then initials.'}
          />
        </div>
      </div>
      {!value && !siteUrl && (
        <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          <ImageIcon className="size-3.5" /> No logo yet: the tile shows initials.
        </p>
      )}
    </div>
  )
}
