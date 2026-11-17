import { useState } from 'react'
import { StarIcon } from 'lucide-react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/shared'
import { usePartners } from '@/lib/api/partners'
import { useProfile } from '@/lib/api/settings'
import { partnerStageLabel } from '@/lib/partners/stages'
import { formatPhone } from '@/lib/pipeline/helpers'
import { buildTemplate, realtorChoices, realtorMissing, TEMPLATES, type Channel, type TemplateId } from '@/lib/messaging/templates'

/**
 * Pick a message template (Connor, 2026-11-17). It only fills the message box:
 * nothing is sent until the usual Send click. The realtor introduction lists
 * realtor partners from the Partner center, preferred first, then Active.
 */
export function TemplatesDialog({
  channel,
  borrowerFirst,
  loName,
  loId,
  onUse,
  onClose,
}: {
  channel: Channel
  borrowerFirst: string
  loName: string | null
  loId: string | null
  onUse: (t: { body: string; subject: string }) => void
  onClose: () => void
}) {
  const [pick, setPick] = useState<TemplateId>('realtor_intro')
  const [chosen, setChosen] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const partners = usePartners()
  const profile = useProfile(loId)

  const realtors = realtorChoices(partners.data ?? [])
  const q = search.trim().toLowerCase()
  const shown = q ? realtors.filter((r) => `${r.name} ${r.company ?? ''}`.toLowerCase().includes(q)) : realtors
  const picked = chosen.map((id) => realtors.find((r) => r.id === id)).filter((r) => !!r)
  const result = buildTemplate(pick, channel, { borrowerFirst, loName, nmls: profile.data?.nmls ?? null, realtors: picked })
  const error = 'error' in result ? result.error : null

  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]))

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Use a template ({channel === 'text' ? 'text' : 'email'})</DialogTitle>
          <DialogDescription>It fills the message box for you to edit. Nothing is sent until you click Send.</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          {TEMPLATES.map((t) => {
            const ok = t.channels.includes(channel)
            return (
              <button
                key={t.id}
                type="button"
                disabled={!ok}
                onClick={() => setPick(t.id)}
                className={cn('block w-full rounded-md border px-3 py-2 text-left text-sm', pick === t.id ? 'border-primary bg-primary/5' : 'hover:bg-muted', !ok && 'cursor-not-allowed opacity-50')}
              >
                <span className="font-medium">{t.label}</span>
                <span className="block text-xs text-muted-foreground">{ok ? t.hint : 'Email only: texts carry no links.'}</span>
              </button>
            )
          })}
        </div>
        {pick === 'realtor_intro' && (
          <div className="space-y-2">
            <Input label="Find a realtor" hideLabel placeholder="Find a realtor by name or company" value={search} onChange={setSearch} />
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-1">
              {partners.isLoading && <p className="p-2 text-sm text-muted-foreground">Loading realtors…</p>}
              {!partners.isLoading && shown.length === 0 && <p className="p-2 text-sm text-muted-foreground">{realtors.length ? 'No realtor matches.' : 'No realtors in the Partner center yet.'}</p>}
              {shown.map((r) => {
                const missing = realtorMissing(r, channel)
                return (
                  <label key={r.id} className={cn('flex items-start gap-2 rounded px-2 py-1.5 text-sm', missing ? 'opacity-50' : 'cursor-pointer hover:bg-muted')}>
                    <input type="checkbox" className="mt-0.5" disabled={!!missing} checked={chosen.includes(r.id)} onChange={() => toggle(r.id)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1 font-medium">
                        {r.name}
                        {r.details?.preferred && <StarIcon className="size-3.5 fill-amber-400 text-amber-400" aria-label="Preferred" />}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        {[r.company, channel === 'text' ? (r.phone ? formatPhone(r.phone) : null) : r.email, r.stage ? partnerStageLabel(r.stage) : null].filter(Boolean).join(' · ')}
                        {missing && ` · ${missing}`}
                      </span>
                    </span>
                  </label>
                )
              })}
            </div>
          </div>
        )}
        <div className="rounded-md bg-muted px-3 py-2 text-sm whitespace-pre-wrap">{error ? <span className="text-muted-foreground">{error}</span> : 'body' in result ? result.body : null}</div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!!error} onClick={() => 'body' in result && onUse(result)}>
            Use this template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
