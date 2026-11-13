import { useRef, useState } from 'react'
import { ImageIcon, UploadIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { confirmAction, Input } from '@/components/shared'
import { BRAND_TYPES, useBrandImage } from '@/lib/api/brandFiles'
import { useLoExtras, useRemovePhoto, useSaveBookingUrl, useUploadPhoto } from '@/lib/api/quickQuotes'
import { cleanBookingUrl } from '@/lib/quickquote/quote'

function BookingLink({ userId, current }: { userId: string; current: string | null }) {
  const saveUrl = useSaveBookingUrl(userId)
  const [text, setText] = useState(current ?? '')
  const cleaned = cleanBookingUrl(text)
  const changed = (cleaned === 'invalid' ? text : cleaned) !== current
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-64 flex-1">
        <Input label="Booking link" value={text} onChange={setText} placeholder="https://…" hint="Your calendar link. The quote PDF shows it as a QR code to book a call." error={cleaned === 'invalid' ? "That doesn't look like a web address." : undefined} />
      </div>
      {changed && cleaned !== 'invalid' && (
        <Button size="sm" disabled={saveUrl.isPending} onClick={() => saveUrl.mutate(cleaned, { onSuccess: () => toast.success(cleaned ? 'Booking link saved' : 'Booking link removed'), onError: (e) => toast.error(e.message) })}>
          {saveUrl.isPending ? 'Saving…' : 'Save link'}
        </Button>
      )}
    </div>
  )
}

/** Settings → My profile: the photo and booking link the Quick Quote PDF shows in its loan officer block. */
export function QuoteProfileFields({ userId, organizationId }: { userId: string; organizationId: string }) {
  const extras = useLoExtras(userId)
  const photo = useBrandImage(extras.data?.photoPath)
  const upload = useUploadPhoto(organizationId, userId)
  const remove = useRemovePhoto(userId)
  const input = useRef<HTMLInputElement>(null)
  const current = extras.data?.photoPath ?? null

  if (extras.isError) return <p className="mt-4 border-t pt-4 text-sm text-muted-foreground">{(extras.error as Error).message}</p>
  if (!extras.data) return null
  return (
    <div className="mt-4 space-y-4 border-t pt-4">
      <div>
        <p className="text-sm font-medium">Photo</p>
        <p className="text-xs text-muted-foreground">Shown next to your name on Quick Quote PDFs. A square headshot works best.</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <div className="flex size-16 items-center justify-center overflow-hidden rounded-full border border-dashed bg-white">
            {current && photo.data ? <img src={photo.data} alt="Your photo" className="size-full object-cover" /> : <ImageIcon className="size-5 text-muted-foreground" />}
          </div>
          <input
            ref={input}
            type="file"
            accept={BRAND_TYPES.join(',')}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) upload.mutate({ file, current }, { onSuccess: () => toast.success('Photo saved'), onError: (err) => toast.error(err.message) })
            }}
          />
          <Button size="sm" variant="outline" disabled={upload.isPending} onClick={() => input.current?.click()}>
            <UploadIcon />
            {upload.isPending ? 'Uploading…' : current ? 'Replace' : 'Upload'}
          </Button>
          {current && (
            <Button
              size="sm"
              variant="ghost"
              disabled={remove.isPending}
              onClick={async () => (await confirmAction('Remove your photo? Quotes will show your name without it.', { confirmLabel: 'Remove', destructive: true })) && remove.mutate(current, { onSuccess: () => toast.success('Photo removed'), onError: (err) => toast.error(err.message) })}
            >
              Remove
            </Button>
          )}
        </div>
      </div>
      <BookingLink key={extras.data.bookingUrl ?? ''} userId={userId} current={extras.data.bookingUrl} />
    </div>
  )
}
